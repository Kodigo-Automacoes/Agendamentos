// assets/api.js
// Cliente HTTP compartilhado entre os painéis.
// ============================================================
// Autenticação: no MVP usamos a mesma x-api-key do backend, lida de
// localStorage. Em produção substituir por JWT/cookies.
// ============================================================

(function (global) {
  const LS_KEY = 'kodigo.api_key';

  function getApiKey() {
    let k = localStorage.getItem(LS_KEY);
    if (!k) {
      k = window.prompt(
        'Informe a API key (x-api-key) para acessar o painel.\n' +
        'Ela é salva apenas neste navegador.'
      );
      if (k) localStorage.setItem(LS_KEY, k.trim());
    }
    return k;
  }

  function clearApiKey() {
    localStorage.removeItem(LS_KEY);
  }

  async function request(path, options = {}) {
    const apiKey = getApiKey();
    const headers = Object.assign(
      { 'Content-Type': 'application/json', 'x-api-key': apiKey || '' },
      options.headers || {}
    );
    const init = { method: options.method || 'GET', headers };
    if (options.body !== undefined) {
      init.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    }
    const res = await fetch(path, init);
    const text = await res.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = text; }
    }
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} ${path}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  const api = {
    get: (p) => request(p),
    post: (p, body) => request(p, { method: 'POST', body }),
    put: (p, body) => request(p, { method: 'PUT', body }),
    del: (p) => request(p, { method: 'DELETE' }),
    getApiKey,
    clearApiKey,
  };

  global.KodigoAPI = api;
})(window);
