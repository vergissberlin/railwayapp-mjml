import compression from "compression";
import cors from "cors";
import express from "express";
import { rateLimit } from "express-rate-limit";
import mjml2html from "mjml";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const mjmlPackageJson = require("mjml/package.json");
export const mjmlVersion = mjmlPackageJson.version;

const RENDER_PATHS = new Set(["/render", "/v1/render"]);

const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024;
const maxBodyBytes = Math.min(
  Number.parseInt(process.env.MAX_BODY_BYTES || String(DEFAULT_MAX_BODY_BYTES), 10) || DEFAULT_MAX_BODY_BYTES,
  50 * 1024 * 1024,
);

const allowClientMjmlOptions =
  String(process.env.ALLOW_CLIENT_MJML_OPTIONS ?? "true").toLowerCase() !== "false";

const rateLimitWindowMs = Math.max(
  1000,
  Number.parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? "60000", 10) || 60000,
);
const rateLimitMax = Math.max(0, Number.parseInt(process.env.RATE_LIMIT_MAX ?? "0", 10) || 0);

/**
 * @param {import("express").Application} app
 */
function configureTrustProxy(app) {
  const raw = process.env.TRUST_PROXY;
  if (raw === undefined || raw === "" || raw === "false" || raw === "0") {
    return;
  }
  if (raw === "true" || raw === "1") {
    app.set("trust proxy", 1);
    return;
  }
  const hops = Number.parseInt(raw, 10);
  if (!Number.isNaN(hops) && hops >= 0) {
    app.set("trust proxy", hops);
    return;
  }
  app.set("trust proxy", raw);
}

/** @type {Set<string>} */
const ALLOWED_MJML_OPTION_KEYS = new Set([
  "validationLevel",
  "minify",
  "minifyOptions",
  "fonts",
  "beautify",
]);

const ALLOWED_CONTENT_TYPES = new Set([
  "application/json",
  "text/plain",
  "text/mjml",
  "application/xml",
  "text/xml",
]);

function parseBaseContentType(headerValue) {
  if (!headerValue || typeof headerValue !== "string") return "";
  return headerValue.split(";")[0].trim().toLowerCase();
}

/**
 * @param {import("express").Response} res
 * @param {number} status
 * @param {string} code
 * @param {string} message
 * @param {unknown} [details]
 */
function sendError(res, status, code, message, details) {
  const payload = {
    ok: false,
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
  };
  res.status(status).json(payload);
}

function pickAllowlistedOptions(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const key of Object.keys(raw)) {
    if (ALLOWED_MJML_OPTION_KEYS.has(key)) {
      out[key] = raw[key];
    }
  }
  return out;
}

function buildMjmlOptions(clientBody) {
  const base = {
    keepComments: false,
    validationLevel: "strict",
    // Disables mj-include file reads (CVE-2025-67898 / CVE-2020-12827) for untrusted bodies.
    ignoreIncludes: true,
  };
  if (!allowClientMjmlOptions) {
    return base;
  }
  const fromClient =
    typeof clientBody === "object" && clientBody !== null && "options" in clientBody
      ? pickAllowlistedOptions(clientBody.options)
      : {};
  return { ...base, ...fromClient };
}

export const app = express();

configureTrustProxy(app);

app.disable("x-powered-by");

function createRenderRateLimiter() {
  if (rateLimitMax < 1) {
    return (req, res, n) => n();
  }
  return rateLimit({
    windowMs: rateLimitWindowMs,
    limit: rateLimitMax,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (req, res, _next, optionsUsed) => {
      const retryAfterSeconds = Math.max(1, Math.ceil(optionsUsed.windowMs / 1000));
      res.setHeader("Retry-After", String(retryAfterSeconds));
      sendError(res, 429, "RATE_LIMITED", "Too many render requests. Please retry later.", {
        retryAfterSeconds,
        limit: optionsUsed.limit,
      });
    },
  });
}

const renderRateLimiter = createRenderRateLimiter();

app.use((req, res, next) => {
  const incoming = req.headers["x-request-id"];
  const requestId = typeof incoming === "string" && incoming.trim() ? incoming.trim() : randomUUID();
  res.setHeader("X-Request-Id", requestId);
  req.requestId = requestId;
  next();
});

app.use((req, res, next) => {
  if (req.method !== "POST" || !RENDER_PATHS.has(req.path)) {
    next();
    return;
  }
  renderRateLimiter(req, res, next);
});

const corsOrigin = process.env.CORS_ORIGIN;
if (corsOrigin && corsOrigin.trim()) {
  app.use(
    cors({
      origin: corsOrigin.trim(),
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
      exposedHeaders: ["X-Request-Id", "Retry-After", "RateLimit-Policy", "RateLimit", "RateLimit-Remaining"],
    }),
  );
}

app.use(compression());

app.use((req, res, next) => {
  if (req.method !== "POST" || !RENDER_PATHS.has(req.path)) {
    next();
    return;
  }
  const baseCt = parseBaseContentType(req.headers["content-type"]);
  if (!baseCt) {
    sendError(res, 400, "MISSING_CONTENT_TYPE", "Content-Type header is required for POST render.");
    return;
  }
  if (!ALLOWED_CONTENT_TYPES.has(baseCt)) {
    sendError(
      res,
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Unsupported Content-Type. Use application/json, text/plain, text/mjml, application/xml, or text/xml.",
      { contentType: baseCt },
    );
    return;
  }
  next();
});

app.use((req, res, next) => {
  if (req.method !== "POST" || !RENDER_PATHS.has(req.path)) {
    next();
    return;
  }
  const token = process.env.MJML_API_TOKEN;
  if (!token) {
    next();
    return;
  }
  const auth = req.headers.authorization;
  const expected = `Bearer ${token}`;
  if (auth !== expected) {
    sendError(res, 401, "UNAUTHORIZED", "Valid Authorization: Bearer token required.");
    return;
  }
  next();
});

app.use(express.json({ limit: maxBodyBytes }));
app.use(
  express.text({
    type: ["text/plain", "text/mjml", "application/xml", "text/xml"],
    limit: maxBodyBytes,
  }),
);

function extractMjmlInput(req) {
  const body = req.body;
  if (typeof body === "string") {
    return body;
  }
  if (body && typeof body === "object" && typeof body.mjml === "string") {
    return body.mjml;
  }
  return "";
}

function handleRender(req, res) {
  const started = Date.now();
  const requestId = req.requestId || "";

  const logFinish = (status) => {
    const ms = Date.now() - started;
    console.log(
      JSON.stringify({
        msg: "render_request",
        requestId,
        path: req.path,
        method: req.method,
        status,
        durationMs: ms,
      }),
    );
  };

  res.on("finish", () => {
    logFinish(res.statusCode);
  });

  const mjmlInput = extractMjmlInput(req).trim();
  if (!mjmlInput) {
    sendError(
      res,
      400,
      "MISSING_MJML",
      "Request body must contain MJML (text/xml body or JSON with `mjml`).",
    );
    return;
  }

  const options = buildMjmlOptions(req.body);
  let result;
  try {
    result = mjml2html(mjmlInput, options);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendError(res, 422, "MJML_COMPILE_FAILED", message || "MJML compilation failed.");
    return;
  }

  if (Array.isArray(result.errors) && result.errors.length > 0) {
    sendError(res, 422, "MJML_VALIDATION_FAILED", "MJML validation failed.", {
      mjmlErrors: result.errors,
    });
    return;
  }

  res.status(200).json({
    ok: true,
    html: result.html,
    mjmlVersion,
  });
}

app.get("/", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "railwayapp-mjml",
    mjmlVersion,
  });
});

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.post("/render", handleRender);
app.post("/v1/render", handleRender);

/** @param {import("express").ErrorRequestHandler} fn */
function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (
    err &&
    (err.type === "entity.too.large" || err.status === 413 || err.statusCode === 413)
  ) {
    sendError(res, 413, "PAYLOAD_TOO_LARGE", "Request body exceeds configured limit.", {
      maxBodyBytes,
    });
    return;
  }
  console.error(JSON.stringify({ msg: "unhandled_error", requestId: req.requestId, err: String(err) }));
  sendError(res, 500, "INTERNAL_ERROR", "An unexpected error occurred.");
}

app.use(errorHandler);

export function startServer(port = Number(process.env.PORT || 8080)) {
  return app.listen(port, () => {
    console.log(`railwayapp-mjml listening on ${port}`);
  });
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  startServer();
}
