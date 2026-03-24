import http from "node:http";
import test from "node:test";
import assert from "node:assert/strict";
import { app, mjmlVersion } from "../server.mjs";

/**
 * @returns {Promise<{ baseUrl: string, close: () => Promise<void> }>}
 */
function startTestServer() {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not resolve test server address."));
        return;
      }
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise((done, fail) => {
            server.close((err) => (err ? fail(err) : done()));
          }),
      });
    });
  });
}

test("GET /health returns JSON ok", async () => {
  const srv = await startTestServer();
  try {
    const res = await fetch(`${srv.baseUrl}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { ok: true });
  } finally {
    await srv.close();
  }
});

test("GET / returns service metadata including mjmlVersion", async () => {
  const srv = await startTestServer();
  try {
    const res = await fetch(`${srv.baseUrl}/`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.service, "railwayapp-mjml");
    assert.equal(body.mjmlVersion, mjmlVersion);
  } finally {
    await srv.close();
  }
});

test("POST /render accepts JSON body and returns HTML", async () => {
  const srv = await startTestServer();
  try {
    const mjml = "<mjml><mj-body><mj-section><mj-column><mj-text>Hello JSON</mj-text></mj-column></mj-section></mj-body></mjml>";
    const res = await fetch(`${srv.baseUrl}/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mjml }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.mjmlVersion, mjmlVersion);
    assert.match(body.html, /Hello JSON/);
    assert.match(body.html, /<!doctype html>/i);
  } finally {
    await srv.close();
  }
});

test("POST /v1/render mirrors POST /render", async () => {
  const srv = await startTestServer();
  try {
    const mjml = "<mjml><mj-body><mj-section><mj-column><mj-text>Hello v1</mj-text></mj-column></mj-section></mj-body></mjml>";
    const res = await fetch(`${srv.baseUrl}/v1/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mjml }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.match(body.html, /Hello v1/);
  } finally {
    await srv.close();
  }
});

test("POST /render accepts plain text MJML", async () => {
  const srv = await startTestServer();
  try {
    const mjml = "<mjml><mj-body><mj-section><mj-column><mj-text>Hello Text</mj-text></mj-column></mj-section></mj-body></mjml>";
    const res = await fetch(`${srv.baseUrl}/render`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: mjml,
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.match(body.html, /Hello Text/);
  } finally {
    await srv.close();
  }
});

test("POST /render accepts text/mjml content type", async () => {
  const srv = await startTestServer();
  try {
    const mjml =
      "<mjml><mj-body><mj-section><mj-column><mj-text>Hello text/mjml</mj-text></mj-column></mj-section></mj-body></mjml>";
    const res = await fetch(`${srv.baseUrl}/render`, {
      method: "POST",
      headers: { "content-type": "text/mjml" },
      body: mjml,
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.match(body.html, /Hello text\/mjml/);
  } finally {
    await srv.close();
  }
});

test("POST /render accepts application/xml body", async () => {
  const srv = await startTestServer();
  try {
    const mjml =
      "<mjml><mj-body><mj-section><mj-column><mj-text>Hello XML</mj-text></mj-column></mj-section></mj-body></mjml>";
    const res = await fetch(`${srv.baseUrl}/render`, {
      method: "POST",
      headers: { "content-type": "application/xml" },
      body: mjml,
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.match(body.html, /Hello XML/);
  } finally {
    await srv.close();
  }
});

test("POST /render accepts text/xml body", async () => {
  const srv = await startTestServer();
  try {
    const mjml =
      "<mjml><mj-body><mj-section><mj-column><mj-text>Hello text/xml</mj-text></mj-column></mj-section></mj-body></mjml>";
    const res = await fetch(`${srv.baseUrl}/render`, {
      method: "POST",
      headers: { "content-type": "text/xml" },
      body: mjml,
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.match(body.html, /Hello text\/xml/);
  } finally {
    await srv.close();
  }
});

test("POST /render returns 415 for unsupported Content-Type", async () => {
  const srv = await startTestServer();
  try {
    const res = await fetch(`${srv.baseUrl}/render`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: "binary",
    });
    assert.equal(res.status, 415);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "UNSUPPORTED_MEDIA_TYPE");
  } finally {
    await srv.close();
  }
});

test("POST /render returns 400 when Content-Type is missing", async () => {
  const srv = await startTestServer();
  try {
    const u = new URL(`${srv.baseUrl}/render`);
    const status = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: u.hostname,
          port: u.port,
          path: u.pathname,
          method: "POST",
        },
        (res) => {
          let data = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            try {
              resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
            } catch (e) {
              reject(e);
            }
          });
        },
      );
      req.on("error", reject);
      req.write("plain body without content-type header");
      req.end();
    });
    assert.equal(status.statusCode, 400);
    assert.equal(status.body.ok, false);
    assert.equal(status.body.error.code, "MISSING_CONTENT_TYPE");
  } finally {
    await srv.close();
  }
});

test("POST /render returns 400 for empty payload", async () => {
  const srv = await startTestServer();
  try {
    const res = await fetch(`${srv.baseUrl}/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "MISSING_MJML");
  } finally {
    await srv.close();
  }
});

test("POST /render returns 400 for whitespace-only MJML", async () => {
  const srv = await startTestServer();
  try {
    const res = await fetch(`${srv.baseUrl}/render`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "   \n\t  ",
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "MISSING_MJML");
  } finally {
    await srv.close();
  }
});

test("POST /render returns 422 for invalid MJML", async () => {
  const srv = await startTestServer();
  try {
    const res = await fetch(`${srv.baseUrl}/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mjml: "<mjml><mj-body><mj-text>Missing wrappers</mj-text></mj-body></mjml>" }),
    });
    assert.equal(res.status, 422);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "MJML_COMPILE_FAILED");
    assert.ok(typeof body.error.message === "string" && body.error.message.length > 0);
  } finally {
    await srv.close();
  }
});

test("POST /render does not resolve mj-include (path traversal / local file read)", async () => {
  const srv = await startTestServer();
  try {
    const marker = "SKIP_MJ_INCLUDE_FILE_PROBE";
    const mjml = `<mjml><mj-head><mj-include path="${marker}" type="css"/></mj-head><mj-body><mj-section><mj-column><mj-text>hi</mj-text></mj-column></mj-section></mj-body></mjml>`;
    const res = await fetch(`${srv.baseUrl}/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mjml }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.match(body.html, /hi/);
    assert.equal(
      body.html.includes(marker),
      false,
      "mj-include must not read local files when rendering untrusted MJML",
    );
  } finally {
    await srv.close();
  }
});

test("POST /render can override validation level via allowlisted options", async () => {
  const srv = await startTestServer();
  try {
    const res = await fetch(`${srv.baseUrl}/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mjml: "<mjml><mj-body><mj-text>Loose validation</mj-text></mj-body></mjml>",
        options: { validationLevel: "skip" },
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.match(body.html, /Loose validation/);
  } finally {
    await srv.close();
  }
});

test("POST /render echoes X-Request-Id", async () => {
  const srv = await startTestServer();
  try {
    const mjml = "<mjml><mj-body><mj-section><mj-column><mj-text>Hello JSON</mj-text></mj-column></mj-section></mj-body></mjml>";
    const res = await fetch(`${srv.baseUrl}/render`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "test-req-1" },
      body: JSON.stringify({ mjml }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-request-id"), "test-req-1");
  } finally {
    await srv.close();
  }
});

test("MJML_API_TOKEN enforces Bearer auth when set", async () => {
  const prev = process.env.MJML_API_TOKEN;
  process.env.MJML_API_TOKEN = "secret-token";
  const srv = await startTestServer();
  try {
    const mjml = "<mjml><mj-body><mj-section><mj-column><mj-text>Hello JSON</mj-text></mj-column></mj-section></mj-body></mjml>";
    const res = await fetch(`${srv.baseUrl}/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mjml }),
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error.code, "UNAUTHORIZED");

    const ok = await fetch(`${srv.baseUrl}/render`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer secret-token",
      },
      body: JSON.stringify({ mjml }),
    });
    assert.equal(ok.status, 200);
  } finally {
    await srv.close();
    if (prev === undefined) {
      delete process.env.MJML_API_TOKEN;
    } else {
      process.env.MJML_API_TOKEN = prev;
    }
  }
});
