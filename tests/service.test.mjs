import test from "node:test";
import assert from "node:assert/strict";
import { app } from "../server.mjs";

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

test("GET /health returns ok", async () => {
  const srv = await startTestServer();
  try {
    const res = await fetch(`${srv.baseUrl}/health`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "ok");
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
    assert.match(body.html, /Hello JSON/);
    assert.match(body.html, /<!doctype html>/i);
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
    assert.match(body.error, /must contain MJML/i);
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
    assert.ok(Array.isArray(body.errors));
    assert.ok(body.errors.length > 0);
  } finally {
    await srv.close();
  }
});
