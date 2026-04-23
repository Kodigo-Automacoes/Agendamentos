// assets/app.js — Painel do Cliente (dono da empresa)
// ============================================================
// Substitui os mocks estáticos do HTML pelos dados reais vindos
// de /api/app/*. O CSS / layout permanece o do design original.
// ============================================================

(function () {
  const api = window.KodigoAPI;
  if (!api) return;

  const state = {
    ctx: null,           // { empresa, unidade, timezone }
    servicos: [],
    profissionais: [],
    clientes: [],
    agendamentosHoje: [],
    stats: null,
  };

  // Paleta de cores por índice (para serviços / profissionais sem cor cadastrada)
  const PALETTE = [
    { name: 'accent', bg: 'rgba(78,204,163,.12)', fg: 'var(--accent)' },
    { name: 'purple', bg: 'rgba(123,110,246,.12)', fg: 'var(--purple)' },
    { name: 'yellow', bg: 'rgba(251,191,36,.12)', fg: 'var(--yellow)' },
    { name: 'red', bg: 'rgba(248,113,113,.12)', fg: 'var(--red)' },
  ];

  const STATUS_BADGE = {
    confirmado: { label: 'Confirmado', cls: 'badge-green' },
    em_andamento: { label: 'Em andamento', cls: 'badge-purple' },
    aguardando: { label: 'Aguardando', cls: 'badge-yellow' },
    cancelado: { label: 'Cancelado', cls: 'badge-red' },
    livre: { label: 'Disponível', cls: 'badge-gray' },
  };

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function formatCurrency(v) {
    const n = Number(v || 0);
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function formatHourFromISO(iso, tz = 'America/Sao_Paulo') {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString('pt-BR', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
    });
  }

  function initials(nome) {
    if (!nome) return '??';
    const parts = String(nome).trim().split(/\s+/);
    const a = parts[0]?.[0] || '';
    const b = parts[parts.length - 1]?.[0] || '';
    return (a + b).toUpperCase();
  }

  function diffMinutes(iniISO, fimISO) {
    if (!iniISO || !fimISO) return 0;
    return Math.round((new Date(fimISO) - new Date(iniISO)) / 60000);
  }

  // ---------------- Render ----------------

  function renderTopbar() {
    const nome = state.ctx?.empresa?.nome || '';
    const unidade = state.ctx?.unidade?.nome || '';
    const bizName = document.querySelector('.biz-name');
    if (bizName && nome) bizName.textContent = nome;
    const bizAvatar = document.querySelector('.biz-avatar');
    if (bizAvatar && nome) bizAvatar.textContent = initials(nome);
    const bizPlan = document.querySelector('.biz-plan');
    if (bizPlan && unidade) bizPlan.textContent = `Unidade ${unidade}`;
    const topbarDate = document.querySelector('.topbar-date');
    if (topbarDate) {
      topbarDate.textContent = new Date().toLocaleDateString('pt-BR', {
        weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
      });
    }
  }

  function renderDashboardStats() {
    const s = state.stats;
    if (!s) return;
    const statsRow = document.querySelector('#screen-dashboard .stats-row');
    if (!statsRow) return;
    statsRow.innerHTML = `
      <div class="stat-card" style="--card-accent: var(--accent)">
        <div class="stat-label">Hoje</div>
        <div class="stat-value" style="color:var(--accent)">${s.agendamentos_hoje}</div>
        <div class="stat-delta">Agendamentos confirmados</div>
      </div>
      <div class="stat-card" style="--card-accent: var(--purple)">
        <div class="stat-label">Semana</div>
        <div class="stat-value" style="color:var(--purple)">${s.agendamentos_semana}</div>
        <div class="stat-delta">Nos próximos 7 dias</div>
      </div>
      <div class="stat-card" style="--card-accent: var(--yellow)">
        <div class="stat-label">Fila de espera</div>
        <div class="stat-value" style="color:var(--yellow)">${s.fila_espera}</div>
        <div class="stat-delta">Clientes aguardando</div>
      </div>
      <div class="stat-card" style="--card-accent: var(--red)">
        <div class="stat-label">Cancelamentos</div>
        <div class="stat-value" style="color:var(--red)">${s.cancelamentos_mes}</div>
        <div class="stat-delta">Este mês</div>
      </div>
    `;
  }

  function renderAgendaHoje() {
    const slotsBox = document.querySelector('#screen-dashboard .day-slots');
    if (!slotsBox) return;
    const tz = state.ctx?.timezone || 'America/Sao_Paulo';
    const list = state.agendamentosHoje;
    if (!list.length) {
      slotsBox.innerHTML = `
        <div class="day-slot" style="opacity:.6">
          <div class="slot-info">
            <div class="slot-service" style="color:var(--text2)">Nenhum agendamento para hoje</div>
          </div>
        </div>`;
      return;
    }
    slotsBox.innerHTML = list.map((a) => {
      const badge = STATUS_BADGE[a.status] || STATUS_BADGE.confirmado;
      const dur = diffMinutes(a.inicio, a.fim);
      const cor = a.status === 'confirmado' ? 'var(--accent)'
                : a.status === 'em_andamento' ? 'var(--purple)'
                : a.status === 'cancelado' ? 'var(--red)'
                : 'var(--yellow)';
      const pal = PALETTE[Math.abs((a.cliente_nome || '').length) % PALETTE.length];
      return `
        <div class="day-slot" data-agendamento-id="${esc(a.id)}">
          <div class="slot-time-block">
            <div class="slot-time-val">${esc(formatHourFromISO(a.inicio, tz))}</div>
            <div class="slot-time-dur">${dur}min</div>
          </div>
          <div class="slot-bar" style="background:${cor}"></div>
          <div class="slot-info">
            <div class="slot-client">${esc(a.cliente_nome || 'Cliente')}</div>
            <div class="slot-service">${esc(a.servico_nome || '')}</div>
            <div class="slot-professional">${esc(a.profissional_nome || '')}</div>
          </div>
          <div class="slot-avatar" style="background:${pal.bg};color:${pal.fg}">${esc(initials(a.cliente_nome))}</div>
          <div class="slot-status-badge ${badge.cls}">${badge.label}</div>
        </div>`;
    }).join('');
  }

  function renderServicos() {
    const screen = document.getElementById('screen-servicos');
    if (!screen) return;
    const grid = screen.querySelector('.services-grid') || screen.querySelector('[style*="grid"]');
    if (!grid) return;
    const cards = state.servicos.map((s, i) => {
      const pal = PALETTE[i % PALETTE.length];
      return `
        <div class="service-card" style="--sc-color:var(${'--' + pal.name})" data-servico-id="${esc(s.id)}">
          <div class="service-title">${esc(s.nome)}</div>
          <div class="service-tags">
            <span class="service-tag">${esc(s.duracao_padrao_min)} min</span>
            <span class="service-tag">${esc(formatCurrency(s.preco_padrao))}</span>
            ${s.ativo ? '' : '<span class="service-tag" style="color:var(--red)">Inativo</span>'}
          </div>
          <div class="service-desc">${esc(s.descricao || '')}</div>
          <div class="service-actions">
            <button class="btn-sm btn-sm-edit" onclick="window.KodigoApp.editServico('${esc(s.id)}')">Editar</button>
            <button class="btn-sm btn-sm-del" onclick="window.KodigoApp.deleteServico('${esc(s.id)}','${esc(s.nome)}')">Remover</button>
          </div>
        </div>`;
    }).join('');
    const addCard = `
      <div class="add-card" onclick="window.KodigoApp.newServico()">
        <div class="add-icon">+</div>
        <div>Adicionar serviço</div>
      </div>`;
    grid.innerHTML = cards + addCard;
  }

  function renderProfissionais() {
    const screen = document.getElementById('screen-profissionais');
    if (!screen) return;
    const grid = screen.querySelector('.prof-grid') || screen.querySelector('[style*="grid"]');
    if (!grid) return;
    grid.innerHTML = state.profissionais.map((p) => `
      <div class="prof-card" data-prof-id="${esc(p.id)}">
        <div class="prof-avatar" style="background:linear-gradient(135deg, var(--purple), var(--accent));color:#07090e;font-weight:800">
          ${esc(initials(p.nome))}
        </div>
        <div class="prof-info">
          <div class="prof-name">${esc(p.nome)}</div>
          <div class="prof-tags">
            ${(p.servicos || []).map((sv) => `<span class="prof-tag">${esc(sv)}</span>`).join('')}
          </div>
          <div class="prof-stats">
            <div class="prof-stat"><strong>${p.agend_mes ?? 0}</strong> agend./mês</div>
            <div class="prof-stat"><strong>${p.ativo ? 'Ativo' : 'Inativo'}</strong></div>
          </div>
          <div class="prof-actions">
            <button class="btn-sm btn-sm-edit" onclick="window.KodigoApp.editProfissional('${esc(p.id)}')">Editar</button>
            <button class="btn-sm btn-sm-del" onclick="window.KodigoApp.deleteProfissional('${esc(p.id)}','${esc(p.nome)}')">Remover</button>
          </div>
        </div>
      </div>
    `).join('') + `
      <div class="add-card" onclick="window.KodigoApp.newProfissional()" style="min-height:100px">
        <div class="add-icon">+</div>
        <div>Adicionar profissional</div>
      </div>`;
  }

  function renderClientes() {
    const tbody = document.querySelector('#screen-clientes .clients-table tbody');
    if (!tbody) return;
    if (!state.clientes.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="color:var(--text3);text-align:center;padding:24px">Nenhum cliente cadastrado ainda.</td></tr>`;
      return;
    }
    tbody.innerHTML = state.clientes.map((c, i) => {
      const pal = PALETTE[i % PALETTE.length];
      return `
        <tr data-cliente-id="${esc(c.id)}">
          <td>
            <div class="client-cell">
              <div class="client-avatar" style="background:${pal.bg};color:${pal.fg}">${esc(initials(c.nome))}</div>
              <div>
                <div style="font-weight:600">${esc(c.nome || 'Sem nome')}</div>
                <div style="font-size:11px;color:var(--text3)">${c.created_at ? 'Desde ' + new Date(c.created_at).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }) : ''}</div>
              </div>
            </div>
          </td>
          <td style="color:var(--text3);font-size:12px">${esc(c.whatsapp_e164 || '')}</td>
          <td style="font-size:12px">${c.ultima_visita ? new Date(c.ultima_visita).toLocaleDateString('pt-BR') : '—'}</td>
          <td><span style="font-family:'Plus Jakarta Sans',sans-serif;font-size:16px;font-weight:700;color:${pal.fg}">${c.total_visitas ?? 0}</span></td>
          <td style="font-size:12px;color:var(--text3)">${c.ticket_medio ? formatCurrency(c.ticket_medio) : '—'}</td>
          <td><button class="btn-sm btn-sm-edit">Ver histórico</button></td>
        </tr>`;
    }).join('');
  }

  // ---------------- Forms / CRUD ----------------

  function bindModalOpenForEntity(modalId, entity) {
    const modal = document.getElementById(modalId);
    if (!modal) return null;
    modal.dataset.entityId = entity?.id || '';
    return modal;
  }

  async function saveServico() {
    const id = document.getElementById('modal-servico').dataset.entityId || null;
    const body = {
      nome: document.getElementById('input-servico-nome').value.trim(),
      duracao_padrao_min: Number(document.getElementById('input-servico-duracao').value) || 30,
      preco_padrao: Number(String(document.getElementById('input-servico-preco').value).replace(',', '.')) || 0,
    };
    if (!body.nome) return alert('Informe o nome do serviço.');
    if (id) await api.put(`/api/app/servicos/${id}`, body);
    else await api.post('/api/app/servicos', body);
    closeModalById('modal-servico');
    await loadServicos();
  }

  async function saveProfissional() {
    const id = document.getElementById('modal-profissional').dataset.entityId || null;
    const body = { nome: document.getElementById('input-prof-nome').value.trim() };
    if (!body.nome) return alert('Informe o nome do profissional.');
    if (id) await api.put(`/api/app/profissionais/${id}`, body);
    else await api.post('/api/app/profissionais', body);
    closeModalById('modal-profissional');
    await loadProfissionais();
  }

  function closeModalById(id) {
    const m = document.getElementById(id);
    if (!m) return;
    m.classList.remove('open');
    document.body.style.overflow = '';
  }

  window.KodigoApp = {
    newServico() {
      const title = document.getElementById('modal-servico-title');
      if (title) title.textContent = 'Novo serviço';
      ['input-servico-nome', 'input-servico-duracao', 'input-servico-preco'].forEach((id) => {
        const el = document.getElementById(id); if (el) el.value = '';
      });
      bindModalOpenForEntity('modal-servico', null);
      window.openModal && window.openModal('modal-servico');
    },
    editServico(id) {
      const s = state.servicos.find((x) => x.id === id);
      if (!s) return;
      const title = document.getElementById('modal-servico-title');
      if (title) title.textContent = 'Editar serviço';
      document.getElementById('input-servico-nome').value = s.nome || '';
      document.getElementById('input-servico-duracao').value = s.duracao_padrao_min || 30;
      document.getElementById('input-servico-preco').value = s.preco_padrao || 0;
      bindModalOpenForEntity('modal-servico', s);
      window.openModal && window.openModal('modal-servico');
    },
    async deleteServico(id, nome) {
      if (!confirm(`Remover serviço "${nome}"?`)) return;
      await api.del(`/api/app/servicos/${id}`);
      await loadServicos();
    },
    newProfissional() {
      const title = document.getElementById('modal-prof-title');
      if (title) title.textContent = 'Novo profissional';
      const nome = document.getElementById('input-prof-nome'); if (nome) nome.value = '';
      bindModalOpenForEntity('modal-profissional', null);
      window.openModal && window.openModal('modal-profissional');
    },
    editProfissional(id) {
      const p = state.profissionais.find((x) => x.id === id);
      if (!p) return;
      const title = document.getElementById('modal-prof-title');
      if (title) title.textContent = 'Editar profissional';
      document.getElementById('input-prof-nome').value = p.nome || '';
      bindModalOpenForEntity('modal-profissional', p);
      window.openModal && window.openModal('modal-profissional');
    },
    async deleteProfissional(id, nome) {
      if (!confirm(`Remover profissional "${nome}"?`)) return;
      await api.del(`/api/app/profissionais/${id}`);
      await loadProfissionais();
    },
    saveServico,
    saveProfissional,
    logout() { api.clearApiKey(); location.reload(); },
  };

  // Interceptar os botões "Salvar" dos modais para chamar a API
  function wireModalSaveButtons() {
    // Delegação para botões Salvar com texto "Salvar serviço" / "Salvar profissional"
    document.querySelectorAll('#modal-servico .btn-save').forEach((b) => {
      b.setAttribute('onclick', 'window.KodigoApp.saveServico()');
    });
    document.querySelectorAll('#modal-profissional .btn-save').forEach((b) => {
      b.setAttribute('onclick', 'window.KodigoApp.saveProfissional()');
    });
  }

  // ---------------- Fetch helpers ----------------

  async function loadContext() {
    state.ctx = await api.get('/api/app/context');
  }
  async function loadStats() {
    state.stats = await api.get('/api/app/dashboard/stats');
  }
  async function loadAgendamentosHoje() {
    state.agendamentosHoje = await api.get('/api/app/agendamentos?range=hoje');
  }
  async function loadServicos() {
    state.servicos = await api.get('/api/app/servicos');
    renderServicos();
  }
  async function loadProfissionais() {
    state.profissionais = await api.get('/api/app/profissionais');
    renderProfissionais();
  }
  async function loadClientes() {
    state.clientes = await api.get('/api/app/clientes');
    renderClientes();
  }

  // ---------------- Boot ----------------

  async function boot() {
    try {
      await loadContext();
      renderTopbar();
      // Carrega em paralelo os dados do painel
      await Promise.all([
        loadStats().then(renderDashboardStats),
        loadAgendamentosHoje().then(renderAgendaHoje),
        loadServicos(),
        loadProfissionais(),
        loadClientes(),
      ]);
      wireModalSaveButtons();
    } catch (err) {
      console.error('[KodigoApp] boot error', err);
      if (err?.status === 401) {
        api.clearApiKey();
        alert('API key inválida. Recarregue e informe a correta.');
        location.reload();
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
