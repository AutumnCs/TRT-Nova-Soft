const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

const TASK_TYPE_OPTIONS = [
  { value: 'watering', label: '浇水', icon: '💧' },
  { value: 'fertilizing', label: '施肥', icon: '✦' },
  { value: 'pruning', label: '修剪', icon: '✂' },
  { value: 'inspection', label: '观察', icon: '⌕' },
  { value: 'repotting', label: '换盆', icon: '♻' },
  { value: 'other', label: '其他', icon: '•' }
];

const RECURRENCE_OPTIONS = [
  { value: 'none', label: '不重复' },
  { value: 'daily', label: '每 N 天' },
  { value: 'weekly', label: '每 N 周' },
  { value: 'monthly', label: '每 N 月' }
];

const SOURCE_LABELS = {
  manual: '手动创建',
  rule: '养护规则建议',
  ai: 'AI 建议（已确认）',
  weather: '天气建议（已确认）',
  diagnosis: '图片观察建议（已确认）'
};

function todayInShanghai(nowMs = Date.now()) {
  return new Date(Number(nowMs) + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

function addDays(dateString, amount) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + Number(amount || 0));
  return date.toISOString().slice(0, 10);
}

function getTaskType(taskType) {
  return TASK_TYPE_OPTIONS.find((item) => item.value === taskType) || TASK_TYPE_OPTIONS[TASK_TYPE_OPTIONS.length - 1];
}

function getRecurrenceLabel(type, interval = 1) {
  const value = Number(interval) || 1;
  if (type === 'daily') return value === 1 ? '每天' : `每 ${value} 天`;
  if (type === 'weekly') return value === 1 ? '每周' : `每 ${value} 周`;
  if (type === 'monthly') return value === 1 ? '每月' : `每 ${value} 月`;
  return '不重复';
}

function getDateLabel(date, today = todayInShanghai()) {
  if (date === today) return '今天';
  if (date === addDays(today, 1)) return '明天';
  if (date === addDays(today, -1)) return '昨天';
  return date;
}

function decorateCareTask(task = {}, today = todayInShanghai()) {
  const taskType = getTaskType(task.taskType);
  const overdue = task.status === 'pending' && task.scheduledFor && task.scheduledFor < today;
  return {
    ...task,
    typeLabel: taskType.label,
    typeIcon: taskType.icon,
    sourceLabel: SOURCE_LABELS[task.source] || '手动创建',
    recurrenceLabel: getRecurrenceLabel(task.recurrenceType, task.recurrenceInterval),
    dateLabel: getDateLabel(task.scheduledFor, today),
    reminderLabel: task.reminderTime ? task.reminderTime.slice(0, 5) : '不提醒',
    overdue,
    statusLabel: task.status === 'completed' ? '已完成' : overdue ? '已逾期' : '待完成'
  };
}

module.exports = {
  TASK_TYPE_OPTIONS,
  RECURRENCE_OPTIONS,
  SOURCE_LABELS,
  todayInShanghai,
  addDays,
  getTaskType,
  getRecurrenceLabel,
  getDateLabel,
  decorateCareTask
};
