function normalizeDisplayName(input) {
  return typeof input === 'string' ? input.trim() : '';
}

async function loadUserDisplayProfile(db, openid) {
  const [rows] = await db.execute(
    `SELECT nick_name
     FROM users
     WHERE openid = ?
     LIMIT 1`,
    [openid]
  );
  return {
    available: true,
    displayName: normalizeDisplayName(rows[0]?.nick_name)
  };
}

function buildUserIdentityResponse(profile = {}, safetyMeta = {}, scope = {}) {
  const reason = scope.reason === 'nickname_preference' ? 'nickname_preference' : 'personal_identity';
  const displayName = normalizeDisplayName(profile.displayName);
  let summary = '';
  let diagnosis = '';

  if (reason === 'nickname_preference') {
    summary = '可以，我愿意按你喜欢的昵称称呼你。';
    diagnosis = '当前聊天不会自动修改账号资料，也不会把称呼写进 AI 养护记忆。为了让我以后登录后也能稳定使用这个称呼，请在“我的 → 个人资料”里保存昵称；使用昵称即可，不要提供真实姓名、手机号、证件号或账号密码。';
  } else if (profile.available === false) {
    summary = '我暂时没能读取当前账号的昵称。';
    diagnosis = '请稍后再试，或者到“我的 → 个人资料”检查昵称。昵称只用于账号称呼，不代表我知道你的真实身份；也不要在聊天中提供手机号、证件号或账号密码。';
  } else if (displayName) {
    summary = `当前账号资料里显示的昵称是「${displayName}」。`;
    diagnosis = '我可以这样称呼你。这个昵称只代表植宠账号里的称呼，不等于我知道你的真实身份；也不要在聊天中提供手机号、证件号或账号密码。';
  } else {
    summary = '当前账号资料还没有设置昵称。';
    diagnosis = '你可以到“我的 → 个人资料”设置一个希望我使用的称呼。使用昵称即可，不必填写真实姓名，也不要在聊天中提供手机号、证件号或账号密码。';
  }

  return {
    success: true,
    intent: { type: reason === 'nickname_preference' ? 'nickname_preference' : 'user_identity', name: reason },
    scope: { status: 'in_scope', reason, domain: 'account_profile' },
    summary,
    diagnosis,
    facts: [],
    suggestions: [],
    followUpQuestions: [],
    riskLevel: 'low',
    sources: [],
    taskSuggestions: [],
    ...safetyMeta,
    disclaimer: ''
  };
}

module.exports = {
  normalizeDisplayName,
  loadUserDisplayProfile,
  buildUserIdentityResponse
};
