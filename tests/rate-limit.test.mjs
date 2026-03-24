import test from "node:test";
import assert from "node:assert/strict";
/**
 * @param {import("express").Application} app
 * @returns {Promise<{ baseUrl: string, close: () => Promise<void> }>}
 */
function startTestServer(app) {
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

test("POST /render returns 429 after RATE_LIMIT_MAX requests in window", async () => {
  const prevMax = process.env.RATE_LIMIT_MAX;
  const prevWindow = process.env.RATE_LIMIT_WINDOW_MS;
  process.env.RATE_LIMIT_MAX = "2";
  process.env.RATE_LIMIT_WINDOW_MS = "60000";

  const serverUrl = new URL("../server.mjs", import.meta.url);
  serverUrl.searchParams.set("t", String(Date.now()));
  const { app } = await import(serverUrl.href);

  const srv = await startTestServer(app);
  try {
    const mjml =
      "<mjml><mj-body><mj-section><mj-column><mj-text>Hi</mj-text></mj-column></mj-section></mj-body></mjml>";
    const headers = { "content-type": "application/json" };

    const r1 = await fetch(`${srv.baseUrl}/render`, {
      method: "POST",
      headers,
      body: JSON.stringify({ mjml }),
    });
    const r2 = await fetch(`${srv.baseUrl}/render`, {
      method: "POST",
      headers,
      body: JSON.stringify({ mjml }),
    });
    const r3 = await fetch(`${srv.baseUrl}/render`, {
      method: "POST",
      headers,
      body: JSON.stringify({ mjml }),
    });

    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    assert.equal(r3.status, 429);
    const body = await r3.json();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "RATE_LIMITED");
    assert.equal(r3.headers.get("retry-after"), body.error.details.retryAfterSeconds.toString());
  } finally {
    await srv.close();
    if (prevMax === undefined) {
      delete process.env.RATE_LIMIT_MAX;
    } else {
      process.env.RATE_LIMIT_MAX = prevMax;
    }
    if (prevWindow === undefined) {
      delete process.env.RATE_LIMIT_WINDOW_MS;
    } else {
      process.env.RATE_LIMIT_WINDOW_MS = prevWindow;
    }
  }
});
