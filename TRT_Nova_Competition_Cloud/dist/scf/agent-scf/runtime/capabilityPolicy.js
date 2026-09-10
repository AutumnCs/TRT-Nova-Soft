const {
  classifyTaskIntent,
  classifyMemoryIntent
} = require('../agent/intentRouter');

const ACCOUNT_NICKNAME_QUERIES = new Set([
  '我是谁',
  '你知道我是谁吗',
  '我叫什么',
  '我叫什么名字',
  '我的昵称是什么',
  '你知道我的昵称吗',
  '你怎么称呼我',
  '你还记得我叫什么吗'
]);

function normalizePolicyText(input = '') {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function isAccountNicknameQuery(input = '') {
  return ACCOUNT_NICKNAME_QUERIES.has(normalizePolicyText(input));
}

function requiresPublishedKnowledge(envelope = {}) {
  const message = String(envelope.message || '').trim();
  if (!message) return false;
  if (/^\s*\d+\s*[+\-*/×x]\s*\d+.*(?:等于|是|多少)/i.test(message)) return false;
  if (/(翻译|译成|英文|英语)/i.test(message)) return false;
  if (classifyTaskIntent(message).state === 'request'
    && !/(怎么|如何|是否|要不要|该不该|能不能|为什么|原因|多少|多久|频率|建议|先告诉|同时告诉|并告诉)/i.test(message)) {
    return false;
  }
  return /(植物|植宠|花卉|盆栽|月季|玫瑰|龟背竹|海棠|多肉|兰花|绿萝|浇水|补水|盆土|土壤|排水|积水|光照|日照|暴晒|施肥|肥料|修剪|黄叶|叶子.{0,8}黄|叶片|新叶|病虫|虫害|农药|杀虫|误食|中毒|养护|怎么养|品种|学名)/i.test(message);
}

function formatShanghaiDate(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date).reduce((result, item) => ({ ...result, [item.type]: item.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function parseTaskDraft(message = '', now = new Date()) {
  const text = String(message || '').trim();
  const explicitDate = text.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/);
  let scheduledFor = formatShanghaiDate(now);
  if (explicitDate) {
    scheduledFor = `${explicitDate[1]}-${String(explicitDate[2]).padStart(2, '0')}-${String(explicitDate[3]).padStart(2, '0')}`;
  } else if (/后天/.test(text)) {
    scheduledFor = formatShanghaiDate(new Date(now.getTime() + (2 * 86400000)));
  } else if (/明天|明日/.test(text)) {
    scheduledFor = formatShanghaiDate(new Date(now.getTime() + 86400000));
  }

  // A bare number is not a clock: otherwise the month/day in an ISO date such
  // as `2026-09-10 10:30` can win before the actual time. Require either a
  // clock separator (`:`), a Chinese hour suffix (`点`/`时`), or a day period.
  const arabicColonMatch = text.match(/(?:(上午|早上|下午|晚上|中午)\s*)?(?<!\d)(\d{1,2})[:：](\d{1,2})(?!\d)/);
  const arabicHourMatch = arabicColonMatch
    ? null
    : text.match(/(?:(上午|早上|下午|晚上|中午)\s*)?(?<!\d)(\d{1,2})[点时](?:(\d{1,2})分?)?(?!\d)/);
  const arabicClockMatch = arabicColonMatch || arabicHourMatch;
  const arabicPeriodMatch = arabicClockMatch
    ? null
    : text.match(/(上午|早上|下午|晚上|中午)\s*(?<!\d)(\d{1,2})(?!\d)/);
  const arabicTimeMatch = arabicClockMatch || arabicPeriodMatch;
  const chineseTimeMatch = text.match(/(?:(上午|早上|下午|晚上|中午)\s*)?([一二两三四五六七八九十]{1,3})点(?:([一二两三四五六七八九十]{1,3})分?)?/);
  const chineseNumber = (value = '') => {
    const digits = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    if (value === '十') return 10;
    if (value.includes('十')) {
      const [left, right] = value.split('十');
      return (left ? digits[left] : 1) * 10 + (right ? digits[right] : 0);
    }
    return digits[value] || 0;
  };
  const timeMatch = arabicTimeMatch || (chineseTimeMatch ? [
    chineseTimeMatch[0],
    chineseTimeMatch[1],
    chineseNumber(chineseTimeMatch[2]),
    chineseNumber(chineseTimeMatch[3] || '')
  ] : null);
  let reminderTime = null;
  if (timeMatch) {
    let hour = Number(timeMatch[2]);
    const minute = Number(timeMatch[3] || 0);
    if (/(下午|晚上)/.test(timeMatch[1] || '') && hour < 12) hour += 12;
    if (/(上午|早上)/.test(timeMatch[1] || '') && hour === 12) hour = 0;
    if ((timeMatch[1] || '') === '中午' && hour < 11) hour += 12;
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      reminderTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
  }

  let taskType = 'inspection';
  if (/浇水|补水/.test(text)) taskType = 'watering';
  else if (/施肥|肥料/.test(text)) taskType = 'fertilizing';
  else if (/修剪/.test(text)) taskType = 'pruning';
  else if (/换盆/.test(text)) taskType = 'repotting';

  let recurrenceType = 'none';
  if (/每天|每日/.test(text)) recurrenceType = 'daily';
  else if (/每周|每星期|每个星期/.test(text)) recurrenceType = 'weekly';
  else if (/每月|每个月/.test(text)) recurrenceType = 'monthly';

  const actionLabel = {
    watering: '浇水', fertilizing: '施肥', pruning: '修剪', repotting: '换盆', inspection: '观察植株'
  }[taskType];
  return {
    taskType,
    title: actionLabel,
    description: `由用户明确提出：${text.slice(0, 240)}`,
    scheduledFor,
    reminderTime,
    recurrenceType,
    recurrenceInterval: 1,
    reason: '用户明确请求创建养护任务'
  };
}

function getAllowedToolNames(envelope = {}) {
  const contextual = Boolean(require('../lib/conversation-context').getTurnContext());
  const names = new Set();
  if (contextual) names.add('get_account_nickname');
  const taskIntent = classifyTaskIntent(envelope.message);
  const memoryIntent = classifyMemoryIntent(envelope.message);
  if (requiresPublishedKnowledge(envelope)) names.add('search_published_knowledge');
  if (isAccountNicknameQuery(envelope.message) || memoryIntent.state === 'recall') {
    if (!contextual) names.add('recall_relevant_memories');
    names.add('get_account_nickname');
  }
  if (!contextual && memoryIntent.state === 'propose') names.add('propose_memory_candidate');
  if (taskIntent.state === 'request') {
    names.add('get_selected_plant');
    names.add('propose_care_task');
  }
  return [...names];
}

function getRequiredReadTools(envelope = {}) {
  const contextual = Boolean(require('../lib/conversation-context').getTurnContext());
  const calls = [];
  const memoryIntent = classifyMemoryIntent(envelope.message);
  if (requiresPublishedKnowledge(envelope)) {
    calls.push({
      name: 'search_published_knowledge',
      arguments: {
        query: String(envelope.message || ''),
        plantType: String(envelope.plantType || '')
      },
      source: 'policy_preflight'
    });
  }
  if (!contextual && (isAccountNicknameQuery(envelope.message) || memoryIntent.state === 'recall')) {
    calls.push({
      name: 'recall_relevant_memories',
      arguments: { query: String(envelope.message || '') },
      source: 'policy_required'
    });
    calls.push({ name: 'get_account_nickname', arguments: {}, source: 'policy_required' });
  }
  if (!contextual && memoryIntent.state === 'propose') {
    calls.push({
      name: 'propose_memory_candidate',
      arguments: memoryIntent.preference,
      source: 'policy_required'
    });
  }
  const taskIntent = classifyTaskIntent(envelope.message);
  if (taskIntent.state === 'request') {
    calls.push({ name: 'get_selected_plant', arguments: {}, source: 'policy_required' });
    calls.push({
      name: 'propose_care_task',
      arguments: parseTaskDraft(envelope.message, envelope.now instanceof Date ? envelope.now : new Date()),
      source: 'policy_required'
    });
  }
  return calls;
}

module.exports = {
  ACCOUNT_NICKNAME_QUERIES,
  normalizePolicyText,
  isAccountNicknameQuery,
  requiresPublishedKnowledge,
  formatShanghaiDate,
  parseTaskDraft,
  getAllowedToolNames,
  getRequiredReadTools
};
