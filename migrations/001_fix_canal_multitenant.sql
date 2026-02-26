-- ============================================================
-- Migration 001: Fix multi-tenant canal resolution
-- ============================================================
-- Problema: Com UNIQUE(empresa_id, numero_e164), o mesmo número pode existir
-- em empresas diferentes. resolver_canal_whatsapp precisa priorizar instance_key
-- (globalmente único por instância Evolution) para isolamento correto de tenant.
-- ============================================================

-- 1) Garantir que instance_key seja globalmente único (quando não-nulo)
CREATE UNIQUE INDEX IF NOT EXISTS idx_canal_whatsapp_instance_key
  ON core.canal_whatsapp (instance_key)
  WHERE instance_key IS NOT NULL;

-- 2) Recriar função de resolução com prioridade correta
CREATE OR REPLACE FUNCTION core.resolver_canal_whatsapp(
  p_numero_e164   TEXT    DEFAULT NULL,
  p_provedor      TEXT    DEFAULT NULL,
  p_instance_key  TEXT    DEFAULT NULL
)
RETURNS TABLE(canal_id UUID, empresa_id UUID, unidade_id UUID)
LANGUAGE plpgsql STABLE AS $$
BEGIN
  -- Prioridade 1: instance_key (globalmente único por instância Evolution)
  -- É o discriminador mais seguro em ambiente multi-tenant
  IF p_instance_key IS NOT NULL THEN
    RETURN QUERY
      SELECT c.id AS canal_id, c.empresa_id, c.unidade_id
      FROM core.canal_whatsapp c
      WHERE c.instance_key = p_instance_key
        AND c.ativo = true
      LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- Prioridade 2: numero + provedor (ainda pode ser ambíguo entre empresas)
  IF p_numero_e164 IS NOT NULL AND p_provedor IS NOT NULL THEN
    RETURN QUERY
      SELECT c.id AS canal_id, c.empresa_id, c.unidade_id
      FROM core.canal_whatsapp c
      WHERE c.numero_e164 = p_numero_e164
        AND c.provedor    = p_provedor
        AND c.ativo = true
      LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- Prioridade 3: apenas numero (fallback legado — arriscado em multi-tenant)
  IF p_numero_e164 IS NOT NULL THEN
    RETURN QUERY
      SELECT c.id AS canal_id, c.empresa_id, c.unidade_id
      FROM core.canal_whatsapp c
      WHERE c.numero_e164 = p_numero_e164
        AND c.ativo = true
      LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- Nenhum canal encontrado
  RETURN;
END;
$$;

-- 3) Recriar função de upsert com isolamento correto
CREATE OR REPLACE FUNCTION core.upsert_canal_whatsapp(
  p_empresa_id    UUID,
  p_unidade_id    UUID,
  p_provedor      TEXT,
  p_instance_key  TEXT,
  p_numero_e164   TEXT
)
RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
  v_canal_id UUID;
BEGIN
  -- Tentar encontrar por instance_key (globalmente único)
  IF p_instance_key IS NOT NULL THEN
    SELECT id INTO v_canal_id
    FROM core.canal_whatsapp
    WHERE instance_key = p_instance_key;

    IF FOUND THEN
      UPDATE core.canal_whatsapp
      SET numero_e164 = COALESCE(p_numero_e164, numero_e164),
          provedor    = COALESCE(p_provedor, provedor),
          updated_at  = now()
      WHERE id = v_canal_id;
      RETURN v_canal_id;
    END IF;
  END IF;

  -- Tentar por empresa_id + numero (dentro do mesmo tenant)
  IF p_numero_e164 IS NOT NULL THEN
    SELECT id INTO v_canal_id
    FROM core.canal_whatsapp
    WHERE empresa_id  = p_empresa_id
      AND numero_e164 = p_numero_e164;

    IF FOUND THEN
      UPDATE core.canal_whatsapp
      SET instance_key = COALESCE(p_instance_key, instance_key),
          provedor     = COALESCE(p_provedor, provedor),
          updated_at   = now()
      WHERE id = v_canal_id;
      RETURN v_canal_id;
    END IF;
  END IF;

  -- Inserir novo canal
  INSERT INTO core.canal_whatsapp (empresa_id, unidade_id, provedor, instance_key, numero_e164)
  VALUES (p_empresa_id, p_unidade_id, p_provedor, p_instance_key, p_numero_e164)
  RETURNING id INTO v_canal_id;

  RETURN v_canal_id;
END;
$$;
