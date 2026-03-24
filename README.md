# MJML Renderer API for railway.app

![Template Header](./template-header.svg)

Deploy an MJML rendering API on Railway. Send MJML via REST and receive compiled HTML.

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template)

Releases are automated with [release-please](https://github.com/googleapis/release-please): merge Conventional Commit messages on `main`, then merge the release PR it opens. Tags look like `railwayapp-mjml-v1.2.3` (`include-component-in-tag`).

## Endpoints

- `GET /` — JSON metadata (`ok`, `service`, `mjmlVersion`)
- `GET /health` — JSON `{ "ok": true }` for probes
- `POST /render` — render MJML to HTML (legacy path)
- `POST /v1/render` — same behavior as `POST /render` (versioned path)

See [`openapi.yaml`](./openapi.yaml) for status codes, request/response shapes, and examples.

### Success response (`200`)

```json
{
  "ok": true,
  "html": "<!doctype html>…",
  "mjmlVersion": "4.18.0"
}
```

### Error response (`4xx` / `5xx`)

Errors always use this shape:

```json
{
  "ok": false,
  "error": {
    "code": "MISSING_MJML",
    "message": "Request body must contain MJML (text/xml body or JSON with `mjml`).",
    "details": {}
  }
}
```

`details` is omitted when empty. Common codes: `MISSING_CONTENT_TYPE`, `MISSING_MJML`, `UNAUTHORIZED`, `UNSUPPORTED_MEDIA_TYPE`, `PAYLOAD_TOO_LARGE`, `RATE_LIMITED`, `MJML_COMPILE_FAILED`, `MJML_VALIDATION_FAILED`, `INTERNAL_ERROR`.

### Request correlation

Send `X-Request-Id` on render requests; the same value is echoed on the response. If omitted, the server generates a UUID.

## Request Format

Supported `Content-Type` values for `POST /render` and `POST /v1/render`:

- `application/json` — body `{ "mjml": "<mjml>…</mjml>", "options": { … } }` (`options` is optional and allowlisted)
- `text/plain`, `text/mjml`, `application/xml`, `text/xml` — raw MJML string as the body

Other media types receive **415 Unsupported Media Type**. The `Content-Type` header is required (otherwise **400**).

You can send plain text MJML:

```bash
curl -X POST http://localhost:8080/render \
  -H "Content-Type: text/plain" \
  --data '<mjml><mj-body><mj-section><mj-column><mj-text>Hello</mj-text></mj-column></mj-section></mj-body></mjml>'
```

or JSON:

```bash
curl -X POST http://localhost:8080/render \
  -H "Content-Type: application/json" \
  -d '{"mjml":"<mjml><mj-body><mj-section><mj-column><mj-text>Hello</mj-text></mj-column></mj-section></mj-body></mjml>"}'
```

or XML media types (same body as plain MJML):

```bash
curl -X POST http://localhost:8080/render \
  -H "Content-Type: application/xml" \
  --data '<mjml><mj-body><mj-section><mj-column><mj-text>Hello</mj-text></mj-column></mj-section></mj-body></mjml>'
```

## Environment

| Variable | Description |
|----------|-------------|
| `PORT` | Service port, defaults to `8080` |
| `MAX_BODY_BYTES` | Max request body size for JSON/text parsers (default `2097152`) |
| `ALLOW_CLIENT_MJML_OPTIONS` | When `false`, client `options` in JSON are ignored (default `true`) |
| `MJML_API_TOKEN` | If set, `POST /render` and `POST /v1/render` require `Authorization: Bearer <token>` |
| `CORS_ORIGIN` | If set, enables CORS for that origin (browser clients). Omit for server-to-server only |
| `TRUST_PROXY` | Set to `1` or `true` when the app sits behind a reverse proxy (Railway, load balancer) so `express-rate-limit` uses the real client IP from `X-Forwarded-For`. Omit in local dev with direct `curl` |
| `RATE_LIMIT_MAX` | If set to a positive integer, limits each client key (default: IP) to that many `POST /render` and `POST /v1/render` requests per window. Unset or `0` disables in-process limiting |
| `RATE_LIMIT_WINDOW_MS` | Window for `RATE_LIMIT_MAX` in milliseconds (default `60000`) |

## Rate limiting

MJML rendering is CPU-heavy; public endpoints should always have **some** protection.

### Built-in (optional)

The service ships with [`express-rate-limit`](https://github.com/express-rate-limit/express-rate-limit) for **`POST /render`** and **`POST /v1/render`** only.

- Set **`RATE_LIMIT_MAX`** (e.g. `120`) and optionally **`RATE_LIMIT_WINDOW_MS`** (default one minute).
- When the limit is exceeded, the API responds with **429** and JSON `{ "ok": false, "error": { "code": "RATE_LIMITED", ... } }`, plus a **`Retry-After`** header (seconds).
- Set **`TRUST_PROXY=1`** on Railway (or any reverse proxy) so the client IP is taken from the forwarded headers; otherwise all traffic may look like one IP.
- The default store is **in-memory**. Multiple replicas each get their own counter; for a shared global limit, use a **reverse proxy** or an external store (see the library docs).

### Reverse proxy / edge (recommended for production)

You can still (or instead) enforce limits **in front** of the container.

**nginx** (example — tune `rate`/`burst` to your traffic):

```nginx
limit_req_zone $binary_remote_addr zone=mjml_render:10m rate=10r/s;

server {
  location /render {
    limit_req zone=mjml_render burst=20 nodelay;
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location /v1/render {
    limit_req zone=mjml_render burst=20 nodelay;
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

**Cloudflare** — Use [Rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/) (or custom WAF rules) on the path that fronts this API, scoped by IP, cookie, or header. Exact UI names vary; look under **Security** → **WAF** → **Rate limiting** in the Cloudflare dashboard.

### Auth

`MJML_API_TOKEN` does not replace rate limits but cuts down anonymous abuse.

## Local

HTTP examples for the REST Client extension: [`http/local.http`](./http/local.http) and [`http/local-errors.http`](./http/local-errors.http).

```bash
docker build -t railwayapp-mjml .
docker run --rm -p 8080:8080 -e PORT=8080 railwayapp-mjml
```

<!-- footer -->
---

[![Airbyte](https://img.shields.io/badge/Airbyte-615EFF?style=for-the-badge&logo=airbyte&logoColor=white)](https://github.com/vergissberlin/railwayapp-airbyte) [![Apache Airflow](https://img.shields.io/badge/Apache%20Airflow-017CEE?style=for-the-badge&logo=apacheairflow&logoColor=white)](https://github.com/vergissberlin/railwayapp-airflow) [![CodiMD](https://img.shields.io/badge/CodiMD-0F766E?style=for-the-badge&logo=markdown&logoColor=white)](https://github.com/vergissberlin/railwayapp-codimd) [![Django](https://img.shields.io/badge/Django-092E20?style=for-the-badge&logo=django&logoColor=white)](https://github.com/vergissberlin/railwayapp-django) [![Email Service](https://img.shields.io/badge/Email%20Service-2563EB?style=for-the-badge&logo=maildotru&logoColor=white)](https://github.com/vergissberlin/railwayapp-email) [![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://github.com/vergissberlin/railwayapp-fastapi) [![Flask](https://img.shields.io/badge/Flask-3fad48?style=for-the-badge&logo=flask&logoColor=white)](https://github.com/vergissberlin/railwayapp-flask) [![Flowise](https://img.shields.io/badge/Flowise-4F46E5?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://github.com/vergissberlin/railwayapp-flowise) [![GitLab CE](https://img.shields.io/badge/GitLab%20CE-FC6D26?style=for-the-badge&logo=gitlab&logoColor=white)](https://github.com/vergissberlin/railwayapp-gitlab) [![Grafana](https://img.shields.io/badge/Grafana-F46800?style=for-the-badge&logo=grafana&logoColor=white)](https://github.com/vergissberlin/railwayapp-grafana) [![Home Assistant](https://img.shields.io/badge/Home%20Assistant-18BCF2?style=for-the-badge&logo=homeassistant&logoColor=white)](https://github.com/vergissberlin/railwayapp-homeassistant) [![InfluxDB](https://img.shields.io/badge/InfluxDB-22ADF6?style=for-the-badge&logo=influxdb&logoColor=white)](https://github.com/vergissberlin/railwayapp-influxdb) [![MJML Renderer API](https://img.shields.io/badge/MJML%20Renderer%20API-FF6F61?style=for-the-badge&logo=maildotru&logoColor=white)](https://github.com/vergissberlin/railwayapp-mjml) [![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white)](https://github.com/vergissberlin/railwayapp-mongodb) [![Mosquitto MQTT](https://img.shields.io/badge/Mosquitto%20MQTT-3C5280?style=for-the-badge&logo=eclipsemosquitto&logoColor=white)](https://github.com/vergissberlin/railwayapp-mqtt) [![MySQL](https://img.shields.io/badge/MySQL-4479A1?style=for-the-badge&logo=mysql&logoColor=white)](https://github.com/vergissberlin/railwayapp-mysql) [![n8n](https://img.shields.io/badge/n8n-EA4B71?style=for-the-badge&logo=n8n&logoColor=white)](https://github.com/vergissberlin/railwayapp-n8n) [![Node-RED](https://img.shields.io/badge/Node-RED-8F0000?style=for-the-badge&logo=nodered&logoColor=white)](https://github.com/vergissberlin/railwayapp-nodered) [![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://github.com/vergissberlin/railwayapp-nodejs) [![OpenSearch](https://img.shields.io/badge/OpenSearch-005EB8?style=for-the-badge&logo=opensearch&logoColor=white)](https://github.com/vergissberlin/railwayapp-opensearch) [![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://github.com/vergissberlin/railwayapp-postgresql) [![Redis](https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white)](https://github.com/vergissberlin/railwayapp-redis) [![TYPO3 CMS](https://img.shields.io/badge/TYPO3%20CMS-FF8700?style=for-the-badge&logo=typo3&logoColor=white)](https://github.com/vergissberlin/railwayapp-typo3)
