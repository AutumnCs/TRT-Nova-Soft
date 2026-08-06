import { createAdminApi } from './lib/api.js';
import { buildOverviewMetrics } from './lib/metrics.js';
import { buildAdminNav } from './lib/nav.js';

function renderNav(items) {
  const container = document.querySelector('#admin-nav');
  if (!container) {
    return;
  }

  container.innerHTML = items.map((item, index) => `
    <a class="nav-link${index === 0 ? ' is-active' : ''}" href="${item.href}" data-admin-nav="${item.id}">
      <span class="nav-label">${item.label}</span>
      <span class="nav-description">${item.description}</span>
    </a>
  `).join('');
}

function renderMetrics(metrics) {
  const container = document.querySelector('#overview-metrics');
  if (!container) {
    return;
  }

  container.innerHTML = metrics.map((metric) => `
    <article class="metric-card">
      <p class="metric-label">${metric.label}</p>
      <p class="metric-value">${metric.value}</p>
      <p class="metric-hint">${metric.hint}</p>
    </article>
  `).join('');
}

async function bootstrap() {
  const api = createAdminApi();
  const nav = buildAdminNav();
  const overview = await api.getOverview().catch(() => buildOverviewMetrics());
  renderNav(nav);
  renderMetrics(overview);
}

bootstrap();
