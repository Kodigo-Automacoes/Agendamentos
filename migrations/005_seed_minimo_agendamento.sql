-- ============================================================
-- Migration 005: Seed mínimo para destravar agendamento WhatsApp
-- ============================================================
-- Cria/ativa:
-- 1) Serviço: "Corte de cabelo"
-- 2) Profissional ativo na unidade
-- 3) Vínculo profissional <-> serviço
-- 4) Disponibilidade semanal do profissional
-- 5) Configs mínimas da unidade (fallback seguro)
--
-- Usa o canal WhatsApp para descobrir empresa/unidade:
--   instance_key = 'barbearia_teste'
-- ============================================================

DO $$
DECLARE
  v_instance_key TEXT := 'barbearia_teste';
  v_empresa_id UUID;
  v_unidade_id UUID;
  v_servico_id UUID;
  v_profissional_id UUID;
  v_dow INT;
BEGIN
  SELECT c.empresa_id, c.unidade_id
  INTO v_empresa_id, v_unidade_id
  FROM core.canal_whatsapp c
  WHERE c.instance_key = v_instance_key
    AND c.ativo = true
  LIMIT 1;

  IF v_empresa_id IS NULL OR v_unidade_id IS NULL THEN
    RAISE EXCEPTION 'Canal não encontrado para instance_key=%', v_instance_key;
  END IF;

  -- Configuração mínima da unidade (se não existir).
  INSERT INTO agenda.config_unidade (
    unidade_id,
    timezone,
    intervalo_entre_atendimentos_min,
    passo_oferta_min,
    antecedencia_min,
    max_dias_futuro
  )
  VALUES (
    v_unidade_id,
    'America/Sao_Paulo',
    10,
    15,
    60,
    30
  )
  ON CONFLICT (unidade_id) DO NOTHING;

  -- Funcionamento semanal mínimo.
  INSERT INTO agenda.funcionamento_semanal (unidade_id, dow, abre, fecha, ativo)
  VALUES
    (v_unidade_id, 0, '00:00', '00:01', false),
    (v_unidade_id, 1, '08:00', '18:00', true),
    (v_unidade_id, 2, '08:00', '18:00', true),
    (v_unidade_id, 3, '08:00', '18:00', true),
    (v_unidade_id, 4, '08:00', '18:00', true),
    (v_unidade_id, 5, '08:00', '18:00', true),
    (v_unidade_id, 6, '08:00', '12:00', true)
  ON CONFLICT (unidade_id, dow)
  DO UPDATE SET
    abre = EXCLUDED.abre,
    fecha = EXCLUDED.fecha,
    ativo = EXCLUDED.ativo;

  -- Janelas por período.
  INSERT INTO agenda.janela_periodo (unidade_id, periodo, inicio, fim)
  VALUES
    (v_unidade_id, 'manha', '08:00', '12:00'),
    (v_unidade_id, 'tarde', '13:00', '18:00'),
    (v_unidade_id, 'noite', '18:00', '21:00')
  ON CONFLICT (unidade_id, periodo)
  DO UPDATE SET
    inicio = EXCLUDED.inicio,
    fim = EXCLUDED.fim;

  -- Serviço.
  INSERT INTO agenda.servico (
    empresa_id,
    nome,
    duracao_padrao_min,
    preco_padrao,
    ativo
  )
  VALUES (
    v_empresa_id,
    'Corte de cabelo',
    30,
    40,
    true
  )
  ON CONFLICT (empresa_id, nome)
  DO UPDATE SET
    ativo = true,
    duracao_padrao_min = EXCLUDED.duracao_padrao_min
  RETURNING id INTO v_servico_id;

  -- Profissional.
  INSERT INTO agenda.profissional (
    empresa_id,
    unidade_id,
    nome,
    ativo
  )
  VALUES (
    v_empresa_id,
    v_unidade_id,
    'Profissional Seed',
    true
  )
  ON CONFLICT (empresa_id, unidade_id, nome)
  DO UPDATE SET
    ativo = true
  RETURNING id INTO v_profissional_id;

  -- Vínculo profissional <-> serviço.
  INSERT INTO agenda.profissional_servico (
    empresa_id,
    unidade_id,
    profissional_id,
    servico_id,
    ativo
  )
  VALUES (
    v_empresa_id,
    v_unidade_id,
    v_profissional_id,
    v_servico_id,
    true
  )
  ON CONFLICT (profissional_id, servico_id)
  DO UPDATE SET
    ativo = true,
    empresa_id = EXCLUDED.empresa_id,
    unidade_id = EXCLUDED.unidade_id;

  -- Disponibilidade do profissional (seg-sab).
  FOR v_dow IN 1..6 LOOP
    INSERT INTO agenda.disponibilidade_semanal (
      empresa_id,
      unidade_id,
      profissional_id,
      dia_semana,
      hora_inicio,
      hora_fim,
      ativo
    )
    SELECT
      v_empresa_id,
      v_unidade_id,
      v_profissional_id,
      v_dow,
      '08:00'::TIME,
      CASE WHEN v_dow = 6 THEN '12:00'::TIME ELSE '18:00'::TIME END,
      true
    WHERE NOT EXISTS (
      SELECT 1
      FROM agenda.disponibilidade_semanal d
      WHERE d.profissional_id = v_profissional_id
        AND d.dia_semana = v_dow
        AND d.hora_inicio = '08:00'::TIME
        AND d.hora_fim = CASE WHEN v_dow = 6 THEN '12:00'::TIME ELSE '18:00'::TIME END
    );
  END LOOP;

  RAISE NOTICE 'Seed concluído. empresa_id=%, unidade_id=%, servico_id=%, profissional_id=%',
    v_empresa_id, v_unidade_id, v_servico_id, v_profissional_id;
END
$$;

-- ------------------------------------------------------------
-- Verificação rápida (opcional)
-- ------------------------------------------------------------
-- SELECT s.id, s.nome, p.id AS profissional_id, p.nome AS profissional_nome
-- FROM agenda.servico s
-- JOIN agenda.profissional_servico ps ON ps.servico_id = s.id AND ps.ativo = true
-- JOIN agenda.profissional p ON p.id = ps.profissional_id AND p.ativo = true
-- WHERE p.unidade_id = (
--   SELECT unidade_id FROM core.canal_whatsapp WHERE instance_key = 'barbearia_teste' LIMIT 1
-- );
