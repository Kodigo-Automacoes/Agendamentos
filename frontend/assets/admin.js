// assets/admin.js — Painel Super Admin (dono do SaaS)
// ============================================================
// Substitui os mocks estáticos do HTML do Admin por dados reais
// de /api/admin/*. Mantém o design do protótipo.
// ============================================================

(function () {
  const api = window.KodigoAPI;
  if (!api) return;

  const state = {
    stats: null,
    empresas: [],
    usuarios: [],
  };

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function initials(nome) {
    if (!nome) return '??';
    const parts = String(nome).trim().split(/\s+/);
    return ((parts[0]?.[0] || '') + (parts[parts.length - 1]?.[0] || '')).toUpperCase();
  }

  function renderStats() {
    const s = state.stats;
    if (!s) return;
    const row = document.querySelector('#screen-dashboard .stats-row');
    if (!row) return;
    row.innerHTML = `
      <div class="stat-card" style="--card-accent:var(--accent)">
        <div class="stat-label">Empresas ativas</div>
        <div class="stat-value" style="color:var(--accent)">${s.empresas_ativas}</div>
        <div class="stat-delta">${s.empresas_total} cadastradas no total</div>
      </div>
      <div class="stat-card" style="--card-accent:var(--purple)">
        <div class="stat-label">Agendamentos / mês</div>
        <div class="stat-value" style="color:var(--purple)">${s.agendamentos_mes}</div>
        <div class="stat-delta">No mês atual</div>
      </div>
      <div class="stat-card" style="--card-accent:var(--yellow)">
        <div class="stat-label">Clientes (CRM)</div>
        <div class="stat-value" style="color:var(--yellow)">${s.clientes_total}</div>
        <div class="stat-delta">Em todas empresas</div>
      </div>
      <div class="stat-card" style="--card-accent:var(--red)">
        <div class="stat-label">Canais WhatsApp</div>
        <div class="stat-value" style="color:var(--red)">${s.canais_ativos}/${s.canais_total}</div>
        <div class="stat-delta">${s.canais_ativos} ativos</div>
      </div>`;
  }

  function renderEmpresas() {
    const tbody = document.querySelector('#screen-empresas .data-table tbody') ||
                  document.querySelector('#screen-empresas table tbody');
    if (!tbody) return;
    if (!state.empresas.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:24px">Nenhuma empresa cadastrada.</td></tr>`;
      return;
    }
    tbody.innerHTML = state.empresas.map((e) => `
      <tr data-empresa-id="${esc(e.id)}">
        <td>
          <div style="display:flex;align-items:center;gap:10px">
            <div style="width:32px;height:32px;border-radius:6px;background:linear-gradient(135deg,var(--purple),var(--accent));display:flex;align-items:center;justify-content:center;color:#07090e;font-weight:800">${esc(initials(e.nome))}</div>
            <div>
              <div style="font-weight:600">
                <span style="font-family:'Plus Jakarta Sans',sans-serif;color:var(--text3);font-size:12px;margin-right:6px">#${esc(e.codigo ?? '')}</span>
                ${esc(e.nome)}
              </div>
              <div style="font-size:11px;color:var(--text3)">${esc(e.email || '—')}</div>
            </div>
          </div>
        </td>
        <td>${esc(e.unidades)} unidade(s)</td>
        <td>${esc(e.profissionais)}</td>
        <td>${esc(e.agendamentos_mes)}</td>
        <td>${esc(e.canais_ativos)} ativo(s)</td>
        <td>${e.ativo
          ? '<span class="badge-green">Ativa</span>'
          : '<span class="badge-gray">Inativa</span>'}</td>
        <td>
          <div class="actions">
            <button class="action-btn" onclick="window.KodigoAdmin.editEmpresa('${esc(e.id)}')">Editar</button>
            <button class="action-btn ${e.ativo ? 'danger' : ''}" onclick="window.KodigoAdmin.toggleEmpresa('${esc(e.id)}', ${!e.ativo})">${e.ativo ? 'Desativar' : 'Reativar'}</button>
          </div>
        </td>
      </tr>`).join('');
  }

  function renderUsuarios() {
    const tbody = document.querySelector('#screen-usuarios .data-table tbody') ||
                  document.querySelector('#screen-usuarios table tbody');
    if (!tbody) return;
    if (!state.usuarios.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:24px">Nenhum usuário cadastrado.</td></tr>`;
      return;
    }
    tbody.innerHTML = state.usuarios.map((u) => `
      <tr data-usuario-id="${esc(u.id)}">
        <td>
          <div style="display:flex;align-items:center;gap:10px">
            <div style="width:30px;height:30px;border-radius:50%;background:var(--purple-dim);color:var(--purple);display:flex;align-items:center;justify-content:center;font-weight:700">${esc(initials(u.auth_user_id))}</div>
            <div>
              <div style="font-weight:600">${esc(u.auth_user_id)}</div>
            </div>
          </div>
        </td>
        <td>${esc(u.empresa_nome || '—')}</td>
        <td><span class="badge-${u.perfil === 'super_admin' ? 'red' : (u.perfil === 'gerente' ? 'yellow' : 'purple')}">${esc(u.perfil)}</span></td>
        <td>${u.updated_at ? new Date(u.updated_at).toLocaleDateString('pt-BR') : '—'}</td>
        <td>${u.ativo ? '<span class="badge-green">Ativo</span>' : '<span class="badge-gray">Inativo</span>'}</td>
        <td>
          <div class="actions">
            <button class="action-btn">Editar</button>
            <button class="action-btn danger">Revogar</button>
          </div>
        </td>
      </tr>`).join('');
  }

  window.KodigoAdmin = {
    async editEmpresa(id) {
      const e = state.empresas.find((x) => x.id === id);
      if (!e) return;
      const title = document.querySelector('#modal-empresa .modal-title');
      if (title) title.textContent = 'Editar empresa';
      const modal = document.getElementById('modal-empresa');
      if (modal) modal.dataset.entityId = id;
      window.openModal && window.openModal('modal-empresa');
    },
    async toggleEmpresa(id, ativar) {
      if (!confirm(ativar ? 'Reativar empresa?' : 'Desativar empresa?')) return;
      await api.put(`/api/admin/empresas/${id}`, { ativo: ativar });
      await loadEmpresas();
    },
  };

  async function loadStats() {
    state.stats = await api.get('/api/admin/dashboard/stats');
    renderStats();
  }
  async function loadEmpresas() {
    state.empresas = await api.get('/api/admin/empresas');
    renderEmpresas();
  }
  async function loadUsuarios() {
    state.usuarios = await api.get('/api/admin/usuarios');
    renderUsuarios();
  }

  async function boot() {
    try {
      await Promise.all([loadStats(), loadEmpresas(), loadUsuarios()]);
    } catch (err) {
      console.error('[KodigoAdmin] boot error', err);
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
