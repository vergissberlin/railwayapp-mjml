# MJML Renderer API for railway.app

![MJML Logo](./mjml.png)

Deploy an MJML rendering API on Railway. Send MJML via REST and receive compiled HTML.

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template)

## Endpoints

- `GET /health` -> returns `ok`
- `POST /render` -> renders MJML to HTML

## Request Format

You can send either plain text MJML:

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

## Environment

| Variable | Description                      |
|----------|----------------------------------|
| `PORT`   | Service port, defaults to `8080` |

## Local

```bash
docker build -t railwayapp-mjml .
docker run --rm -p 8080:8080 -e PORT=8080 railwayapp-mjml
```
