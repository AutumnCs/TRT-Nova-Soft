const test = require('node:test');
const assert = require('node:assert/strict');

const { classifyAssistantScope } = require('../agent/intentRouter');

const PLANT_ENTITY_PATTERN = /(月季|玫瑰|蔷薇|龟背竹|Rosa|Monstera deliciosa)/i;
const inScopeHistory = [{ role: 'assistant', response: { scope: { status: 'in_scope' } } }];

function buildContext(message, context = {}) {
  return {
    mentionedPlantCount: PLANT_ENTITY_PATTERN.test(message) ? 1 : 0,
    ...context
  };
}

const socialCases = [
  '你好', '你好?', '你好？', '你好呀！', '您好', 'Hi', 'hello!!', '嗨～',
  '在吗？', '谢谢', '感谢呀', '再见', '拜拜！', '晚安呢'
];

const capabilityCases = [
  '你是谁？', '介绍一下你自己', '介绍一下！', '你能做什么',
  '你会什么？', '你的职责是什么', '怎么使用你', '怎么用你？'
];

const identityCases = [
  ['我是谁？', 'personal_identity'],
  ['我是谁呀？', 'personal_identity'],
  ['我是谁啊', 'personal_identity'],
  ['我是谁呢', 'personal_identity'],
  ['你知道我是谁吗', 'personal_identity'],
  ['你知道我叫什么吗', 'personal_identity'],
  ['你还认识我吗？', 'personal_identity'],
  ['你还记得我吗', 'personal_identity'],
  ['你记得我吗', 'personal_identity'],
  ['你记得我是谁吗', 'personal_identity'],
  ['你知道我的昵称吗', 'personal_identity'],
  ['你怎么称呼我', 'personal_identity'],
  ['我叫什么名字？', 'personal_identity'],
  ['我的昵称是什么', 'personal_identity'],
  ['我叫小叶子', 'nickname_preference'],
  ['我的昵称是小叶子', 'nickname_preference'],
  ['以后叫我小叶子', 'nickname_preference'],
  ['以后可以叫我小叶子', 'nickname_preference'],
  ['你可以叫我小叶子', 'nickname_preference'],
  ['请叫我小叶子', 'nickname_preference'],
  ['请记住我叫小叶子', 'nickname_preference'],
  ['以后请称呼我为小叶子', 'nickname_preference'],
  ['今后称呼我为小叶子', 'nickname_preference']
];

const plantCareCases = [
  ['月季怎么浇水？'],
  ['我在考虑给月季浇牛奶，先只告诉我是否建议。'],
  ['月季怎么养'],
  ['月季是什么？'],
  ['月季到底是什么'],
  ['什么是月季'],
  ['请介绍一下月季'],
  ['科普一下龟背竹'],
  ['我想了解月季'],
  ['龟背竹属于哪一类植物'],
  ['植物是什么'],
  ['月季好养吗'],
  ['月季是什么品种'],
  ['月季的学名是什么'],
  ['月季有毒吗'],
  ['月季能吃吗'],
  ['月季适合放在阳台吗'],
  ['月季什么时候开花'],
  ['月季是喜阴还是喜阳'],
  ['龟背竹叶子发黄怎么办'],
  ['Monstera deliciosa 需要多少光照'],
  ['Rosa 怎么养'],
  ['这盆植物现在状态怎么样'],
  ['这株叶子有黑斑怎么办'],
  ['盆土干透后再浇水吗'],
  ['识别这株植物'],
  ['记录这盆的生长变化'],
  ['帮月季安排一个观察任务'],
  ['请为这盆植物创建施肥提醒'],
  ['安排一个浇水提醒'],
  ['帮我安排一个观察任务', { hasPlantPet: true }],
  ['创建一个复查提醒', { hasPlantPet: true }],
  ['我现在要不要浇水', { hasPlantPet: true }],
  ['能不能修剪', { hasPlantPet: true }],
  ['晒太阳多久', { hasPlantPet: true }],
  ['光照多久合适', { hasPlantPet: true }],
  ['土干了', { hasPlantPet: true }],
  ['叶蔫了', { hasPlantPet: true }],
  ['盆里发霉', { hasPlantPet: true }],
  ['有小飞虫', { hasPlantPet: true }],
  ['好养吗', { hasPlantPet: true }],
  ['多久浇一次', { hasPlantPet: true }],
  ['你记得这盆植物什么？'],
  ['你记得月季是谁送的吗'],
  ['帮我记住月季周六浇水'],
  ['上次浇水是什么时候'],
  ['查看 AI 记忆'],
  ['删除这条 AI 记忆'],
  ['soil_percent 是什么意思'],
  ['run_state 最近是什么'],
  ['fan_switch 当前状态'],
  ['这篇文章是什么意思', { hasKnowledgeContext: true }],
  ['月季怎么浇水，顺便写首诗'],
  ['月季怎么浇水，顺便证明哥德巴赫猜想']
];

const outOfScopeCases = [
  ['1+2是多少个月季啊？', 'mixed_or_incidental_plant_reference'],
  ['1+2是多少朵玫瑰花呢', 'mixed_or_incidental_plant_reference'],
  ['3×4等于多少盆龟背竹', 'mixed_or_incidental_plant_reference'],
  ['我不是问植物，1+2等于几个月季', 'mixed_or_incidental_plant_reference'],
  ['写一首月季的诗', 'mixed_or_incidental_plant_reference'],
  ['用月季编一个故事', 'mixed_or_incidental_plant_reference'],
  ['给月季写宣传文案', 'mixed_or_incidental_plant_reference'],
  ['把月季翻译成法语', 'mixed_or_incidental_plant_reference'],
  ['生成月季壁纸', 'mixed_or_incidental_plant_reference'],
  ['生成一张月季图片', 'mixed_or_incidental_plant_reference'],
  ['画一幅月季', 'mixed_or_incidental_plant_reference'],
  ['月季股票能买吗', 'mixed_or_incidental_plant_reference'],
  ['用 Python 打印月季', 'mixed_or_incidental_plant_reference'],
  ['证明月季和哥德巴赫猜想有关', 'mixed_or_incidental_plant_reference'],
  ['给服务器安排观察任务', 'task_without_plant_context', { hasPlantPet: true }],
  ['为股票制定观察任务', 'domain_boundary', { hasPlantPet: true }],
  ['帮我记住密码', 'memory_without_plant_context', { hasPlantPet: true }],
  ['请记住我的银行卡号', 'memory_without_plant_context', { hasPlantPet: true }],
  ['你记得我的身份证号吗', 'memory_without_plant_context', { hasPlantPet: true }],
  ['上次开会说了什么', 'memory_without_plant_context', { hasPlantPet: true }],
  ['为什么哥德巴赫猜想还没证明', 'domain_boundary', { history: inScopeHistory }],
  ['那你帮我写首诗', 'domain_boundary', { history: inScopeHistory }],
  ['然后帮我查股票', 'domain_boundary', { history: inScopeHistory }]
];

const deferredCases = [
  ['月季+龟背竹等于什么', 'ambiguous_plant_reference'],
  ['用代码画月季', 'ambiguous_plant_reference'],
  ['月季是谁演的', 'ambiguous_plant_reference'],
  ['月季的寓意是什么', 'ambiguous_plant_reference'],
  ['玫瑰这个名字好听吗', 'ambiguous_plant_reference'],
  ['Rosa 是谁', 'ambiguous_plant_reference'],
  ['Monstera deliciosa 怎么拼', 'ambiguous_plant_reference'],
  ['月季', 'ambiguous_plant_reference'],
  ['玫瑰？', 'ambiguous_plant_reference'],
  ['月季电影讲什么', 'ambiguous_plant_reference'],
  ['龟背竹公司怎么样', 'ambiguous_plant_reference'],
  ['土壤乐队是谁', 'ambiguous_plant_reference'],
  ['根系算法是什么', 'ambiguous_plant_reference'],
  ['识别这段代码', 'semantic_fallback'],
  ['诊断电脑为什么发热', 'semantic_fallback'],
  ['观察服务器状态', 'semantic_fallback'],
  ['记录今天会议内容', 'semantic_fallback'],
  ['电脑怎么通风散热', 'semantic_fallback', { hasPlantPet: true }],
  ['头发该修剪吗', 'semantic_fallback', { hasPlantPet: true }],
  ['给这篇文章浇水', 'semantic_fallback', { hasPlantPet: true }],
  ['我的项目黄叶了怎么办', 'semantic_fallback', { hasPlantPet: true }],
  ['我最近状态怎么样', 'semantic_fallback', { hasPlantPet: true }],
  ['今天状态怎么样', 'semantic_fallback', { hasPlantPet: true }],
  ['为什么天空是蓝的', 'semantic_fallback', { history: inScopeHistory }],
  ['为什么？', 'semantic_fallback', { history: [{ role: 'assistant', response: { scope: { status: 'in_scope', reason: 'social' }, intent: { type: 'social' } } }] }],
  ['那多久一次？', 'semantic_fallback', { history: [{ role: 'assistant', response: { scope: { status: 'in_scope', reason: 'capability' }, intent: { type: 'general' } } }] }],
  ['为什么？', 'semantic_fallback', { history: [{ role: 'assistant', response: { scope: { status: 'in_scope', reason: 'personal_identity' }, intent: { type: 'user_identity' } } }] }],
  ['那多久一次？', 'semantic_fallback', { history: [{ role: 'assistant', response: { scope: { status: 'deferred', reason: 'semantic_fallback' }, intent: { type: 'general' } } }] }]
];

const followUpCases = [
  '那多久一次？', '为什么？', '为什么会这样', '什么时候', '怎么办',
  '可以吗', '需要吗', '然后呢', '还有呢', '那月季呢', '我刚才考虑浇的是什么？'
];

for (const message of socialCases) {
  test(`意图对抗语料：社交消息“${message}”稳定进入轻量社交分支`, () => {
    const result = classifyAssistantScope(message, buildContext(message));
    assert.equal(result.status, 'in_scope');
    assert.equal(result.reason, 'social');
  });
}

for (const message of capabilityCases) {
  test(`意图对抗语料：能力询问“${message}”保留在职责域内`, () => {
    const result = classifyAssistantScope(message, buildContext(message));
    assert.equal(result.status, 'in_scope');
    assert.equal(result.reason, 'capability');
  });
}

for (const [message, expectedReason] of identityCases) {
  test(`意图对抗语料：账号称呼请求“${message}”进入确定性资料分支`, () => {
    const result = classifyAssistantScope(message, buildContext(message));
    assert.equal(result.status, 'in_scope');
    assert.equal(result.reason, expectedReason);
  });
}

for (const [message, extraContext = {}] of plantCareCases) {
  test(`意图对抗语料：真实植宠请求“${message}”不会被误拒绝`, () => {
    const result = classifyAssistantScope(message, buildContext(message, extraContext));
    assert.equal(result.status, 'in_scope');
  });
}

for (const [message, expectedReason, extraContext = {}] of outOfScopeCases) {
  test(`意图对抗语料：高置信域外请求“${message}”不会进入 RAG/模型`, () => {
    const result = classifyAssistantScope(message, buildContext(message, extraContext));
    assert.equal(result.status, 'out_of_scope');
    assert.equal(result.reason, expectedReason);
  });
}

for (const [message, expectedReason, extraContext = {}] of deferredCases) {
  test(`意图对抗语料：规则不确定的请求“${message}”进入无权限语义回退`, () => {
    const result = classifyAssistantScope(message, buildContext(message, extraContext));
    assert.equal(result.status, 'deferred');
    assert.equal(result.reason, expectedReason);
  });
}

for (const message of followUpCases) {
  test(`意图对抗语料：短连续追问“${message}”继承上一轮植宠语境`, () => {
    const result = classifyAssistantScope(message, buildContext(message, { history: inScopeHistory }));
    assert.equal(result.status, 'in_scope');
    assert.match(result.reason, /follow_up/);
  });
}
