-- ============================================================
-- Migration 006: Garante que o canal default aponte para a
-- instance_key correta da Evolution.
-- ============================================================
-- Idempotente: se já existir canal com 'Kodigo - Teste', desativa
-- o 'barbearia_teste' antigo (sem violar a UNIQUE de instance_key).
-- ============================================================

DO $$
DECLARE
  v_target TEXT := 'Kodigo - Teste';
  v_legacy TEXT := 'barbearia_teste';
  v_target_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM core.canal_whatsapp
     WHERE instance_key = v_target AND ativo = true
  ) INTO v_target_exists;

  IF v_target_exists THEN
    -- Já existe canal correto. Desativa qualquer 'barbearia_teste' órfão.
    UPDATE core.canal_whatsapp
       SET ativo = false,
           updated_at = now()
     WHERE instance_key = v_legacy;
  ELSE
    -- Não existe ainda — promove o legado.
    UPDATE core.canal_whatsapp
       SET instance_key = v_target,
           updated_at   = now()
     WHERE instance_key = v_legacy
       AND provedor     = 'evolution';
  END IF;
END
$$;

-- Verificação
SELECT id, empresa_id, unidade_id, numero_e164, provedor, instance_key, ativo
  FROM core.canal_whatsapp
 ORDER BY ativo DESC, updated_at DESC;
