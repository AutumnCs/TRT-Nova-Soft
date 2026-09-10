import { createAdminApi } from './lib/api.js';
import { buildOverviewMetrics } from './lib/metrics.js';
import { buildAdminNav } from './lib/nav.js';
import { renderDevicesPage } from './pages/devices.js';
import { renderUsersPage } from './pages/users.js';
import { renderLogsPage } from './pages/logs.js';

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

function renderPage(item) {
  const container = document.querySelector('#admin-page');
  if (!container) return;
  if (item.id === 'devices') return renderDevicesPage(container);
  if (item.id === 'users') return renderUsersPage(container);
  if (item.id === 'logs') return renderLogsPage(container);
  container.innerHTML = '<h2>运营总览</h2><p>选择左侧模块查看管理数据。</p>';
}

async function bootstrap() {
  const api = createAdminApi();
  const loginPanel = document.querySelector('#login-panel');
  const content = document.querySelector('#admin-content');
  if (!api.hasSession()) {
    loginPanel.hidden = false;
    content.hidden = true;
    document.querySelector('#login-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      try {
        await api.login(form.get('username'), form.get('password'));
        window.location.reload();
      } catch {
        document.querySelector('#login-error').textContent = '登录失败，请检查账号或密码。';
      }
    });
    return;
  }
  const nav = buildAdminNav();
  const overview = await api.getOverview().catch(() => buildOverviewMetrics());
  renderNav(nav);
  renderMetrics(overview);
  renderPage(nav[0]);
  document.querySelectorAll('[data-admin-nav]').forEach((link) => {
    link.addEventListener('click', () => {
      const item = nav.find((entry) => entry.id === link.dataset.adminNav);
      if (item) renderPage(item);
    });
  });
}

bootstrap();
