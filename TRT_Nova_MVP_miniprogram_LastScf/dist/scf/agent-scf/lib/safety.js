const AGENT_DISCLAIMER = '建议基于设备数据和养护规则生成，仅供参考；执行设备操作前请以现场情况为准。';
const READ_ONLY_CAPABILITIES = [
  'get_device_snapshot',
  'get_device_history',
  'diagnose_risk',
  'suggest_care'
];

function buildSafetyMeta() {
  return {
    disclaimer: AGENT_DISCLAIMER,
    capabilities: {
      phase: 'read_only_advice',
      readTools: READ_ONLY_CAPABILITIES,
      actionToolsEnabled: false
    },
    actionPolicy: {
      allowActions: false,
      allowControlSuggestions: true,
      requiresUserConfirmation: true
    },
    actions: []
  };
}

module.exports = {
  AGENT_DISCLAIMER,
  READ_ONLY_CAPABILITIES,
  buildSafetyMeta
};
