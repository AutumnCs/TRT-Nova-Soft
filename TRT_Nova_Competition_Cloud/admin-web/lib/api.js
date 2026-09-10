import { buildOverviewMetrics } from './metrics.js';

const TOKEN_KEY = 'trt_nova_admin_token';

function getStorage() {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

async function fetchJson(url, options = {}) {
  const token = getStorage()?.getItem(TOKEN_KEY) || '';
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    },
    ...options
  });

  if (!response.ok) {
    if (response.status === 401) getStorage()?.removeItem(TOKEN_KEY);
    throw new Error(`request failed: ${response.status}`);
  }
  return response.status === 204 ? {} : response.json();
}

export function createAdminApi({ baseUrl = globalThis.__ADMIN_API_BASE_URL__ || '/admin' } = {}) {
  const request = (path, options = {}) => fetchJson(`${baseUrl.replace(/\/$/, '')}${path}`, options);

  return {
    async login(username, password) {
      const result = await request('/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      getStorage()?.setItem(TOKEN_KEY, result.token);
      return result;
    },
    hasSession() {
      return Boolean(getStorage()?.getItem(TOKEN_KEY));
    },
    logout() {
      getStorage()?.removeItem(TOKEN_KEY);
    },
    async getOverview() {
      try {
        const result = await request('/shell');
        return Array.isArray(result.metrics) ? result.metrics : buildOverviewMetrics();
      } catch {
        return buildOverviewMetrics();
      }
    }
  };
}
