-- ============================================================
-- VERIFICAÇÃO PÓS-MIGRAÇÃO: Schema de intencao_agendamento
-- ============================================================
-- Execute este script no banco e valide que:
--   1) A tabela existe no schema agenda
--   2) As colunas id (uuid), status (text/varchar), updated_at (timestamp) existem
--   3) Os valores de status incluem 'pendente', 'reservada', 'cancelada'
--   4) A função cancelar_intencao_agendamento existe e aceita UUID
-- ============================================================

-- 1) Colunas da tabela intencao_agendamento
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'agenda'
  AND table_name   = 'intencao_agendamento'
ORDER BY ordinal_position;

-- 2) Valores distintos de status existentes no banco
SELECT status, COUNT(*) AS total
FROM agenda.intencao_agendamento
GROUP BY status
ORDER BY status;

-- 3) Confirmar que a coluna 'status' aceita 'cancelada'
--    Se status for ENUM, listar os valores do tipo:
SELECT t.typname, e.enumlabel
FROM pg_type t
JOIN pg_enum e ON e.enumtypid = t.oid
WHERE t.typname IN (
  SELECT udt_name FROM information_schema.columns
  WHERE table_schema = 'agenda'
    AND table_name   = 'intencao_agendamento'
    AND column_name  = 'status'
)
ORDER BY e.enumsortorder;
-- Se retornar 0 rows → status é TEXT/VARCHAR (aceita qualquer valor) ✓
-- Se retornar rows → verificar se 'cancelada' está na lista.
--   Se NÃO estiver, rodar:
--   ALTER TYPE agenda.<nome_do_tipo> ADD VALUE 'cancelada';

-- 4) Verificar que a função existe
SELECT proname, proargnames, proargtypes::regtype[]
FROM pg_proc
WHERE proname = 'cancelar_intencao_agendamento'
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'agenda');

-- 5) Verificar que config_unidade existe (para getTimezoneUnidade)
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'agenda'
  AND table_name   = 'config_unidade'
ORDER BY ordinal_position;

-- 6) Teste rápido: cancelar uma intenção inexistente (deve retornar false)
SELECT agenda.cancelar_intencao_agendamento('00000000-0000-0000-0000-000000000000'::uuid) AS cancelada;
-- Esperado: cancelada = false
