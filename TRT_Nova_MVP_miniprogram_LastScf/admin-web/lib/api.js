import { buildOverviewMetrics } from './metrics.js';

async function fetchJson(url, options = {}) {
  if (typeof fetch !== 'function') {
    throw new Error('fetch is unavailable');
  }

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      ...options.headers
    },
    ...options
  });

  if (!response.ok) {
    throw new Error(`request failed: ${response.status}`);
  }

  return response.json();
}

export function createAdminApi({ baseUrl = '/admin' } = {}) {
  return {
    async getOverview() {
      try {
        const result = await fetchJson(`${baseUrl}/shell`);
        return Array.isArray(result.metrics) ? result.metrics : buildOverviewMetrics();
      } catch {
        return buildOverviewMetrics();
      }
    }
  };
}
