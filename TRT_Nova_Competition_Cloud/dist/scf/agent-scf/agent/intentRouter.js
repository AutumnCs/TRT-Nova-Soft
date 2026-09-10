const SOCIAL_PATTERN = /^(你好|您好|hi|hello|嗨|在吗|谢谢|感谢|再见|拜拜|晚安)[呀啊哦吗呢]*$/i;
const CAPABILITY_PATTERN = /^(你是谁|介绍一下你自己|介绍一下|你能做什么|你会什么|你的职责是什么|怎么使用你|怎么用你)[？?！!。\s]*$/;
const USER_IDENTITY_PATTERN = /^(?:我是谁|你知道我是谁吗|你知道我叫什么吗|你还认识我吗|你(?:还)?记得我(?:是谁)?吗|你知道我的昵称吗|你(?:怎么|该怎么)称呼我|我叫什么(?:名字)?|我的(?:名字|昵称)是什么)(?:呀|啊|呢|嘛)?[？?！!。\s]*$/;
const NICKNAME_PREFERENCE_PATTERN = /^(?:(?:请|麻烦你?)\s*)?(?:(?:记住|记得)\s*)?(?:(?:以后|今后)\s*)?(?:(?:你)?(?:可以|就|请)\s*)?(?:我(?:的名字|的昵称)?叫|我(?:的名字|的昵称)?是|叫我|称呼我(?:为)?)\s*[^\s，,。！？!?]{1,32}[？?！!。\s]*$/;
const PLANT_ANCHOR_PATTERN = /(植物|植宠|花卉|盆栽|植株|花盆|盆土|土壤|基质|叶片|叶子|根系|枝条|花苞|幼苗|种子|这盆|这株|这个植宠|植宠档案|成长日记|养护记录)/i;
const CARE_SIGNAL_PATTERN = /(怎么养|如何养|养护|浇水|浇(?!筑)|施肥|光照|日照|晒太阳|通风|修剪|换盆|病虫|虫害|黄叶|烂根|徒长|枯萎|萎蔫|发蔫|种植|栽培|发芽|开花|落叶|掉叶|卷叶|叶尖|黑斑|斑点|生长|水培|土培|扦插|繁殖|积水|干透|土干|长虫|虫子|发霉)/i;
const PLANT_KNOWLEDGE_PATTERN = /(好养吗|好不好养|习性|品种|学名|科属|花期|有毒|毒性|耐寒|耐热|喜阴|喜阳|温度|湿度|适合.{0,8}(室内|室外|阳台|水培|土培)|能不能养|可不可以养|可以养吗|能吃吗|可食用|食用安全吗)/i;
const PLANT_STATE_PATTERN = /(状态|怎么样|正常吗|有变化吗|什么情况|怎么办)/i;
const GENERIC_WORKFLOW_PATTERN = /(识别|诊断|观察|记录|建档|档案|日记)/i;
const CONFLICTING_SUBJECT_PATTERN = /(电影|电视剧|演员|角色|歌曲|小说|游戏|公司|品牌|算法|代码|服务器|电脑|头发|项目)/i;
const DEVICE_FIELD_PATTERN = /(soil_percent|run_state|fan_switch)/i;
const CARE_TASK_PATTERN = /((安排|添加|创建|生成|制定|设定|设置).{0,16}(任务|提醒|计划|浇水|施肥|修剪|换盆|观察|复查|养护)|(提醒|通知)(我|一下)?.{0,12}(浇水|施肥|修剪|换盆|观察|复查|养护)|(浇水|施肥|修剪|换盆|观察|复查|养护).{0,8}(任务|提醒|计划))/;
const CONTEXTUAL_TASK_PATTERN = /^(请|帮我|可以|能否|麻烦|给我)?\s*(安排|添加|创建|生成|制定)\s*(一个|一项|今天的|明天的)?\s*(观察|复查|养护)\s*(任务|提醒)?$/;
const MEMORY_ACTION_PATTERN = /(你记得|还记得|帮我记住|请记住|上次|之前)/;
const MEMORY_GOVERNANCE_PATTERN = /(查看|读取|管理|修改|删除|清空|忘掉).{0,8}(AI\s*)?记忆|记忆.{0,8}(查看|读取|管理|修改|删除|清空)/i;
const CONTEXTUAL_SHORT_CARE_PATTERN = /^((我)?(现在|最近|这次|今天)?\s*(要不要|该不该|需不需要|需要|要|能不能|可以|怎么|如何|多久|什么时候|还要|还需)\s*(浇水|施肥|晒太阳|光照|通风|修剪|换盆|复查)|(我)?(现在|最近|这次|今天)?\s*(浇水|施肥|晒太阳|光照|通风|修剪|换盆|复查)(吗|多久|多久合适|几天一次|怎么做|什么时候|合适)?)$/;
const CONTEXTUAL_SYMPTOM_PATTERN = /^(土干了|叶子?蔫了|盆里发霉|有小飞虫|长虫了|掉叶了|叶尖黑了)[？?！!。\s]*$/;
const CONTEXTUAL_KNOWLEDGE_PATTERN = /^(好养吗|有毒吗|是什么品种|学名是什么|适合放哪|适合放在哪里|多久浇一次|几天浇一次)[？?！!。\s]*$/;
const IMPLICIT_PLANT_PATTERN = /^(它|这盆|这株|这个植宠).{0,16}(怎么样|还好吗|正常吗|有变化吗|要浇水吗|怎么办|怎么养|多久一次)[？?！!。\s]*$/;
const CONTEXT_REFERENCE_PATTERN = /^(这篇|这段|上面|刚才).{0,12}(是什么|什么意思|总结|解释|怎么理解|该怎么办)/;
const FOLLOW_UP_PATTERN = /^(那|那么|所以|然后)?\s*(为什么|为什么会这样|多久|多久一次|多少|什么时候|怎么办|可以吗|需要吗|然后呢|还有呢|呢)[？?！!。\s]*$/;
const EXPLICIT_PLANT_FOLLOW_UP_PATTERN = /^(那|那么)?\s*.{1,18}(呢|怎么样)[？?！!。\s]*$/;
const CARE_REFERENCE_FOLLOW_UP_PATTERN = /^(我)?(刚才|刚刚|之前).{0,12}(浇|施肥|修剪|换盆|植物|植宠|这盆).{0,8}(什么|哪|如何|怎么样|怎么做)[？?！!。\s]*$/;
const CLEAR_NON_CARE_PATTERN = /(\d+(?:\.\d+)?\s*[+\-*/×÷]\s*\d+(?:\.\d+)?|证明.{0,12}(猜想|定理)|(猜想|定理).{0,12}(证明|证实)|(?:写|作|编).{0,8}(诗|故事|歌词|文案)|(?:python|javascript|java|c\+\+|代码|编程).{0,12}(写|实现|打印|运行)|(?:写|实现|打印).{0,12}(python|javascript|java|c\+\+|代码)|翻译成.{0,8}(英语|英文|法语|日语|韩语)|股票|基金|壁纸|生成.{0,6}(图片|图像)|画一[幅张])/i;
const TRAILING_PUNCTUATION_PATTERN = /[？?！!。,.，、~～…\s]+$/g;
// “别”在中文里也可能只是“识别/区别”等词的一部分，不能把它当成
// 任意位置都可命中的否定词。裸“别”只在句首、分句边界，或紧跟
// 明确主语/语气词时生效；“不要/无需/请勿”等完整否定词仍可直接命中。
const TASK_NEGATION_PATTERN = /(?:(?:(?:不要|不用|无需|不必|暂不|先不|请勿).{0,12}|(?:^|[，,。！？!?；;\s])(?:我(?:们)?|请|你)?(?:先|暂时|千万)?别.{0,12}|(?:没(?:有)?|并未|不是).{0,8}(?:让|叫|要求)?(?:你)?)(?:安排|创建|新增|制定|添加|设定|生成|建立|提醒|任务|计划))/;
const TASK_REMEMBER_PATTERN = /(?:不要|(?:^|[，,。！？!?；;\s])(?:我(?:们)?|请|你)?(?:先|暂时|千万)?别)忘(?:了|记得)?.{0,8}(?:提醒|安排|创建|添加|设定)/;
const TASK_DISCUSSION_PATTERN = /^(?:(?:我想|想|请问)?(?:了解|知道)?\s*)?(?:为什么|为何|怎么|如何|什么是|能不能|是否|有没有|是不是).{0,12}(?:安排|创建|新增|制定|添加|设定|生成|建立|提醒|任务|计划)|^(?:请问\s*)?你(?:能不能|是否可以|会不会).{0,16}(?:安排|创建|新增|制定|添加|设定|生成|建立|提醒|任务|计划)|^(?:你)?(?:已经|曾经|是不是|有没有).{0,16}(?:安排|创建|新增|添加|设定|提醒|任务|计划).{0,8}(?:了吗|没有|过吗|吗)?$|(?:安排|创建|新增|制定|添加|设定|生成|建立|提醒|任务|计划).{0,8}(?:是什么|规则|功能)$/;
const TASK_REQUEST_LEAD_PATTERN = /(?:请|麻烦|帮我|替我|给我|能否|可以请你|我要|我想要|我需要).{0,28}(?:安排|创建|新增|制定|添加|设定|设置|生成|建立|提醒|通知)/;
// “能不能安排任务”可能是在问能力；但“能不能帮我安排…”或
// “能不能提醒我明天浇水”已经同时给出了本人受益者和养护动作，属于明确请求。
const POLITE_TASK_REQUEST_PATTERN = /^(?:请问\s*)?(?:能不能|可不可以|可以不可以)\s*(?:(?:(?:帮|替|给)我).{0,24}(?:安排|创建|新增|制定|添加|设定|设置|生成|建立|提醒|通知)|(?:提醒|通知)我.{0,20}(?:浇水|施肥|修剪|换盆|观察|复查|养护))/;
const TASK_ACTION_REQUEST_PATTERN = /(?:安排|创建|新增|制定|添加|设定|设置|生成|建立).{0,20}(?:任务|提醒|计划|浇水|施肥|修剪|换盆|观察|复查|养护)|(?:提醒|通知)(?:我|一下)?.{0,20}(?:浇水|施肥|修剪|换盆|观察|复查|养护)/;
const MEMORY_SENSITIVE_PATTERN = /(?:密码|口令|验证码|身份证|证件号|银行卡|信用卡|护照|手机号|电话号码|邮箱|住址|家庭住址|openid|token|密钥|私钥)/i;

function isPlantDefinitionRequest(text = '', hasMentionedPlant = false) {
  const normalizedText = normalizeIntentText(text);
  if (hasMentionedPlant && (
    /^(?:请|可以|能否|麻烦)?\s*(?:介绍|科普|讲讲|说说)(?:一下)?\s*.{1,30}$/.test(normalizedText) ||
    /^我想了解.{1,30}$/.test(normalizedText) ||
    /^(?:什么是.{1,30}|[^的]{1,30}(?:到底)?(?:是|属于)(?:什么|啥|哪种|哪一类)(?:植物|花|花卉|品种)?)$/.test(normalizedText)
  )) return true;

  return /^(?:什么是)?(?:植物|植宠|花卉|盆栽|植株|土壤|基质)(?:到底)?(?:是|属于)?(?:什么|啥|哪种|哪一类)?$/.test(normalizedText);
}

function normalizeIntentText(message = '') {
  return String(message || '').trim().replace(TRAILING_PUNCTUATION_PATTERN, '');
}

function hasExplicitTaskIntent(message = '') {
  return classifyTaskIntent(message).state === 'request';
}

/**
 * 规则层只充当副作用安全门，不决定普通问题是否有资格进入 LLM。
 * 只有语义非常明确的 request 才能产生任务提案；其余状态均不得写业务表。
 */
function classifyTaskIntent(message = '') {
  const text = normalizeIntentText(message);
  if (!text) return { state: 'ambiguous', reason: 'empty' };
  if (TASK_REMEMBER_PATTERN.test(text)) return { state: 'request', reason: 'explicit_do_not_forget_request' };
  if (TASK_NEGATION_PATTERN.test(text)) return { state: 'deny', reason: 'explicit_negation' };
  if (POLITE_TASK_REQUEST_PATTERN.test(text)) return { state: 'request', reason: 'explicit_polite_action_request' };
  if (TASK_DISCUSSION_PATTERN.test(text)) return { state: 'discuss', reason: 'task_meta_discussion' };
  if (
    TASK_REQUEST_LEAD_PATTERN.test(text)
    || TASK_ACTION_REQUEST_PATTERN.test(text)
    || CONTEXTUAL_TASK_PATTERN.test(text)
  ) {
    return { state: 'request', reason: 'explicit_action_request' };
  }
  if (CARE_TASK_PATTERN.test(text)) return { state: 'request', reason: 'explicit_care_action_request' };
  if (/(任务|提醒|日程|计划|安排|创建|新增)/.test(text)) {
    return { state: 'ambiguous', reason: 'task_words_without_request' };
  }
  return { state: 'none', reason: 'no_task_intent' };
}

function extractNicknamePreference(message = '') {
  const text = normalizeIntentText(message);
  if (!text || MEMORY_SENSITIVE_PATTERN.test(text)) return null;
  const match = text.match(/(?:我(?:的名字|的昵称)?叫|我(?:的名字|的昵称)?是|叫我|称呼我(?:为)?)[“”"'「」『』\s]*([^\s，,。！？!?“”"'「」『』]{1,32})/);
  if (!match) return null;
  const value = String(match[1] || '').trim();
  if (
    !value
    || /^(?:谁|谁呀|谁啊|谁呢|谁嘛|谁吗|哪位|哪个人|什么(?:名字|昵称)?)$/.test(value)
    || /\d{6,}/.test(value)
  ) return null;
  return {
    kind: 'preferred_name',
    value,
    content: `用户希望被称呼为${value}`
  };
}

function classifyMemoryIntent(message = '') {
  const text = normalizeIntentText(message);
  if (!text) return { state: 'none', reason: 'empty' };
  if (MEMORY_SENSITIVE_PATTERN.test(text) && /(记住|记得|保存|以后|叫我|称呼)/.test(text)) {
    return { state: 'blocked_sensitive', reason: 'sensitive_content' };
  }
  // A recall question can contain the same phrase as a preference command
  // (for example “你记得以后该怎么称呼我吗”). Classify the question before
  // attempting value extraction so the final “吗” is never treated as a name.
  if (USER_IDENTITY_PATTERN.test(text) || /(还记得|记得).{0,8}(?:我叫什么|怎么称呼我|我的昵称)/.test(text)) {
    return { state: 'recall', reason: 'explicit_identity_recall' };
  }
  const preference = extractNicknamePreference(text);
  if (preference) return { state: 'propose', reason: 'explicit_nickname_preference', preference };
  if (MEMORY_GOVERNANCE_PATTERN.test(text)) return { state: 'manage', reason: 'memory_governance' };
  return { state: 'none', reason: 'no_memory_action' };
}

function previousTurnWasInScope(history = []) {
  const assistantMessage = [...history].reverse().find((item) => item?.role === 'assistant');
  if (!assistantMessage?.response) return false;
  const status = assistantMessage.response.scope?.status;
  const reason = assistantMessage.response.scope?.reason;
  const intentType = assistantMessage.response.intent?.type;
  if (
    ['social', 'capability', 'personal_identity', 'nickname_preference'].includes(reason) ||
    ['social', 'capability', 'user_identity', 'nickname_preference'].includes(intentType)
  ) return false;
  if (status) return status === 'in_scope';
  return intentType !== 'out_of_scope';
}

function classifyAssistantScope(message = '', context = {}) {
  const text = String(message || '').trim();
  const normalizedText = normalizeIntentText(text);
  if (!text) return { status: 'out_of_scope', reason: 'empty' };
  if (SOCIAL_PATTERN.test(normalizedText)) return { status: 'in_scope', reason: 'social' };
  if (CAPABILITY_PATTERN.test(normalizedText)) return { status: 'in_scope', reason: 'capability' };
  const memoryIntent = classifyMemoryIntent(normalizedText);
  if (memoryIntent.state === 'recall') return { status: 'in_scope', reason: 'personal_identity' };
  if (memoryIntent.state === 'propose') return { status: 'in_scope', reason: 'nickname_preference' };
  const hasMentionedPlant = Number(context.mentionedPlantCount) > 0;
  const hasPlantAnchor = hasMentionedPlant || PLANT_ANCHOR_PATTERN.test(text);
  const hasCareSignal = CARE_SIGNAL_PATTERN.test(text);
  const hasPlantKnowledgeSignal = PLANT_KNOWLEDGE_PATTERN.test(text);
  const hasPlantDefinitionSignal = isPlantDefinitionRequest(text, hasMentionedPlant);
  const hasPlantStateSignal = PLANT_STATE_PATTERN.test(text);
  const hasGenericWorkflowSignal = GENERIC_WORKFLOW_PATTERN.test(text);
  const hasConflictingSubject = CONFLICTING_SUBJECT_PATTERN.test(text);
  const hasCareTask = hasExplicitTaskIntent(text);
  const hasMemoryAction = MEMORY_ACTION_PATTERN.test(text);

  const hasStrongPlantIntent = hasPlantAnchor && !hasConflictingSubject && (
    hasCareSignal || hasPlantKnowledgeSignal || hasPlantDefinitionSignal || hasPlantStateSignal
  );

  // 只有能够确定为域外且没有真实植物问题的请求才在模型前拒绝；混合请求保留植物部分给 NOVA 回答。
  if (CLEAR_NON_CARE_PATTERN.test(text) && !hasStrongPlantIntent) {
    return { status: 'out_of_scope', reason: hasPlantAnchor ? 'mixed_or_incidental_plant_reference' : 'domain_boundary' };
  }
  if (CLEAR_NON_CARE_PATTERN.test(text) && hasStrongPlantIntent) {
    return { status: 'in_scope', reason: 'plant_care_with_non_care_tail' };
  }
  if (hasConflictingSubject) {
    if (hasCareTask) return { status: 'out_of_scope', reason: 'task_without_plant_context' };
    return { status: 'deferred', reason: hasPlantAnchor ? 'ambiguous_plant_reference' : 'semantic_fallback' };
  }
  if (DEVICE_FIELD_PATTERN.test(text)) return { status: 'in_scope', reason: 'device_field' };
  if (MEMORY_GOVERNANCE_PATTERN.test(text)) return { status: 'in_scope', reason: 'memory_governance' };
  if (hasMemoryAction && (hasPlantAnchor || hasCareSignal)) return { status: 'in_scope', reason: 'plant_memory' };
  if (hasCareTask && (
    hasPlantAnchor ||
    /(浇水|施肥|修剪|换盆)/.test(text) ||
    (context.hasPlantPet && CONTEXTUAL_TASK_PATTERN.test(normalizedText))
  )) return { status: 'in_scope', reason: 'care_task' };
  if (hasPlantAnchor && (
    hasCareSignal || hasPlantKnowledgeSignal || hasPlantDefinitionSignal || hasPlantStateSignal || hasGenericWorkflowSignal
  )) {
    return { status: 'in_scope', reason: hasMentionedPlant ? 'explicit_plant_care' : 'plant_domain' };
  }
  if (context.hasPlantPet && IMPLICIT_PLANT_PATTERN.test(text)) return { status: 'in_scope', reason: 'implicit_plant' };
  if (context.hasPlantPet && CONTEXTUAL_SHORT_CARE_PATTERN.test(normalizedText)) {
    return { status: 'in_scope', reason: 'implicit_care' };
  }
  if (context.hasPlantPet && CONTEXTUAL_SYMPTOM_PATTERN.test(text)) {
    return { status: 'in_scope', reason: 'implicit_symptom' };
  }
  if (context.hasPlantPet && CONTEXTUAL_KNOWLEDGE_PATTERN.test(text)) {
    return { status: 'in_scope', reason: 'implicit_knowledge' };
  }
  if (context.hasKnowledgeContext && CONTEXT_REFERENCE_PATTERN.test(text)) return { status: 'in_scope', reason: 'knowledge_context' };
  if (hasMentionedPlant && previousTurnWasInScope(context.history) && EXPLICIT_PLANT_FOLLOW_UP_PATTERN.test(text)) {
    return { status: 'in_scope', reason: 'explicit_plant_follow_up' };
  }
  if (previousTurnWasInScope(context.history) && CARE_REFERENCE_FOLLOW_UP_PATTERN.test(text)) {
    return { status: 'in_scope', reason: 'care_reference_follow_up' };
  }
  if (previousTurnWasInScope(context.history) && FOLLOW_UP_PATTERN.test(text)) {
    return { status: 'in_scope', reason: 'in_scope_follow_up' };
  }
  if (hasMemoryAction) return { status: 'out_of_scope', reason: 'memory_without_plant_context' };
  if (hasCareTask) return { status: 'out_of_scope', reason: 'task_without_plant_context' };
  if (hasPlantAnchor) return { status: 'deferred', reason: 'ambiguous_plant_reference' };
  return { status: 'deferred', reason: 'semantic_fallback' };
}

function filterModelHistory(history = []) {
  const filtered = [];
  for (let index = 0; index < history.length; index += 1) {
    const item = history[index];
    const next = history[index + 1];
    const nextScope = next?.response?.scope || {};
    const currentScope = item?.response?.scope || {};
    const nextIsPrivateIdentity = ['personal_identity', 'nickname_preference'].includes(nextScope.reason);
    const currentIsPrivateIdentity = ['personal_identity', 'nickname_preference'].includes(currentScope.reason);
    if (item?.role === 'user' && next?.role === 'assistant' && (
      ['out_of_scope', 'deferred'].includes(nextScope.status) || nextIsPrivateIdentity
    )) {
      index += 1;
      continue;
    }
    if (item?.role === 'assistant' && (
      ['out_of_scope', 'deferred'].includes(currentScope.status) || currentIsPrivateIdentity
    )) continue;
    filtered.push(item);
  }
  return filtered;
}

function buildDeferredScopeInstruction(scope = {}) {
  return [
    '本轮表达没有被确定性规则可靠归入某个业务意图，请直接理解用户真正想问什么后再回答。',
    'NOVA 的核心职责是植物知识、植宠养护、养护记录、图片可见迹象和需要用户确认的养护建议；也可以自然回应问候、角色、能力和用户与 NOVA 的关系。',
    '如果问题明显与这些职责无关，只用符合 NOVA 人设的一两句自然中文说明边界，不要继续解答域外内容，也不要拿植物知识凑答案。',
    '本轮没有提供植宠私有档案、养护记忆或检索资料，不要声称已经读取这些信息，也不要声称创建了任务或修改了记录。',
    `内部路由原因：${scope.reason || 'semantic_fallback'}。这个字段只用于约束判断，不要向用户复述。`
  ].join('\n');
}

function buildDeferredFallbackResponse(safetyMeta = {}, scope = {}) {
  return {
    success: true,
    intent: { type: 'clarification', name: 'clarification' },
    scope: { status: 'deferred', reason: scope.reason || 'semantic_fallback', domain: 'plant_care' },
    summary: '我还没准确理解你这次想问的方向。',
    diagnosis: '可以换一种说法；如果和植物有关，带上植物名或你想了解的具体问题，我会更准确地回答。',
    facts: [],
    suggestions: ['告诉我具体植物和问题', '问我 NOVA 能做什么'],
    followUpQuestions: ['你想了解哪种植物，或想让我做什么？'],
    riskLevel: 'low',
    sources: [{ type: 'model_unavailable', title: '模型暂不可用' }],
    taskSuggestions: [],
    ...safetyMeta
  };
}

function buildSocialResponse(message = '', safetyMeta = {}) {
  const text = normalizeIntentText(message).toLowerCase();
  let summary = '你好呀，我在呢。';
  let diagnosis = '你可以问我植宠怎么浇水、光照是否合适、叶片上可见的小异常，或者让我帮你回顾养护记录。';
  if (/^(谢谢|感谢)/.test(text)) {
    summary = '不客气呀。';
    diagnosis = '照顾植物本来就需要一点耐心，有新的变化随时来找我。';
  } else if (/^(再见|拜拜|晚安)/.test(text)) {
    summary = /晚安/.test(text) ? '晚安，愿你和植宠都休息好。' : '好呀，下次见。';
    diagnosis = '之后看到叶片、盆土或生长状态有变化，再来告诉我就好。';
  }
  return {
    success: true,
    intent: { type: 'social', name: 'social' },
    scope: { status: 'in_scope', reason: 'social', domain: 'plant_care' },
    summary,
    diagnosis,
    facts: [],
    suggestions: ['问我这盆植物怎么浇水', '查看我记得的养护记录'],
    followUpQuestions: ['问我这盆植物怎么浇水', '查看我记得的养护记录'],
    riskLevel: 'low',
    sources: [],
    taskSuggestions: [],
    ...safetyMeta,
    disclaimer: ''
  };
}

function buildOutOfScopeResponse(message = '', safetyMeta = {}, scope = {}) {
  let summary = '这个问题不在我的植宠养护职责内。';
  let diagnosis = '我不能替你处理这个问题，也不应该拿植物资料来凑答案。NOVA 主要负责植宠档案、养护记录、可靠的植物知识、图片中可见迹象，以及需要你确认的养护任务建议。';
  if (/哥德巴赫/.test(message)) {
    summary = '哥德巴赫猜想的证明不在我的植宠养护职责内。';
    diagnosis = '我不能替你处理哥德巴赫猜想的证明，也不应该拿植物资料来凑答案。你可以继续问我植宠档案、养护记录、可靠的植物知识、图片中可见迹象，或需要你确认的养护任务建议。';
  } else if (scope.reason === 'mixed_or_incidental_plant_reference') {
    summary = '我看到了句子里的植物名，但这次问题本身不是植宠养护问题。';
    diagnosis = '我不会只因为出现了植物名就检索养护资料或套用当前植宠的记录。你可以把浇水、光照、状态或养护记录等问题单独告诉我。';
  } else if (scope.reason === 'memory_without_plant_context') {
    summary = '这项记忆请求没有明确指向植宠养护。';
    diagnosis = '为了避免保存与植宠无关或敏感的内容，我只处理植物档案、养护记录和你明确确认的养护偏好。';
  } else if (scope.reason === 'task_without_plant_context') {
    summary = '这项任务还没有明确指向某盆植物或养护动作。';
    diagnosis = '请告诉我是为哪盆植宠安排浇水、施肥、修剪、换盆或观察任务，我再给出待确认的建议。';
  } else if (scope.reason === 'plant_reference_without_care_intent') {
    summary = '我认出了你提到的植物，但还没看出具体的养护问题。';
    diagnosis = '你可以继续说明想了解它的浇水、光照、状态、品种知识，还是要回顾养护记录。';
  }
  return {
    success: true,
    intent: { type: 'out_of_scope', name: 'out_of_scope' },
    scope: { status: 'out_of_scope', reason: scope.reason || 'domain_boundary', domain: 'plant_care' },
    summary,
    diagnosis,
    facts: [],
    suggestions: ['问我这盆植物怎么浇水', '查看我记得的养护记录'],
    followUpQuestions: ['问我这盆植物怎么浇水', '查看我记得的养护记录'],
    riskLevel: 'low',
    sources: [],
    taskSuggestions: [],
    ...safetyMeta
  };
}

module.exports = {
  classifyAssistantScope,
  normalizeIntentText,
  filterModelHistory,
  buildSocialResponse,
  buildOutOfScopeResponse,
  buildDeferredScopeInstruction,
  buildDeferredFallbackResponse,
  previousTurnWasInScope,
  hasExplicitTaskIntent,
  classifyTaskIntent,
  classifyMemoryIntent,
  extractNicknamePreference,
  MEMORY_SENSITIVE_PATTERN
};
