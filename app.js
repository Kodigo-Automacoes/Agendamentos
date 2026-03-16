require("dotenv").config();

const express = require("express");
const auth = require("./middlewares/auth");

const healthRoutes = require("./routes/health.routes");
const agendamentoRoutes = require("./routes/agendamento.routes");
const messageRoutes = require("./routes/message.routes");

const app = express();

app.use(express.json({ limit: "5mb" }));

// rotas públicas
app.use("/", healthRoutes);

// rotas protegidas
app.use(auth);
app.use("/", agendamentoRoutes);
app.use("/", messageRoutes);

module.exports = app;