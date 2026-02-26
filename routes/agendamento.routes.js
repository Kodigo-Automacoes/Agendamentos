const express = require("express");
const router = express.Router();

const {
  criarIntencao,
  confirmarIntencao,
} = require("../services/agendamento.service");

// Mantém o mesmo path que você já usava
router.post("/criar-intencao", criarIntencao);
router.post("/confirmar-intencao", confirmarIntencao);

module.exports = router;