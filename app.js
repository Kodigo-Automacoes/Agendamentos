require("dotenv").config();

const express = require("express");
const auth = require("./middlewares/auth");

const healthRoutes = require("./routes/health.routes");
const agendamentoRoutes = require("./routes/agendamento.routes");
const messageRoutes = require("./routes/message.routes");

const app = express();

app.use(express.json({ limit: "5mb" }));

// middleware global de segurança
app.use(auth);

// rotas
app.use("/", healthRoutes);
app.use("/", agendamentoRoutes); // mantém compatibilidade com endpoints antigos
app.use("/", messageRoutes);     // /message-router vai ficar aqui

module.exports = app;