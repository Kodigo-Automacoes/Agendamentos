const path = require("path");
// Carrega .env a partir da raiz do projeto (um nível acima deste arquivo),
// pra que `node backend/server.js` funcione independente do cwd.
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const express = require("express");
const auth = require("./middlewares/auth");

const healthRoutes = require("./routes/health.routes");
const agendamentoRoutes = require("./routes/agendamento.routes");
const { router: messageRoutes } = require("./routes/message.routes");
const evolutionRoutes = require("./routes/evolution.routes");
const appPanelRoutes = require("./routes/app.routes");
const adminPanelRoutes = require("./routes/admin.routes");

const app = express();

app.use(express.json({ limit: "5mb" }));

// ------------------------------------------------------------
// Front-end estático (landing + painéis)
// ------------------------------------------------------------
// ../frontend guarda os 3 HTMLs do design + assets JS. A página
// inicial é a landing. Os painéis ficam em /app e /admin e
// consomem /api/app/* e /api/admin/* via fetch autenticado (a
// x-api-key é guardada em localStorage — ver frontend/assets/api.js).
const FRONTEND_DIR = path.join(__dirname, "..", "frontend");
app.use(express.static(FRONTEND_DIR, { extensions: ["html"] }));

app.get("/", (_req, res, next) => {
  res.sendFile(path.join(FRONTEND_DIR, "index.html"), (err) => err && next(err));
});
app.get("/app", (_req, res, next) => {
  res.sendFile(path.join(FRONTEND_DIR, "app.html"), (err) => err && next(err));
});
app.get("/admin", (_req, res, next) => {
  res.sendFile(path.join(FRONTEND_DIR, "admin.html"), (err) => err && next(err));
});

// ------------------------------------------------------------
// Rotas públicas (sem auth) — health / status
// ------------------------------------------------------------
app.use("/", healthRoutes);

// ------------------------------------------------------------
// Webhooks externos (autenticação própria via x-api-key OU secret)
// Devem ficar ANTES do auth global para não serem bloqueadas.
// ------------------------------------------------------------
app.use("/", messageRoutes);

// ------------------------------------------------------------
// Rotas protegidas (x-api-key obrigatória)
// ------------------------------------------------------------
app.use(auth);
app.use("/", agendamentoRoutes);
app.use("/", evolutionRoutes);
app.use("/", appPanelRoutes);
app.use("/", adminPanelRoutes);

module.exports = app;
