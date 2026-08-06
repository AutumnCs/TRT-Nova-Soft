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

      return http.notFound();
    }
  };
}
