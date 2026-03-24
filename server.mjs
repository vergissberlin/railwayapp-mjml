import express from "express";
import mjml2html from "mjml";

const app = express();
const port = Number(process.env.PORT || 8080);

app.use(express.json({ limit: "2mb" }));
app.use(express.text({ type: ["text/plain", "text/mjml"], limit: "2mb" }));

app.get("/", (_req, res) => {
  res.status(200).json({ ok: true, service: "railwayapp-mjml" });
});

app.get("/health", (_req, res) => {
  res.status(200).send("ok");
});

app.post("/render", (req, res) => {
  const mjmlInput =
    typeof req.body === "string"
      ? req.body
      : typeof req.body?.mjml === "string"
        ? req.body.mjml
        : "";

  if (!mjmlInput.trim()) {
    res.status(400).json({
      ok: false,
      error: "Request body must contain MJML (text body or JSON with `mjml`).",
    });
    return;
  }

  const options = typeof req.body === "object" && req.body?.options ? req.body.options : {};
  const result = mjml2html(mjmlInput, {
    keepComments: false,
    validationLevel: "strict",
    ...options,
  });

  if (Array.isArray(result.errors) && result.errors.length > 0) {
    res.status(422).json({
      ok: false,
      html: result.html,
      errors: result.errors,
    });
    return;
  }

  res.status(200).json({
    ok: true,
    html: result.html,
  });
});

app.listen(port, () => {
  console.log(`railwayapp-mjml listening on ${port}`);
});
