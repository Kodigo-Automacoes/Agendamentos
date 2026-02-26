-- ============================================================
-- Migration 003: Função para cancelar intenção de agendamento
-- ============================================================
-- Problema: Quando o usuário diz NÃO ou cancela o fluxo,
-- a intenção criada permanecia pendente indefinidamente,
-- bloqueando o slot de horário sem ser liberada.
-- ============================================================

CREATE OR REPLACE FUNCTION agenda.cancelar_intencao_agendamento(
  p_intencao_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql AS $$
DECLARE
  v_found BOOLEAN;
BEGIN
  UPDATE agenda.intencao_agendamento
  SET status     = 'cancelada',
      updated_at = now()
  WHERE id = p_intencao_id
    AND status IN ('pendente', 'reservada')
  RETURNING true INTO v_found;

  RETURN COALESCE(v_found, false);
END;
$$;

-- BONUS: Expirar intenções antigas automaticamente (rodar via cron/pg_cron)
-- Útil para intenções de clientes que abandonaram o fluxo sem responder.
--
-- CREATE OR REPLACE FUNCTION agenda.expirar_intencoes_antigas(p_minutos INT DEFAULT 30)
-- RETURNS INT
-- LANGUAGE plpgsql AS $$
-- DECLARE
--   v_count INT;
-- BEGIN
--   UPDATE agenda.intencao_agendamento
--   SET status = 'expirada', updated_at = now()
--   WHERE status IN ('pendente', 'reservada')
--     AND created_at < now() - (p_minutos || ' minutes')::interval;
--   GET DIAGNOSTICS v_count = ROW_COUNT;
--   RETURN v_count;
-- END;
-- $$;
--
-- Para agendar com pg_cron (a cada 10 min):
-- SELECT cron.schedule('expirar-intencoes', '*/10 * * * *',
--   $$SELECT agenda.expirar_intencoes_antigas(30)$$);
