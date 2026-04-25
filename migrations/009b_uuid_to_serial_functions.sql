-- ============================================================
-- Migration 009b: Stored procedures com INTEGER
-- ============================================================

-- crm.normalizar_whatsapp_e164 (sem UUID, igual)
CREATE OR REPLACE FUNCTION crm.normalizar_whatsapp_e164(p_whatsapp TEXT)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v TEXT;
BEGIN
  IF p_whatsapp IS NULL OR btrim(p_whatsapp) = '' THEN RETURN NULL; END IF;
  v := regexp_replace(p_whatsapp, '[^0-9+]', '', 'g');
  RETURN v;
END; $$;

-- crm.get_or_create_cliente
CREATE OR REPLACE FUNCTION crm.get_or_create_cliente(p_empresa_id INT, p_nome TEXT, p_whatsapp TEXT)
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE v_whatsapp TEXT; v_id INT;
BEGIN
  v_whatsapp := crm.normalizar_whatsapp_e164(p_whatsapp);
  IF v_whatsapp IS NULL THEN RAISE EXCEPTION 'whatsapp invalido'; END IF;
  SELECT c.id INTO v_id FROM crm.cliente c WHERE c.empresa_id = p_empresa_id AND c.whatsapp_e164 = v_whatsapp LIMIT 1;
  IF v_id IS NOT NULL THEN
    UPDATE crm.cliente SET nome = COALESCE(nome, NULLIF(btrim(p_nome), '')) WHERE id = v_id;
    RETURN v_id;
  END IF;
  INSERT INTO crm.cliente (empresa_id, nome, whatsapp_e164) VALUES (p_empresa_id, NULLIF(btrim(p_nome), ''), v_whatsapp) RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

-- core.resolver_canal_whatsapp
CREATE OR REPLACE FUNCTION core.resolver_canal_whatsapp(p_numero_e164 TEXT DEFAULT NULL, p_provedor TEXT DEFAULT NULL, p_instance_key TEXT DEFAULT NULL)
RETURNS TABLE(canal_id INT, empresa_id INT, unidade_id INT) LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF p_instance_key IS NOT NULL THEN
    RETURN QUERY SELECT c.id, c.empresa_id, c.unidade_id FROM core.canal_whatsapp c WHERE c.instance_key = p_instance_key AND c.ativo = true LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;
  IF p_numero_e164 IS NOT NULL AND p_provedor IS NOT NULL THEN
    RETURN QUERY SELECT c.id, c.empresa_id, c.unidade_id FROM core.canal_whatsapp c WHERE c.numero_e164 = p_numero_e164 AND c.provedor = p_provedor AND c.ativo = true LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;
  IF p_numero_e164 IS NOT NULL THEN
    RETURN QUERY SELECT c.id, c.empresa_id, c.unidade_id FROM core.canal_whatsapp c WHERE c.numero_e164 = p_numero_e164 AND c.ativo = true LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;
  RETURN;
END; $$;

-- core.upsert_canal_whatsapp
CREATE OR REPLACE FUNCTION core.upsert_canal_whatsapp(p_empresa_id INT, p_unidade_id INT, p_provedor TEXT, p_instance_key TEXT, p_numero_e164 TEXT)
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE v_canal_id INT;
BEGIN
  IF p_instance_key IS NOT NULL THEN
    SELECT id INTO v_canal_id FROM core.canal_whatsapp WHERE instance_key = p_instance_key;
    IF FOUND THEN
      UPDATE core.canal_whatsapp SET numero_e164 = COALESCE(p_numero_e164, numero_e164), provedor = COALESCE(p_provedor, provedor), updated_at = now() WHERE id = v_canal_id;
      RETURN v_canal_id;
    END IF;
  END IF;
  IF p_numero_e164 IS NOT NULL THEN
    SELECT id INTO v_canal_id FROM core.canal_whatsapp WHERE empresa_id = p_empresa_id AND numero_e164 = p_numero_e164;
    IF FOUND THEN
      UPDATE core.canal_whatsapp SET instance_key = COALESCE(p_instance_key, instance_key), provedor = COALESCE(p_provedor, provedor), updated_at = now() WHERE id = v_canal_id;
      RETURN v_canal_id;
    END IF;
  END IF;
  INSERT INTO core.canal_whatsapp (empresa_id, unidade_id, provedor, instance_key, numero_e164) VALUES (p_empresa_id, p_unidade_id, p_provedor, p_instance_key, p_numero_e164) RETURNING id INTO v_canal_id;
  RETURN v_canal_id;
END; $$;

-- integracoes.get_or_create_conversa_estado
CREATE OR REPLACE FUNCTION integracoes.get_or_create_conversa_estado(p_empresa_id INT, p_unidade_id INT, p_canal_id INT, p_cliente_id INT)
RETURNS integracoes.conversa_estado LANGUAGE plpgsql AS $$
DECLARE v integracoes.conversa_estado;
BEGIN
  SELECT * INTO v FROM integracoes.conversa_estado WHERE empresa_id = p_empresa_id AND canal_id = p_canal_id AND cliente_id = p_cliente_id LIMIT 1;
  IF v.id IS NOT NULL THEN RETURN v; END IF;
  INSERT INTO integracoes.conversa_estado (empresa_id, unidade_id, canal_id, cliente_id, estado) VALUES (p_empresa_id, p_unidade_id, p_canal_id, p_cliente_id, 'idle') RETURNING * INTO v;
  RETURN v;
END; $$;

-- agenda.validar_profissional_servico
CREATE OR REPLACE FUNCTION agenda.validar_profissional_servico(p_profissional_id INT, p_servico_id INT)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM agenda.profissional_servico ps WHERE ps.profissional_id = p_profissional_id AND ps.servico_id = p_servico_id AND ps.ativo = true);
$$;

-- agenda.get_duracao_servico
CREATE OR REPLACE FUNCTION agenda.get_duracao_servico(p_profissional_id INT, p_servico_id INT)
RETURNS INT LANGUAGE sql STABLE AS $$
  SELECT COALESCE(ps.duracao_override_min, s.duracao_padrao_min) FROM agenda.servico s JOIN agenda.profissional_servico ps ON ps.servico_id = s.id AND ps.profissional_id = p_profissional_id WHERE s.id = p_servico_id AND s.ativo = true AND ps.ativo = true LIMIT 1;
$$;

-- agenda.criar_intencao_agendamento
CREATE OR REPLACE FUNCTION agenda.criar_intencao_agendamento(p_empresa_id INT, p_unidade_id INT, p_cliente_id INT, p_profissional_id INT, p_servico_id INT, p_inicio_sugerido TIMESTAMPTZ, p_resumo_ia TEXT DEFAULT NULL, p_contexto JSONB DEFAULT NULL)
RETURNS TABLE(intencao_id INT, inicio_sugerido TIMESTAMPTZ, fim_sugerido TIMESTAMPTZ, expira_em TIMESTAMPTZ) LANGUAGE plpgsql AS $$
DECLARE v_duracao_min INT; v_timeout_min INT;
BEGIN
  IF NOT agenda.validar_profissional_servico(p_profissional_id, p_servico_id) THEN RAISE EXCEPTION 'profissional nao atende este servico'; END IF;
  v_duracao_min := agenda.get_duracao_servico(p_profissional_id, p_servico_id);
  IF v_duracao_min IS NULL OR v_duracao_min <= 0 THEN RAISE EXCEPTION 'duracao invalida do servico'; END IF;
  SELECT COALESCE(e.politica_fila_timeout_min, 10) INTO v_timeout_min FROM core.empresa e WHERE e.id = p_empresa_id;
  IF v_timeout_min IS NULL OR v_timeout_min <= 0 THEN v_timeout_min := 10; END IF;
  inicio_sugerido := p_inicio_sugerido;
  fim_sugerido := p_inicio_sugerido + (v_duracao_min::text || ' minutes')::interval;
  expira_em := now() + (v_timeout_min::text || ' minutes')::interval;
  INSERT INTO agenda.intencao_agendamento (empresa_id, unidade_id, cliente_id, profissional_id, servico_id, inicio_sugerido, fim_sugerido, status, resumo_ia, contexto, expira_em)
  VALUES (p_empresa_id, p_unidade_id, p_cliente_id, p_profissional_id, p_servico_id, inicio_sugerido, fim_sugerido, 'aguardando_confirmacao', p_resumo_ia, p_contexto, expira_em)
  RETURNING id INTO intencao_id;
  RETURN NEXT;
END; $$;

-- agenda.confirmar_intencao_agendamento
CREATE OR REPLACE FUNCTION agenda.confirmar_intencao_agendamento(p_intencao_id INT)
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE v_i agenda.intencao_agendamento%ROWTYPE; v_agendamento_id INT;
BEGIN
  SELECT * INTO v_i FROM agenda.intencao_agendamento WHERE id = p_intencao_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'intencao nao encontrada'; END IF;
  IF v_i.status <> 'aguardando_confirmacao' THEN RAISE EXCEPTION 'intencao nao esta aguardando confirmacao (status=%)', v_i.status; END IF;
  IF v_i.expira_em IS NOT NULL AND v_i.expira_em < now() THEN
    UPDATE agenda.intencao_agendamento SET status = 'expirada' WHERE id = p_intencao_id;
    RAISE EXCEPTION 'intencao expirada';
  END IF;
  INSERT INTO agenda.agendamento (empresa_id, unidade_id, cliente_id, profissional_id, servico_id, intencao_id, inicio, fim, status, origem)
  VALUES (v_i.empresa_id, v_i.unidade_id, v_i.cliente_id, v_i.profissional_id, v_i.servico_id, v_i.id, v_i.inicio_sugerido, v_i.fim_sugerido, 'confirmado', 'whatsapp')
  RETURNING id INTO v_agendamento_id;
  UPDATE agenda.intencao_agendamento SET status = 'confirmada' WHERE id = p_intencao_id;
  RETURN v_agendamento_id;
END; $$;

-- agenda.cancelar_intencao_agendamento
CREATE OR REPLACE FUNCTION agenda.cancelar_intencao_agendamento(p_intencao_id INT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE v_found BOOLEAN;
BEGIN
  UPDATE agenda.intencao_agendamento SET status = 'cancelada', updated_at = now() WHERE id = p_intencao_id AND status IN ('pendente', 'reservada', 'aguardando_confirmacao') RETURNING true INTO v_found;
  RETURN COALESCE(v_found, false);
END; $$;

-- agenda.expirar_intencoes_vencidas
CREATE OR REPLACE FUNCTION agenda.expirar_intencoes_vencidas()
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE v_count INT;
BEGIN
  UPDATE agenda.intencao_agendamento SET status = 'expirada' WHERE status = 'aguardando_confirmacao' AND expira_em IS NOT NULL AND expira_em < now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END; $$;

-- agenda.listar_horarios_livres
CREATE OR REPLACE FUNCTION agenda.listar_horarios_livres(p_profissional_id INT, p_servico_id INT, p_janela_inicio TIMESTAMPTZ, p_janela_fim TIMESTAMPTZ, p_intervalo_min INT DEFAULT 15)
RETURNS TABLE(slot_inicio TIMESTAMPTZ, slot_fim TIMESTAMPTZ) LANGUAGE plpgsql STABLE AS $$
DECLARE v_duracao_min INT;
BEGIN
  IF p_intervalo_min IS NULL OR p_intervalo_min <= 0 THEN RAISE EXCEPTION 'p_intervalo_min precisa ser > 0'; END IF;
  IF p_janela_fim <= p_janela_inicio THEN RAISE EXCEPTION 'janela invalida'; END IF;
  v_duracao_min := agenda.get_duracao_servico(p_profissional_id, p_servico_id);
  IF v_duracao_min IS NULL OR v_duracao_min <= 0 THEN RAISE EXCEPTION 'duracao invalida do servico'; END IF;
  RETURN QUERY
  WITH candidatos AS (SELECT gs AS inicio FROM generate_series(date_trunc('minute', p_janela_inicio), date_trunc('minute', p_janela_fim), (p_intervalo_min::TEXT || ' minutes')::INTERVAL) gs),
  slots AS (SELECT c.inicio AS slot_inicio, c.inicio + (v_duracao_min::TEXT || ' minutes')::INTERVAL AS slot_fim FROM candidatos c WHERE c.inicio >= p_janela_inicio AND (c.inicio + (v_duracao_min::TEXT || ' minutes')::INTERVAL) <= p_janela_fim),
  slots_no_expediente AS (SELECT s.* FROM slots s JOIN agenda.disponibilidade_semanal d ON d.profissional_id = p_profissional_id AND d.ativo = true AND d.dia_semana = EXTRACT(DOW FROM s.slot_inicio)::INT WHERE s.slot_inicio::TIME >= d.hora_inicio AND s.slot_fim::TIME <= d.hora_fim),
  sem_bloqueio AS (SELECT s.* FROM slots_no_expediente s WHERE NOT EXISTS (SELECT 1 FROM agenda.bloqueio_agenda b WHERE b.profissional_id = p_profissional_id AND tstzrange(b.inicio, b.fim, '[)') && tstzrange(s.slot_inicio, s.slot_fim, '[)'))),
  livres AS (SELECT s.* FROM sem_bloqueio s WHERE NOT EXISTS (SELECT 1 FROM agenda.agendamento a WHERE a.profissional_id = p_profissional_id AND a.status = 'confirmado' AND tstzrange(a.inicio, a.fim, '[)') && tstzrange(s.slot_inicio, s.slot_fim, '[)')))
  SELECT l.slot_inicio, l.slot_fim FROM livres l ORDER BY l.slot_inicio;
END; $$;

-- agenda.listar_horarios_livres_unidade
CREATE OR REPLACE FUNCTION agenda.listar_horarios_livres_unidade(p_unidade_id INT, p_profissional_id INT, p_servico_id INT, p_data DATE, p_periodo agenda.periodo_agenda, p_limite INT DEFAULT 20)
RETURNS TABLE(inicio TIMESTAMPTZ, fim TIMESTAMPTZ) LANGUAGE plpgsql AS $$
DECLARE v_tz TEXT; v_intervalo INT; v_passo INT; v_antecedencia INT; v_maxdias INT; v_abre TIME; v_fecha TIME; v_per_inicio TIME; v_per_fim TIME; v_janela_ini TIMESTAMPTZ; v_janela_fim TIMESTAMPTZ; v_now_local TIMESTAMPTZ; v_min_inicio TIMESTAMPTZ;
BEGIN
  SELECT timezone, intervalo_entre_atendimentos_min, passo_oferta_min, antecedencia_min, max_dias_futuro INTO v_tz, v_intervalo, v_passo, v_antecedencia, v_maxdias FROM agenda.config_unidade WHERE unidade_id = p_unidade_id;
  IF v_tz IS NULL THEN v_tz := 'America/Sao_Paulo'; v_intervalo := 10; v_passo := 15; v_antecedencia := 60; v_maxdias := 30; END IF;
  IF p_data > (CURRENT_DATE + (v_maxdias || ' days')::INTERVAL) THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM agenda.excecao_funcionamento e WHERE e.unidade_id = p_unidade_id AND e.data = p_data AND e.fechado = true) THEN RETURN; END IF;
  SELECT e.abre, e.fecha INTO v_abre, v_fecha FROM agenda.excecao_funcionamento e WHERE e.unidade_id = p_unidade_id AND e.data = p_data AND e.fechado = false;
  IF v_abre IS NULL THEN SELECT f.abre, f.fecha INTO v_abre, v_fecha FROM agenda.funcionamento_semanal f WHERE f.unidade_id = p_unidade_id AND f.dow = EXTRACT(DOW FROM p_data)::INT AND f.ativo = true; END IF;
  IF v_abre IS NULL THEN RETURN; END IF;
  SELECT j.inicio, j.fim INTO v_per_inicio, v_per_fim FROM agenda.janela_periodo j WHERE j.unidade_id = p_unidade_id AND j.periodo = p_periodo;
  IF v_per_inicio IS NULL THEN
    IF p_periodo = 'manha' THEN v_per_inicio := '08:00'; v_per_fim := '12:00';
    ELSIF p_periodo = 'tarde' THEN v_per_inicio := '13:00'; v_per_fim := '18:00';
    ELSE v_per_inicio := '18:00'; v_per_fim := '21:00'; END IF;
  END IF;
  v_janela_ini := (p_data + GREATEST(v_abre, v_per_inicio))::TIMESTAMP AT TIME ZONE v_tz;
  v_janela_fim := (p_data + LEAST(v_fecha, v_per_fim))::TIMESTAMP AT TIME ZONE v_tz;
  IF v_janela_ini >= v_janela_fim THEN RETURN; END IF;
  v_now_local := now() AT TIME ZONE v_tz;
  v_min_inicio := (v_now_local + make_interval(mins => v_antecedencia));
  RETURN QUERY
  WITH slots AS (SELECT l.slot_inicio AS inicio, l.slot_fim AS fim FROM agenda.listar_horarios_livres(p_profissional_id, p_servico_id, v_janela_ini, v_janela_fim, v_intervalo) l WHERE l.slot_inicio >= v_min_inicio ORDER BY l.slot_inicio LIMIT p_limite * 5),
  pausas AS (SELECT (p_data + ps.inicio)::TIMESTAMP AT TIME ZONE v_tz AS p_ini, (p_data + ps.fim)::TIMESTAMP AT TIME ZONE v_tz AS p_fim FROM agenda.pausa_semanal ps WHERE ps.unidade_id = p_unidade_id AND ps.dow = EXTRACT(DOW FROM p_data)::INT)
  SELECT s.inicio, s.fim FROM slots s WHERE NOT EXISTS (SELECT 1 FROM pausas p WHERE tstzrange(s.inicio, s.fim, '[)') && tstzrange(p.p_ini, p.p_fim, '[)')) ORDER BY s.inicio LIMIT p_limite;
END; $$;

-- agenda.cancelar_agendamento_e_ofertar_fila
CREATE OR REPLACE FUNCTION agenda.cancelar_agendamento_e_ofertar_fila(p_agendamento_id INT, p_motivo TEXT DEFAULT NULL)
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE v_a agenda.agendamento%ROWTYPE; v_oferta_id INT;
BEGIN
  SELECT * INTO v_a FROM agenda.agendamento WHERE id = p_agendamento_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'agendamento nao encontrado'; END IF;
  IF v_a.status <> 'confirmado' THEN RAISE EXCEPTION 'somente confirmado pode ser cancelado (status=%)', v_a.status; END IF;
  UPDATE agenda.agendamento SET status = 'cancelado', cancelado_em = now(), cancelado_motivo = p_motivo WHERE id = p_agendamento_id;
  v_oferta_id := agenda.criar_oferta_para_slot(v_a.empresa_id, v_a.unidade_id, v_a.profissional_id, v_a.servico_id, v_a.inicio, v_a.fim);
  RETURN v_oferta_id;
END; $$;

-- agenda.criar_oferta_para_slot
CREATE OR REPLACE FUNCTION agenda.criar_oferta_para_slot(p_empresa_id INT, p_unidade_id INT, p_profissional_id INT, p_servico_id INT, p_slot_inicio TIMESTAMPTZ, p_slot_fim TIMESTAMPTZ)
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE v_fila agenda.fila_espera%ROWTYPE; v_timeout_min INT; v_oferta_id INT;
BEGIN
  IF p_slot_fim <= p_slot_inicio THEN RAISE EXCEPTION 'slot invalido'; END IF;
  SELECT COALESCE(e.politica_fila_timeout_min, 10) INTO v_timeout_min FROM core.empresa e WHERE e.id = p_empresa_id;
  IF v_timeout_min IS NULL OR v_timeout_min <= 0 THEN v_timeout_min := 10; END IF;
  SELECT f.* INTO v_fila FROM agenda.fila_espera f WHERE f.empresa_id = p_empresa_id AND f.unidade_id = p_unidade_id AND f.status = 'ativa' AND f.servico_id = p_servico_id AND f.janela_inicio <= p_slot_inicio AND f.janela_fim >= p_slot_fim AND (f.profissional_id IS NULL OR f.profissional_id = p_profissional_id) ORDER BY f.prioridade DESC, f.created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;
  INSERT INTO agenda.oferta_fila (empresa_id, unidade_id, fila_id, profissional_id, servico_id, slot_inicio, slot_fim, status, expira_em)
  VALUES (p_empresa_id, p_unidade_id, v_fila.id, p_profissional_id, p_servico_id, p_slot_inicio, p_slot_fim, 'enviada', now() + (v_timeout_min::text || ' minutes')::interval)
  RETURNING id INTO v_oferta_id;
  UPDATE agenda.fila_espera SET status = 'ofertado', ultima_oferta_em = now(), ofertas_enviadas = ofertas_enviadas + 1 WHERE id = v_fila.id;
  RETURN v_oferta_id;
END; $$;

-- agenda.aceitar_oferta_fila
CREATE OR REPLACE FUNCTION agenda.aceitar_oferta_fila(p_oferta_id INT)
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE v_o agenda.oferta_fila%ROWTYPE; v_f agenda.fila_espera%ROWTYPE; v_agendamento_id INT;
BEGIN
  SELECT * INTO v_o FROM agenda.oferta_fila WHERE id = p_oferta_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'oferta nao encontrada'; END IF;
  IF v_o.status <> 'enviada' THEN RAISE EXCEPTION 'oferta nao esta enviavel (status=%)', v_o.status; END IF;
  IF v_o.expira_em < now() THEN UPDATE agenda.oferta_fila SET status = 'expirada', respondida_em = now() WHERE id = p_oferta_id; RAISE EXCEPTION 'oferta expirada'; END IF;
  SELECT * INTO v_f FROM agenda.fila_espera WHERE id = v_o.fila_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fila nao encontrada'; END IF;
  INSERT INTO agenda.agendamento (empresa_id, unidade_id, cliente_id, profissional_id, servico_id, inicio, fim, status, origem)
  VALUES (v_o.empresa_id, v_o.unidade_id, v_f.cliente_id, v_o.profissional_id, v_o.servico_id, v_o.slot_inicio, v_o.slot_fim, 'confirmado', 'whatsapp')
  RETURNING id INTO v_agendamento_id;
  UPDATE agenda.oferta_fila SET status = 'aceita', respondida_em = now() WHERE id = p_oferta_id;
  UPDATE agenda.fila_espera SET status = 'confirmado' WHERE id = v_o.fila_id;
  RETURN v_agendamento_id;
END; $$;

-- agenda.recusar_oferta_fila
CREATE OR REPLACE FUNCTION agenda.recusar_oferta_fila(p_oferta_id INT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_o agenda.oferta_fila%ROWTYPE;
BEGIN
  SELECT * INTO v_o FROM agenda.oferta_fila WHERE id = p_oferta_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'oferta nao encontrada'; END IF;
  IF v_o.status <> 'enviada' THEN RAISE EXCEPTION 'oferta nao esta enviavel (status=%)', v_o.status; END IF;
  UPDATE agenda.oferta_fila SET status = 'recusada', respondida_em = now() WHERE id = p_oferta_id;
  UPDATE agenda.fila_espera SET status = 'recusado' WHERE id = v_o.fila_id;
END; $$;

-- agenda.processar_ofertas_expiradas
CREATE OR REPLACE FUNCTION agenda.processar_ofertas_expiradas()
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE v_count INT;
BEGIN
  WITH exp AS (SELECT id, fila_id FROM agenda.oferta_fila WHERE status = 'enviada' AND expira_em < now() FOR UPDATE SKIP LOCKED)
  UPDATE agenda.oferta_fila o SET status = 'expirada', respondida_em = now() FROM exp WHERE o.id = exp.id;
  UPDATE agenda.fila_espera f SET status = 'expirado' WHERE f.id IN (SELECT fila_id FROM agenda.oferta_fila WHERE status = 'expirada' AND respondida_em >= now() - interval '1 minute');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END; $$;
