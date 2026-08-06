import { createHttpResponder, getRequestPath, getRequestMethod, json } from './http.js';

export function buildShellPayload() {
  return {
    metrics: [
      { id: 'knowledge', label: '知识文章', value: '12', hint: '首版先展示内容管理入口' },
      { id: 'devices', label: '在线设备', value: '8', hint: '后续接入实时设备摘要' },
      { id: 'users', label: '活跃用户', value: '24', hint: '后续改为真实用户统计' },
      { id: 'logs', label: '今日日志', value: '31', hint: '保留给审计与运维视图' }
    ]
  };
}

function getBody(event = {}) {
  if (event.body && typeof event.body === 'object') return event.body;
  if (typeof event.body === 'string') {
    try {
      return JSON.parse(event.body);
    } catch {
      return {};
    }
  }
  return {};
}

export function createAdminRouter({ auth, knowledge, devices, users, logs }) {
  void knowledge;
  void devices;
  void users;
  void logs;
  const http = createHttpResponder();

  return {
    async handle(event = {}) {
      const method = getRequestMethod(event);
      const path = getRequestPath(event);

      if (path === '/health' && method === 'GET') {
        return json(200, { ok: true, service: 'admin-scf' });
      }

      const session = await auth.authenticate(event);
      if (!session.ok) {
        return http.unauthorized();
      }

      if (path === '/shell' && method === 'GET') {
        return json(200, buildShellPayload());
      }

      if (path === '/knowledge/articles' && method === 'GET') {
        return json(200, await knowledge.listArticles({ includeDrafts: true }));
      }

      if (path === '/knowledge/article' && method === 'GET') {
        return json(200, await knowledge.getArticle(getBody(event).idOrSlug));
      }

      if (path === '/knowledge/articles' && method === 'POST') {
        return json(200, await knowledge.saveArticle(getBody(event)));
      }

      if (path === '/knowledge/articles' && method === 'DELETE') {
        return json(200, await knowledge.deleteArticle(getBody(event).idOrSlug));
      }

      if (path === '/devices' && method === 'GET') {
        return json(200, await devices.getSummary(getBody(event)));
      }

      if (path === '/users' && method === 'GET') {
        return json(200, await users.listUsers(getBody(event)));
      }

      if (path === '/logs' && method === 'GET') {
        return json(200, await logs.listLogs(getBody(event)));
      }

      return http.notFound();
    }
  };
}
