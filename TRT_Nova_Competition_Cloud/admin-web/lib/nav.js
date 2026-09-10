export function buildAdminNav() {
  return [
    { id: 'overview', label: '总览', description: '查看首版管理台入口与关键指标。', href: '#overview' },
    { id: 'knowledge', label: '知识库', description: '管理文章、发布状态与后续内容流转。', href: '#knowledge' },
    { id: 'devices', label: '设备', description: '查看设备清单与运行状态。', href: '#devices' },
    { id: 'users', label: '用户', description: '查看用户与账号运营信息。', href: '#users' },
    { id: 'logs', label: '日志', description: '检查管理员操作与系统运行记录。', href: '#logs' }
  ];
}
