-- ============================================================
-- Migration 002: Deduplicação de webhook por message_id
-- ============================================================
-- Problema: N8N/Evolution podem reenviar o mesmo webhook.
-- Sem deduplicação, a mesma mensagem é processada 2x, podendo
-- criar intenções duplicadas ou confirmar agendamento 2x.
-- ============================================================

-- Índice parcial: unique por message_id apenas em mensagens inbound não-nulas.
-- Mensagens outbound podem ter message_id nulo, e não precisam de dedup.
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_mensagem_dedup_inbound
  ON integracoes.whatsapp_mensagem (message_id)
  WHERE message_id IS NOT NULL AND direcao = 'in';

-- NOTA: Se já existem duplicatas no banco, limpe antes de rodar:
--   DELETE FROM integracoes.whatsapp_mensagem a
--   USING integracoes.whatsapp_mensagem b
--   WHERE a.id > b.id
--     AND a.message_id = b.message_id
--     AND a.direcao = 'in'
--     AND b.direcao = 'in';
