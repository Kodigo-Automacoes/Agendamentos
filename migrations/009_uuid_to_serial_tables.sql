-- ============================================================
-- Migration 009: UUID → SERIAL (ID inteiro sequencial)
-- PARTE 1: Drop tudo e recriar schemas com SERIAL
-- ============================================================

-- Drop todas as functions primeiro
DROP FUNCTION IF EXISTS agenda.aceitar_oferta_fila CASCADE;
DROP FUNCTION IF EXISTS agenda.cancelar_agendamento_e_ofertar_fila CASCADE;
DROP FUNCTION IF EXISTS agenda.cancelar_intencao_agendamento CASCADE;
DROP FUNCTION IF EXISTS agenda.confirmar_intencao_agendamento CASCADE;
DROP FUNCTION IF EXISTS agenda.criar_intencao_agendamento CASCADE;
DROP FUNCTION IF EXISTS agenda.criar_oferta_para_slot CASCADE;
DROP FUNCTION IF EXISTS agenda.expirar_intencoes_vencidas CASCADE;
DROP FUNCTION IF EXISTS agenda.get_duracao_servico CASCADE;
DROP FUNCTION IF EXISTS agenda.listar_horarios_livres CASCADE;
DROP FUNCTION IF EXISTS agenda.listar_horarios_livres_unidade CASCADE;
DROP FUNCTION IF EXISTS agenda.processar_ofertas_expiradas CASCADE;
DROP FUNCTION IF EXISTS agenda.recusar_oferta_fila CASCADE;
DROP FUNCTION IF EXISTS agenda.validar_profissional_servico CASCADE;
DROP FUNCTION IF EXISTS core.resolver_canal_whatsapp CASCADE;
DROP FUNCTION IF EXISTS core.upsert_canal_whatsapp CASCADE;
DROP FUNCTION IF EXISTS crm.get_or_create_cliente CASCADE;
DROP FUNCTION IF EXISTS crm.normalizar_whatsapp_e164 CASCADE;
DROP FUNCTION IF EXISTS integracoes.get_or_create_conversa_estado CASCADE;
-- keep core.set_updated_at (trigger, no UUID)

-- Drop todas as tabelas (ordem por dependência)
DROP TABLE IF EXISTS integracoes.whatsapp_mensagem CASCADE;
DROP TABLE IF EXISTS integracoes.conversa_estado CASCADE;
DROP TABLE IF EXISTS integracoes.migracao_aplicada CASCADE;
DROP TABLE IF EXISTS crm.politica_contato_whatsapp CASCADE;
DROP TABLE IF EXISTS agenda.oferta_fila CASCADE;
DROP TABLE IF EXISTS agenda.fila_espera CASCADE;
DROP TABLE IF EXISTS agenda.agendamento CASCADE;
DROP TABLE IF EXISTS agenda.intencao_agendamento CASCADE;
DROP TABLE IF EXISTS agenda.bloqueio_agenda CASCADE;
DROP TABLE IF EXISTS agenda.disponibilidade_semanal CASCADE;
DROP TABLE IF EXISTS agenda.profissional_servico CASCADE;
DROP TABLE IF EXISTS agenda.pausa_semanal CASCADE;
DROP TABLE IF EXISTS agenda.janela_periodo CASCADE;
DROP TABLE IF EXISTS agenda.funcionamento_semanal CASCADE;
DROP TABLE IF EXISTS agenda.excecao_funcionamento CASCADE;
DROP TABLE IF EXISTS agenda.config_unidade CASCADE;
DROP TABLE IF EXISTS agenda.profissional CASCADE;
DROP TABLE IF EXISTS agenda.servico CASCADE;
DROP TABLE IF EXISTS crm.cliente CASCADE;
DROP TABLE IF EXISTS core.canal_whatsapp CASCADE;
DROP TABLE IF EXISTS core.usuario_empresa CASCADE;
DROP TABLE IF EXISTS core.unidade CASCADE;
DROP TABLE IF EXISTS core.empresa CASCADE;

-- Drop e recria tipo enum se existir
DROP TYPE IF EXISTS agenda.periodo_agenda CASCADE;
CREATE TYPE agenda.periodo_agenda AS ENUM ('manha','tarde','noite');

-- =================== CORE ===================
CREATE TABLE core.empresa (
  id SERIAL PRIMARY KEY,
  nome VARCHAR(200) NOT NULL,
  slug VARCHAR(100),
  ativo BOOLEAN DEFAULT true,
  politica_fila_timeout_min INT DEFAULT 10,
  codigo SERIAL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX empresa_codigo_uniq ON core.empresa(codigo);

CREATE TABLE core.unidade (
  id SERIAL PRIMARY KEY,
  empresa_id INT NOT NULL REFERENCES core.empresa(id) ON DELETE CASCADE,
  nome VARCHAR(200) NOT NULL,
  endereco TEXT,
  ativo BOOLEAN DEFAULT true,
  codigo SERIAL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(empresa_id, nome)
);
CREATE UNIQUE INDEX unidade_codigo_uniq ON core.unidade(codigo);

CREATE TABLE core.canal_whatsapp (
  id SERIAL PRIMARY KEY,
  empresa_id INT NOT NULL REFERENCES core.empresa(id) ON DELETE CASCADE,
  unidade_id INT NOT NULL REFERENCES core.unidade(id) ON DELETE CASCADE,
  provedor VARCHAR(50) DEFAULT 'wuzapi',
  provedor_instance_key VARCHAR(200),
  provedor_config JSONB,
  instance_key VARCHAR(200),
  numero_e164 VARCHAR(30),
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(empresa_id, numero_e164)
);
CREATE UNIQUE INDEX idx_canal_whatsapp_instance_key ON core.canal_whatsapp(instance_key) WHERE instance_key IS NOT NULL;
CREATE INDEX idx_canal_numero_ativo ON core.canal_whatsapp(numero_e164, ativo);
CREATE INDEX idx_canal_whatsapp_instance ON core.canal_whatsapp(provedor, provedor_instance_key);

CREATE TABLE core.usuario_empresa (
  id SERIAL PRIMARY KEY,
  empresa_id INT NOT NULL REFERENCES core.empresa(id) ON DELETE CASCADE,
  unidade_id INT REFERENCES core.unidade(id) ON DELETE SET NULL,
  auth_user_id UUID,
  role VARCHAR(30) DEFAULT 'viewer',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(empresa_id, auth_user_id)
);

-- =================== CRM ===================
CREATE TABLE crm.cliente (
  id SERIAL PRIMARY KEY,
  empresa_id INT NOT NULL REFERENCES core.empresa(id) ON DELETE CASCADE,
  nome VARCHAR(200),
  whatsapp_e164 VARCHAR(30) NOT NULL,
  email VARCHAR(200),
  ativo BOOLEAN DEFAULT true,
  codigo SERIAL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(empresa_id, whatsapp_e164)
);
CREATE UNIQUE INDEX cliente_codigo_uniq ON crm.cliente(codigo);
CREATE INDEX idx_cliente_empresa_whatsapp ON crm.cliente(empresa_id, whatsapp_e164);

CREATE TABLE crm.politica_contato_whatsapp (
  id SERIAL PRIMARY KEY,
  empresa_id INT NOT NULL REFERENCES core.empresa(id) ON DELETE CASCADE,
  canal_id INT NOT NULL REFERENCES core.canal_whatsapp(id) ON DELETE CASCADE,
  whatsapp_e164 VARCHAR(30) NOT NULL,
  modo VARCHAR(20) NOT NULL CHECK (modo IN ('aceitar','ignorar','manual')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(empresa_id, canal_id, whatsapp_e164)
);
CREATE INDEX idx_politica_contato_lookup ON crm.politica_contato_whatsapp(empresa_id, canal_id, whatsapp_e164, modo);

-- =================== AGENDA ===================
CREATE TABLE agenda.servico (
  id SERIAL PRIMARY KEY,
  empresa_id INT NOT NULL REFERENCES core.empresa(id) ON DELETE CASCADE,
  nome VARCHAR(200) NOT NULL,
  duracao_padrao_min INT NOT NULL CHECK (duracao_padrao_min > 0),
  preco_padrao NUMERIC(10,2),
  ativo BOOLEAN DEFAULT true,
  codigo SERIAL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(empresa_id, nome)
);
CREATE UNIQUE INDEX servico_codigo_uniq ON agenda.servico(codigo);
CREATE INDEX idx_servico_empresa ON agenda.servico(empresa_id);

CREATE TABLE agenda.profissional (
  id SERIAL PRIMARY KEY,
  empresa_id INT NOT NULL REFERENCES core.empresa(id) ON DELETE CASCADE,
  unidade_id INT NOT NULL REFERENCES core.unidade(id) ON DELETE CASCADE,
  nome VARCHAR(200) NOT NULL,
  ativo BOOLEAN DEFAULT true,
  codigo SERIAL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(empresa_id, unidade_id, nome)
);
CREATE UNIQUE INDEX profissional_codigo_uniq ON agenda.profissional(codigo);
CREATE INDEX idx_profissional_empresa_unidade ON agenda.profissional(empresa_id, unidade_id);

CREATE TABLE agenda.profissional_servico (
  id SERIAL PRIMARY KEY,
  empresa_id INT NOT NULL REFERENCES core.empresa(id) ON DELETE CASCADE,
  unidade_id INT NOT NULL REFERENCES core.unidade(id) ON DELETE CASCADE,
  profissional_id INT NOT NULL REFERENCES agenda.profissional(id) ON DELETE CASCADE,
  servico_id INT NOT NULL REFERENCES agenda.servico(id) ON DELETE CASCADE,
  duracao_override_min INT CHECK (duracao_override_min > 0),
  preco_override NUMERIC(10,2),
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(profissional_id, servico_id)
);
CREATE INDEX idx_profissional_servico_lookup ON agenda.profissional_servico(empresa_id, unidade_id, profissional_id, servico_id);

CREATE TABLE agenda.config_unidade (
  unidade_id INT PRIMARY KEY REFERENCES core.unidade(id) ON DELETE CASCADE,
  timezone VARCHAR(50) DEFAULT 'America/Sao_Paulo',
  intervalo_entre_atendimentos_min INT DEFAULT 10 CHECK (intervalo_entre_atendimentos_min >= 0 AND intervalo_entre_atendimentos_min <= 120),
  passo_oferta_min INT DEFAULT 15 CHECK (passo_oferta_min >= 5 AND passo_oferta_min <= 60),
  antecedencia_min INT DEFAULT 60 CHECK (antecedencia_min >= 0 AND antecedencia_min <= 10080),
  max_dias_futuro INT DEFAULT 30 CHECK (max_dias_futuro >= 1 AND max_dias_futuro <= 365)
);

CREATE TABLE agenda.funcionamento_semanal (
  unidade_id INT NOT NULL REFERENCES core.unidade(id) ON DELETE CASCADE,
  dow INT NOT NULL CHECK (dow >= 0 AND dow <= 6),
  abre TIME NOT NULL,
  fecha TIME NOT NULL,
  ativo BOOLEAN DEFAULT true,
  CHECK (abre < fecha),
  PRIMARY KEY (unidade_id, dow)
);

CREATE TABLE agenda.excecao_funcionamento (
  unidade_id INT NOT NULL REFERENCES core.unidade(id) ON DELETE CASCADE,
  data DATE NOT NULL,
  fechado BOOLEAN DEFAULT true,
  abre TIME,
  fecha TIME,
  CHECK ((fechado = true AND abre IS NULL AND fecha IS NULL) OR (fechado = false AND abre IS NOT NULL AND fecha IS NOT NULL AND abre < fecha)),
  PRIMARY KEY (unidade_id, data)
);

CREATE TABLE agenda.janela_periodo (
  unidade_id INT NOT NULL REFERENCES core.unidade(id) ON DELETE CASCADE,
  periodo agenda.periodo_agenda NOT NULL,
  inicio TIME NOT NULL,
  fim TIME NOT NULL,
  CHECK (inicio < fim),
  PRIMARY KEY (unidade_id, periodo)
);

CREATE TABLE agenda.pausa_semanal (
  id SERIAL PRIMARY KEY,
  unidade_id INT NOT NULL REFERENCES core.unidade(id) ON DELETE CASCADE,
  dow INT NOT NULL CHECK (dow >= 0 AND dow <= 6),
  inicio TIME NOT NULL,
  fim TIME NOT NULL,
  CHECK (inicio < fim)
);
CREATE INDEX ix_pausa_semanal_unidade_dow ON agenda.pausa_semanal(unidade_id, dow);

CREATE TABLE agenda.disponibilidade_semanal (
  id SERIAL PRIMARY KEY,
  empresa_id INT NOT NULL REFERENCES core.empresa(id) ON DELETE CASCADE,
  unidade_id INT NOT NULL REFERENCES core.unidade(id) ON DELETE CASCADE,
  profissional_id INT NOT NULL REFERENCES agenda.profissional(id) ON DELETE CASCADE,
  dia_semana INT NOT NULL CHECK (dia_semana >= 0 AND dia_semana <= 6),
  hora_inicio TIME NOT NULL,
  hora_fim TIME NOT NULL,
  ativo BOOLEAN DEFAULT true,
  CHECK (hora_fim > hora_inicio)
);
CREATE INDEX idx_dispo_empresa_unidade ON agenda.disponibilidade_semanal(empresa_id, unidade_id);
CREATE INDEX idx_dispo_prof_dia ON agenda.disponibilidade_semanal(profissional_id, dia_semana, ativo);

CREATE TABLE agenda.bloqueio_agenda (
  id SERIAL PRIMARY KEY,
  empresa_id INT NOT NULL REFERENCES core.empresa(id) ON DELETE CASCADE,
  unidade_id INT NOT NULL REFERENCES core.unidade(id) ON DELETE CASCADE,
  profissional_id INT NOT NULL REFERENCES agenda.profissional(id) ON DELETE CASCADE,
  inicio TIMESTAMPTZ NOT NULL,
  fim TIMESTAMPTZ NOT NULL,
  motivo TEXT,
  CHECK (fim > inicio)
);
CREATE INDEX idx_bloqueio_empresa_unidade ON agenda.bloqueio_agenda(empresa_id, unidade_id);
CREATE INDEX idx_bloqueio_prof_tempo ON agenda.bloqueio_agenda(profissional_id, inicio, fim);

CREATE TABLE agenda.intencao_agendamento (
  id SERIAL PRIMARY KEY,
  empresa_id INT NOT NULL REFERENCES core.empresa(id) ON DELETE CASCADE,
  unidade_id INT NOT NULL REFERENCES core.unidade(id) ON DELETE CASCADE,
  cliente_id INT NOT NULL REFERENCES crm.cliente(id) ON DELETE CASCADE,
  profissional_id INT NOT NULL REFERENCES agenda.profissional(id) ON DELETE CASCADE,
  servico_id INT NOT NULL REFERENCES agenda.servico(id) ON DELETE CASCADE,
  inicio_sugerido TIMESTAMPTZ NOT NULL,
  fim_sugerido TIMESTAMPTZ NOT NULL,
  status VARCHAR(30) DEFAULT 'aguardando_confirmacao' CHECK (status IN ('aguardando_confirmacao','confirmada','expirada','cancelada','ajuste_solicitado')),
  resumo_ia TEXT,
  contexto JSONB,
  expira_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CHECK (fim_sugerido > inicio_sugerido)
);
CREATE INDEX idx_intencao_lookup ON agenda.intencao_agendamento(empresa_id, unidade_id, cliente_id, status, created_at);
CREATE INDEX idx_intencao_cliente_status ON agenda.intencao_agendamento(cliente_id, status, created_at);
CREATE INDEX idx_intencao_profissional_tempo ON agenda.intencao_agendamento(profissional_id, inicio_sugerido, fim_sugerido);

CREATE TABLE agenda.agendamento (
  id SERIAL PRIMARY KEY,
  empresa_id INT NOT NULL REFERENCES core.empresa(id) ON DELETE CASCADE,
  unidade_id INT NOT NULL REFERENCES core.unidade(id) ON DELETE CASCADE,
  cliente_id INT NOT NULL REFERENCES crm.cliente(id) ON DELETE CASCADE,
  profissional_id INT NOT NULL REFERENCES agenda.profissional(id) ON DELETE CASCADE,
  servico_id INT NOT NULL REFERENCES agenda.servico(id) ON DELETE CASCADE,
  intencao_id INT REFERENCES agenda.intencao_agendamento(id) ON DELETE SET NULL,
  inicio TIMESTAMPTZ NOT NULL,
  fim TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) DEFAULT 'confirmado' CHECK (status IN ('confirmado','cancelado','concluido','no_show')),
  origem VARCHAR(20) DEFAULT 'whatsapp' CHECK (origem IN ('whatsapp','manual','portal')),
  observacao_cliente TEXT,
  observacao_interna TEXT,
  preco_previsto NUMERIC(10,2),
  desconto NUMERIC(10,2),
  preco_final NUMERIC(10,2),
  cancelado_em TIMESTAMPTZ,
  cancelado_motivo TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  codigo SERIAL,
  CHECK (fim > inicio),
  EXCLUDE USING gist (profissional_id WITH =, tstzrange(inicio, fim, '[)') WITH &&) WHERE (status = 'confirmado')
);
CREATE UNIQUE INDEX agendamento_codigo_uniq ON agenda.agendamento(codigo);
CREATE INDEX idx_agendamento_profissional_tempo ON agenda.agendamento(profissional_id, inicio, fim);
CREATE INDEX idx_agendamento_cliente_tempo ON agenda.agendamento(cliente_id, inicio);
CREATE INDEX idx_agendamento_empresa_unidade_tempo ON agenda.agendamento(empresa_id, unidade_id, inicio, fim);

CREATE TABLE agenda.fila_espera (
  id SERIAL PRIMARY KEY,
  empresa_id INT NOT NULL REFERENCES core.empresa(id) ON DELETE CASCADE,
  unidade_id INT NOT NULL REFERENCES core.unidade(id) ON DELETE CASCADE,
  cliente_id INT NOT NULL REFERENCES crm.cliente(id) ON DELETE CASCADE,
  servico_id INT NOT NULL REFERENCES agenda.servico(id) ON DELETE CASCADE,
  profissional_id INT REFERENCES agenda.profissional(id) ON DELETE SET NULL,
  janela_inicio TIMESTAMPTZ NOT NULL,
  janela_fim TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) DEFAULT 'ativa' CHECK (status IN ('ativa','ofertado','confirmado','recusado','expirado','cancelado')),
  prioridade INT DEFAULT 0,
  ofertas_enviadas INT DEFAULT 0,
  ultima_oferta_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  CHECK (janela_fim > janela_inicio)
);
CREATE INDEX idx_fila_lookup ON agenda.fila_espera(empresa_id, unidade_id, status, created_at);
CREATE INDEX idx_fila_profissional ON agenda.fila_espera(profissional_id, status, created_at);
CREATE INDEX idx_fila_servico_janela ON agenda.fila_espera(servico_id, janela_inicio, janela_fim);

CREATE TABLE agenda.oferta_fila (
  id SERIAL PRIMARY KEY,
  empresa_id INT NOT NULL REFERENCES core.empresa(id) ON DELETE CASCADE,
  unidade_id INT NOT NULL REFERENCES core.unidade(id) ON DELETE CASCADE,
  fila_id INT NOT NULL REFERENCES agenda.fila_espera(id) ON DELETE CASCADE,
  profissional_id INT NOT NULL REFERENCES agenda.profissional(id) ON DELETE CASCADE,
  servico_id INT NOT NULL REFERENCES agenda.servico(id) ON DELETE CASCADE,
  slot_inicio TIMESTAMPTZ NOT NULL,
  slot_fim TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) DEFAULT 'enviada' CHECK (status IN ('enviada','aceita','recusada','expirada')),
  expira_em TIMESTAMPTZ,
  respondida_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  CHECK (slot_fim > slot_inicio)
);
CREATE INDEX idx_oferta_status_expira ON agenda.oferta_fila(status, expira_em);
CREATE INDEX idx_oferta_fila ON agenda.oferta_fila(fila_id, created_at);

-- =================== INTEGRACOES ===================
CREATE TABLE integracoes.conversa_estado (
  id SERIAL PRIMARY KEY,
  empresa_id INT NOT NULL REFERENCES core.empresa(id) ON DELETE CASCADE,
  unidade_id INT NOT NULL REFERENCES core.unidade(id) ON DELETE CASCADE,
  canal_id INT NOT NULL REFERENCES core.canal_whatsapp(id) ON DELETE CASCADE,
  cliente_id INT NOT NULL REFERENCES crm.cliente(id) ON DELETE CASCADE,
  estado VARCHAR(30) DEFAULT 'idle' CHECK (estado IN ('idle','coletando_dados','mostrando_horarios','aguardando_escolha','aguardando_confirmacao','aguardando_profissional','em_fila','oferta_pendente')),
  intencao_id INT REFERENCES agenda.intencao_agendamento(id) ON DELETE SET NULL,
  oferta_id INT REFERENCES agenda.oferta_fila(id) ON DELETE SET NULL,
  ultima_lista JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(empresa_id, canal_id, cliente_id)
);
CREATE INDEX idx_conversa_lookup ON integracoes.conversa_estado(empresa_id, canal_id, cliente_id);

CREATE TABLE integracoes.whatsapp_mensagem (
  id SERIAL PRIMARY KEY,
  empresa_id INT NOT NULL REFERENCES core.empresa(id) ON DELETE CASCADE,
  unidade_id INT NOT NULL REFERENCES core.unidade(id) ON DELETE CASCADE,
  canal_id INT NOT NULL REFERENCES core.canal_whatsapp(id) ON DELETE CASCADE,
  cliente_id INT REFERENCES crm.cliente(id) ON DELETE SET NULL,
  direcao VARCHAR(3) NOT NULL CHECK (direcao IN ('in','out')),
  message_id VARCHAR(100),
  message_type VARCHAR(50),
  texto TEXT,
  payload JSONB,
  cliente_whatsapp VARCHAR(30),
  from_me VARCHAR(10),
  remote_jid VARCHAR(100),
  instance VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX idx_whatsapp_mensagem_dedup_inbound ON integracoes.whatsapp_mensagem(message_id) WHERE message_id IS NOT NULL AND direcao = 'in';
CREATE INDEX idx_whatsapp_mensagem_outbound_message_id ON integracoes.whatsapp_mensagem(message_id) WHERE direcao = 'out' AND message_id IS NOT NULL;
CREATE INDEX idx_msg_lookup ON integracoes.whatsapp_mensagem(empresa_id, canal_id, created_at);

CREATE TABLE integracoes.migracao_aplicada (
  nome VARCHAR(200) PRIMARY KEY,
  aplicada_em TIMESTAMPTZ DEFAULT now()
);

-- Triggers updated_at
CREATE OR REPLACE FUNCTION core.set_updated_at() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

DO $$ 
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'core.empresa','core.unidade','core.canal_whatsapp',
    'crm.cliente','agenda.servico','agenda.profissional',
    'agenda.intencao_agendamento','agenda.agendamento',
    'integracoes.conversa_estado'
  ]) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_updated_at ON %s', t);
    EXECUTE format('CREATE TRIGGER trg_updated_at BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION core.set_updated_at()', t);
  END LOOP;
END $$;
