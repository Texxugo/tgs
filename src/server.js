require("dotenv").config();
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const adminUserRoutes = require("./routes/adminUsers");
const timeRoutes = require("./routes/time");
const entriesRoutes = require("./routes/entries");
const adminAlertsRoutes = require("./routes/adminAlerts");
const adminAdjustmentsRoutes = require("./routes/adminAdjustments");
const adminForgottenRequestRoutes = require("./routes/adminForgottenRequests");
const meRoutes = require("./routes/me");
const serviceOrderRoutes = require("./routes/serviceOrders");
const userServiceOrderRoutes = require("./routes/userServiceOrders");

const app = express();
const trustProxy = process.env.TRUST_PROXY;
const host = process.env.HOST || "0.0.0.0";
const publicApiUrl = String(process.env.PUBLIC_API_URL || "").trim();

app.disable("x-powered-by");
if (trustProxy) app.set("trust proxy", trustProxy);

app.use(cors());
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "5mb" }));

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.get("/health", (req, res) => res.json({ ok: true }));
app.get("/", (req, res) =>
  res.json({
    ok: true,
    message: "API Sistema de Ponto",
    health: "/health",
  }),
);

app.use("/auth", authRoutes);
app.use("/time", timeRoutes);
app.use("/entries", entriesRoutes);
app.use("/admin", adminUserRoutes);
app.use("/admin", adminAlertsRoutes);
app.use("/admin", adminAdjustmentsRoutes);
app.use("/admin", adminForgottenRequestRoutes);
app.use("/me", meRoutes);
app.use("/admin/service-orders", serviceOrderRoutes);
app.use("/service-orders", userServiceOrderRoutes);

app.use((req, res) => {
  return res.status(404).json({
    error: "Rota nao encontrada",
    method: req.method,
    path: req.originalUrl,
  });
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  if (err && err.type === "entity.too.large") {
    return res.status(413).json({ error: "Payload muito grande" });
  }

  if (err && err.message === "CORS origin not allowed") {
    return res.status(403).json({ error: "Origem nao permitida" });
  }

  console.error("[api-error]", err);
  return res.status(500).json({ error: "Erro interno" });
});

const port = Number(process.env.PORT || 3001);
app.listen(port, host, () => {
  console.log(`API listening on ${publicApiUrl || `${host}:${port}`}`);
});
