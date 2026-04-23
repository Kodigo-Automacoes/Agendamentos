-- ============================================================
-- Migration 006: Garante que o canal default aponte para a
-- instance_key correta da Evolution.
-- ============================================================
-- Contexto: o seed inicial criava o canal com instance_key='barbearia_teste',
-- mas a instância real na Evolution se chama 'Kodigo - Teste'.
-- Sem isso, o webhook não acha o canal e o auto-provision falha
-- com "null value in column numero_e164".
--
-- Idempotente: roda quantas vezes quiser.
-- ============================================================

UPDATE core.canal_whatsapp
   SET instance_key = 'Kodigo - Teste',
       updated_at   = now()
 WHERE instance_key = 'barbearia_teste'
   AND provedor     = 'evolution';

-- Verificação
SELECT id, empresa_id, unidade_id, numero_e164, provedor, instance_key, ativo
  FROM core.canal_whatsapp
 ORDER BY updated_at DESC;
