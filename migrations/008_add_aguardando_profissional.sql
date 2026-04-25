-- ============================================================
-- Migration 008: Adicionar estado 'aguardando_profissional' ao CHECK
-- ============================================================
-- O código em message.routes.js usa o estado 'aguardando_profissional'
-- quando há mais de um profissional disponível para o serviço, mas
-- o constraint original não incluía esse valor, causando erro silencioso
-- que impedia o bot de responder.
-- ============================================================

ALTER TABLE integracoes.conversa_estado
DROP CONSTRAINT IF EXISTS conversa_estado_estado_check;

ALTER TABLE integracoes.conversa_estado
ADD CONSTRAINT conversa_estado_estado_check
CHECK (estado::text = ANY(ARRAY[
  'idle',
  'coletando_dados',
  'mostrando_horarios',
  'aguardando_escolha',
  'aguardando_confirmacao',
  'aguardando_profissional',
  'em_fila',
  'oferta_pendente'
]::text[]));
