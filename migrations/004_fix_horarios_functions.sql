-- ============================================================
-- Migration 004: Corrige funções de horários livres
-- ============================================================
-- Problemas corrigidos:
-- 1) agenda.listar_horarios_livres:
--    SELECT final sem alias causava ambiguidade com RETURNS TABLE
--    (erro: "referência à coluna slot_inicio é ambígua")
--
-- 2) agenda.listar_horarios_livres_unidade:
--    referenciava colunas l.inicio/l.fim ao chamar
--    agenda.listar_horarios_livres, mas a função retorna
--    slot_inicio/slot_fim.
-- ============================================================

CREATE OR REPLACE FUNCTION agenda.listar_horarios_livres(
  p_profissional_id UUID,
  p_servico_id UUID,
  p_janela_inicio TIMESTAMPTZ,
  p_janela_fim TIMESTAMPTZ,
  p_intervalo_min INT DEFAULT 15
)
RETURNS TABLE(slot_inicio TIMESTAMPTZ, slot_fim TIMESTAMPTZ)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_duracao_min INTEGER;
BEGIN
    IF p_intervalo_min IS NULL OR p_intervalo_min <= 0 THEN
        RAISE EXCEPTION 'p_intervalo_min precisa ser > 0';
    END IF;

    IF p_janela_fim <= p_janela_inicio THEN
        RAISE EXCEPTION 'janela inválida: janela_fim <= janela_inicio';
    END IF;

    -- valida vínculo e pega duração
    v_duracao_min := agenda.get_duracao_servico(p_profissional_id, p_servico_id);

    IF v_duracao_min IS NULL OR v_duracao_min <= 0 THEN
        RAISE EXCEPTION 'não foi possível determinar duração do serviço (verifique profissional_servico/servico ativo)';
    END IF;

    RETURN QUERY
    WITH
    candidatos AS (
        SELECT gs AS inicio
        FROM generate_series(
            date_trunc('minute', p_janela_inicio),
            date_trunc('minute', p_janela_fim),
            (p_intervalo_min::TEXT || ' minutes')::INTERVAL
        ) gs
    ),
    slots AS (
        SELECT
            c.inicio AS slot_inicio,
            c.inicio + (v_duracao_min::TEXT || ' minutes')::INTERVAL AS slot_fim
        FROM candidatos c
        WHERE c.inicio >= p_janela_inicio
          AND (c.inicio + (v_duracao_min::TEXT || ' minutes')::INTERVAL) <= p_janela_fim
    ),
    slots_no_expediente AS (
        SELECT s.*
        FROM slots s
        JOIN agenda.disponibilidade_semanal d
          ON d.profissional_id = p_profissional_id
         AND d.ativo = true
         AND d.dia_semana = EXTRACT(DOW FROM s.slot_inicio)::INT
        WHERE (s.slot_inicio::TIME >= d.hora_inicio)
          AND (s.slot_fim::TIME <= d.hora_fim)
    ),
    sem_bloqueio AS (
        SELECT s.*
        FROM slots_no_expediente s
        WHERE NOT EXISTS (
            SELECT 1
            FROM agenda.bloqueio_agenda b
            WHERE b.profissional_id = p_profissional_id
              AND tstzrange(b.inicio, b.fim, '[)') && tstzrange(s.slot_inicio, s.slot_fim, '[)')
        )
    ),
    livres AS (
        SELECT s.*
        FROM sem_bloqueio s
        WHERE NOT EXISTS (
            SELECT 1
            FROM agenda.agendamento a
            WHERE a.profissional_id = p_profissional_id
              AND a.status = 'confirmado'
              AND tstzrange(a.inicio, a.fim, '[)') && tstzrange(s.slot_inicio, s.slot_fim, '[)')
        )
    )
    SELECT l.slot_inicio, l.slot_fim
    FROM livres l
    ORDER BY l.slot_inicio;
END;
$$;

CREATE OR REPLACE FUNCTION agenda.listar_horarios_livres_unidade(
  p_unidade_id UUID,
  p_profissional_id UUID,
  p_servico_id UUID,
  p_data DATE,
  p_periodo agenda.periodo_agenda,
  p_limite INTEGER DEFAULT 20
)
RETURNS TABLE(inicio TIMESTAMPTZ, fim TIMESTAMPTZ)
LANGUAGE plpgsql
AS $$
DECLARE
  v_tz TEXT;
  v_intervalo INT;
  v_passo INT;
  v_antecedencia INT;
  v_maxdias INT;

  v_abre TIME;
  v_fecha TIME;
  v_per_inicio TIME;
  v_per_fim TIME;

  v_janela_ini TIMESTAMPTZ;
  v_janela_fim TIMESTAMPTZ;

  v_now_local TIMESTAMPTZ;
  v_min_inicio TIMESTAMPTZ;
BEGIN
  -- config
  SELECT timezone, intervalo_entre_atendimentos_min, passo_oferta_min, antecedencia_min, max_dias_futuro
  INTO v_tz, v_intervalo, v_passo, v_antecedencia, v_maxdias
  FROM agenda.config_unidade
  WHERE unidade_id = p_unidade_id;

  IF v_tz IS NULL THEN
    v_tz := 'America/Sao_Paulo';
    v_intervalo := 10;
    v_passo := 15;
    v_antecedencia := 60;
    v_maxdias := 30;
  END IF;

  -- max dias futuro
  IF p_data > (CURRENT_DATE + (v_maxdias || ' days')::INTERVAL) THEN
    RETURN;
  END IF;

  -- funcionamento do dia (exceção tem prioridade)
  IF EXISTS (
    SELECT 1 FROM agenda.excecao_funcionamento e
    WHERE e.unidade_id = p_unidade_id AND e.data = p_data AND e.fechado = true
  ) THEN
    RETURN;
  END IF;

  SELECT e.abre, e.fecha
  INTO v_abre, v_fecha
  FROM agenda.excecao_funcionamento e
  WHERE e.unidade_id = p_unidade_id AND e.data = p_data AND e.fechado = false;

  IF v_abre IS NULL THEN
    SELECT f.abre, f.fecha
    INTO v_abre, v_fecha
    FROM agenda.funcionamento_semanal f
    WHERE f.unidade_id = p_unidade_id
      AND f.dow = EXTRACT(DOW FROM p_data)::INT
      AND f.ativo = true;
  END IF;

  IF v_abre IS NULL THEN
    RETURN; -- sem funcionamento
  END IF;

  -- janela do período (manhã/tarde/noite)
  SELECT j.inicio, j.fim
  INTO v_per_inicio, v_per_fim
  FROM agenda.janela_periodo j
  WHERE j.unidade_id = p_unidade_id AND j.periodo = p_periodo;

  IF v_per_inicio IS NULL THEN
    -- se não configurou período, usa default
    IF p_periodo = 'manha' THEN v_per_inicio := '08:00'; v_per_fim := '12:00';
    ELSIF p_periodo = 'tarde' THEN v_per_inicio := '13:00'; v_per_fim := '18:00';
    ELSE v_per_inicio := '18:00'; v_per_fim := '21:00';
    END IF;
  END IF;

  -- interseção funcionamento x período
  v_janela_ini := (p_data + GREATEST(v_abre, v_per_inicio))::TIMESTAMP AT TIME ZONE v_tz;
  v_janela_fim := (p_data + LEAST(v_fecha, v_per_fim))::TIMESTAMP AT TIME ZONE v_tz;

  IF v_janela_ini >= v_janela_fim THEN
    RETURN;
  END IF;

  -- antecedência
  v_now_local := now() AT TIME ZONE v_tz;
  v_min_inicio := (v_now_local + make_interval(mins => v_antecedencia));

  -- pega slots usando sua função atual
  RETURN QUERY
  WITH slots AS (
    SELECT l.slot_inicio AS inicio, l.slot_fim AS fim
    FROM agenda.listar_horarios_livres(
      p_profissional_id,
      p_servico_id,
      v_janela_ini,
      v_janela_fim,
      v_intervalo
    ) l
    WHERE l.slot_inicio >= v_min_inicio
    ORDER BY l.slot_inicio
    LIMIT p_limite * 5 -- pega mais pra depois filtrar pausas sem ficar vazio
  ),
  pausas AS (
    SELECT
      (p_data + ps.inicio)::TIMESTAMP AT TIME ZONE v_tz AS p_ini,
      (p_data + ps.fim)::TIMESTAMP AT TIME ZONE v_tz AS p_fim
    FROM agenda.pausa_semanal ps
    WHERE ps.unidade_id = p_unidade_id
      AND ps.dow = EXTRACT(DOW FROM p_data)::INT
  )
  SELECT s.inicio, s.fim
  FROM slots s
  WHERE NOT EXISTS (
    SELECT 1 FROM pausas p
    WHERE tstzrange(s.inicio, s.fim, '[)') && tstzrange(p.p_ini, p.p_fim, '[)')
  )
  ORDER BY s.inicio
  LIMIT p_limite;

END;
$$;
