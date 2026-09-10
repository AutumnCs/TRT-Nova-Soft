const AGENT_DISCLAIMER = '建议基于现有档案、养护记录、已发布知识和可见迹象生成，仅供养护参考；请以植物现场状态为准。';
const READ_ONLY_CAPABILITIES = [
  'get_user_display_name',
  'get_plant_pet_profile',
  'get_care_history',
  'get_published_knowledge',
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
