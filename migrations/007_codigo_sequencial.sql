-- ============================================================
-- Migration 007: Códigos sequenciais visíveis (#1, #2, #3...)
-- ============================================================
-- Mantém os UUIDs internos (chaves estrangeiras continuam UUID),
-- mas adiciona uma coluna `codigo` BIGSERIAL UNIQUE em cada
-- tabela principal pra exibição amigável na UI.
--
-- Idempotente: pode rodar várias vezes.
-- ============================================================

DO $$
DECLARE
  v_alvos TEXT[][] := ARRAY[
    ARRAY['core','empresa'],
    ARRAY['core','unidade'],
    ARRAY['agenda','servico'],
    ARRAY['agenda','profissional'],
    ARRAY['agenda','agendamento'],
    ARRAY['crm','cliente']
  ];
  v_par TEXT[];
  v_schema TEXT;
  v_tabela TEXT;
  v_seq TEXT;
BEGIN
  FOREACH v_par SLICE 1 IN ARRAY v_alvos LOOP
    v_schema := v_par[1];
    v_tabela := v_par[2];
    v_seq := v_schema || '.' || v_tabela || '_codigo_seq';

    -- Cria sequência se ainda não existir
    EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %s', v_seq);

    -- Adiciona coluna codigo (sem default ainda, pra preencher os existentes)
    EXECUTE format(
      'ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS codigo BIGINT',
      v_schema, v_tabela
    );

    -- Preenche os registros existentes que ainda estão com codigo NULL
    EXECUTE format(
      'UPDATE %I.%I SET codigo = nextval(%L) WHERE codigo IS NULL',
      v_schema, v_tabela, v_seq
    );

    -- Garante NOT NULL + DEFAULT pra inserts futuros
    EXECUTE format(
      'ALTER TABLE %I.%I ALTER COLUMN codigo SET DEFAULT nextval(%L)',
      v_schema, v_tabela, v_seq
    );
    EXECUTE format(
      'ALTER TABLE %I.%I ALTER COLUMN codigo SET NOT NULL',
      v_schema, v_tabela
    );

    -- Constraint UNIQUE
    EXECUTE format(
      'CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I.%I (codigo)',
      v_tabela || '_codigo_uniq', v_schema, v_tabela
    );

    -- Vincula a sequência à coluna (OWNED BY)
    EXECUTE format('ALTER SEQUENCE %s OWNED BY %I.%I.codigo', v_seq, v_schema, v_tabela);
  END LOOP;
END
$$;

-- Grava o message_id de mensagens outbound (pra evitar loop em self-test)
ALTER TABLE integracoes.whatsapp_mensagem
  ALTER COLUMN message_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_mensagem_outbound_message_id
  ON integracoes.whatsapp_mensagem (message_id)
  WHERE direcao = 'out' AND message_id IS NOT NULL;

-- Verificação
SELECT 'core.empresa' AS tabela,
       COUNT(*) AS total,
       MIN(codigo) AS menor,
       MAX(codigo) AS maior FROM core.empresa
UNION ALL SELECT 'core.unidade', COUNT(*), MIN(codigo), MAX(codigo) FROM core.unidade
UNION ALL SELECT 'agenda.servico', COUNT(*), MIN(codigo), MAX(codigo) FROM agenda.servico
UNION ALL SELECT 'agenda.profissional', COUNT(*), MIN(codigo), MAX(codigo) FROM agenda.profissional
UNION ALL SELECT 'agenda.agendamento', COUNT(*), MIN(codigo), MAX(codigo) FROM agenda.agendamento
UNION ALL SELECT 'crm.cliente', COUNT(*), MIN(codigo), MAX(codigo) FROM crm.cliente;
