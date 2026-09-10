const {
  addDays,
  decorateCareTask,
  todayInShanghai
} = require('../../services/modules/care-task-presenter');

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

function startOfWeek(dateString) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  return addDays(dateString, -offset);
}

function firstOfMonth(dateString) {
  return `${dateString.slice(0, 7)}-01`;
}

function addMonthsClamped(dateString, amount) {
  const [year, month, day] = dateString.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1 + amount, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

function getViewRange(anchorDate, viewMode = 'month') {
  if (viewMode === 'week') {
    const startDate = startOfWeek(anchorDate);
    return { startDate, endDate: addDays(startDate, 6) };
  }
  const startDate = startOfWeek(firstOfMonth(anchorDate));
  return { startDate, endDate: addDays(startDate, 41) };
}

function buildCalendarDays(anchorDate, viewMode, tasks = [], selectedDate = anchorDate, today = todayInShanghai()) {
  const range = getViewRange(anchorDate, viewMode);
  const count = viewMode === 'week' ? 7 : 42;
  const anchorMonth = anchorDate.slice(0, 7);
  return Array.from({ length: count }, (_, index) => {
    const date = addDays(range.startDate, index);
    const dateTasks = tasks.filter((task) => task.scheduledFor === date);
    const pendingCount = dateTasks.filter((task) => task.status === 'pending').length;
    const completedCount = dateTasks.filter((task) => task.status === 'completed').length;
    return {
      key: date,
      date,
      day: Number(date.slice(-2)),
      weekday: WEEK_LABELS[index % 7],
      inMonth: date.slice(0, 7) === anchorMonth,
      selected: date === selectedDate,
      today: date === today,
      pendingCount,
      completedCount,
      totalCount: dateTasks.length,
      overdue: date < today && pendingCount > 0
    };
  });
}

function tasksForDate(tasks = [], selectedDate, today = todayInShanghai()) {
  return tasks
    .filter((task) => task.scheduledFor === selectedDate)
    .map((task) => decorateCareTask(task, today))
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'pending' ? -1 : 1;
      return (a.reminderTime || '99:99').localeCompare(b.reminderTime || '99:99') || a.id - b.id;
    });
}

function shiftAnchor(anchorDate, viewMode, direction) {
  const amount = direction < 0 ? -1 : 1;
  return viewMode === 'week' ? addDays(anchorDate, amount * 7) : addMonthsClamped(anchorDate, amount);
}

function formatRangeLabel(anchorDate, viewMode) {
  if (viewMode === 'month') {
    const [year, month] = anchorDate.split('-').map(Number);
    return `${year} 年 ${month} 月`;
  }
  const range = getViewRange(anchorDate, viewMode);
  const start = range.startDate.split('-').map(Number);
  const end = range.endDate.split('-').map(Number);
  if (start[0] === end[0]) return `${start[0]} 年 ${start[1]} 月 ${start[2]} 日 — ${end[1]} 月 ${end[2]} 日`;
  return `${range.startDate} — ${range.endDate}`;
}

module.exports = {
  WEEK_LABELS,
  startOfWeek,
  getViewRange,
  buildCalendarDays,
  tasksForDate,
  shiftAnchor,
  formatRangeLabel
};
