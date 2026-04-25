-- ============================================================
-- Migration 009c: Seed com IDs inteiros
-- ============================================================

-- Empresa
INSERT INTO core.empresa (nome, slug) VALUES ('Kodigo Barbearia', 'kodigo-barbearia');

-- Unidade
INSERT INTO core.unidade (empresa_id, nome) VALUES (1, 'Unidade Principal');

-- Canal WhatsApp (Evolution)
INSERT INTO core.canal_whatsapp (empresa_id, unidade_id, provedor, instance_key, numero_e164)
VALUES (1, 1, 'evolution', 'Kodigo - Teste', '+554898544489');

-- Config unidade
INSERT INTO agenda.config_unidade (unidade_id, timezone, intervalo_entre_atendimentos_min, passo_oferta_min, antecedencia_min, max_dias_futuro)
VALUES (1, 'America/Sao_Paulo', 10, 15, 60, 30);

-- Funcionamento semanal
INSERT INTO agenda.funcionamento_semanal (unidade_id, dow, abre, fecha, ativo) VALUES
  (1, 0, '00:00', '00:01', false),
  (1, 1, '08:00', '18:00', true),
  (1, 2, '08:00', '18:00', true),
  (1, 3, '08:00', '18:00', true),
  (1, 4, '08:00', '18:00', true),
  (1, 5, '08:00', '18:00', true),
  (1, 6, '08:00', '12:00', true);

-- Janelas por período
INSERT INTO agenda.janela_periodo (unidade_id, periodo, inicio, fim) VALUES
  (1, 'manha', '08:00', '12:00'),
  (1, 'tarde', '13:00', '18:00'),
  (1, 'noite', '18:00', '21:00');

-- Pausas (almoço seg-sex)
INSERT INTO agenda.pausa_semanal (unidade_id, dow, inicio, fim) VALUES
  (1, 1, '12:00', '13:00'),
  (1, 2, '12:00', '13:00'),
  (1, 3, '12:00', '13:00'),
  (1, 4, '12:00', '13:00'),
  (1, 5, '12:00', '13:00');

-- Serviços
INSERT INTO agenda.servico (empresa_id, nome, duracao_padrao_min, preco_padrao) VALUES
  (1, 'Corte de cabelo', 30, 40),
  (1, 'Barba', 20, 25);

-- Profissionais
INSERT INTO agenda.profissional (empresa_id, unidade_id, nome) VALUES
  (1, 1, 'Profissional Demo'),
  (1, 1, 'Profissional Seed');

-- Vínculos profissional <-> serviço
INSERT INTO agenda.profissional_servico (empresa_id, unidade_id, profissional_id, servico_id) VALUES
  (1, 1, 1, 1),  -- Demo <-> Corte
  (1, 1, 2, 1),  -- Seed <-> Corte
  (1, 1, 1, 2);  -- Demo <-> Barba

-- Disponibilidade semanal (seg-sab para ambos)
DO $$
DECLARE v_prof INT; v_dow INT;
BEGIN
  FOR v_prof IN 1..2 LOOP
    FOR v_dow IN 1..6 LOOP
      INSERT INTO agenda.disponibilidade_semanal (empresa_id, unidade_id, profissional_id, dia_semana, hora_inicio, hora_fim)
      VALUES (1, 1, v_prof, v_dow, '08:00'::TIME, (CASE WHEN v_dow = 6 THEN '12:00' ELSE '18:00' END)::TIME);
    END LOOP;
  END LOOP;
END $$;

-- Marca migração como aplicada
INSERT INTO integracoes.migracao_aplicada (nome) VALUES ('009_uuid_to_serial') ON CONFLICT DO NOTHING;
