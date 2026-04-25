const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// Garante que TODAS as conexões usem timezone America/Sao_Paulo.
// Assim os timestamps retornam sempre no fuso de Brasília.
pool.on("connect", (client) => {
  client.query("SET timezone = 'America/Sao_Paulo'");
});

module.exports = { pool };