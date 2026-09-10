const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

const TASK_TYPES = new Set(['watering', 'fertilizing', 'pruning', 'inspection', 'repotting', 'other']);
const RECURRENCE_TYPES = new Set(['none', 'daily', 'weekly', 'monthly']);
const TASK_SOURCES = new Set(['manual', 'rule', 'ai', 'weather', 'diagnosis']);

const BADGE_DEFINITIONS = [
  { key: 'first_plant_pet', title: '初次相遇', description: '建立第一份植宠档案', icon: '🌱' },
  { key: 'first_checkin', title: '第一次打卡', description: '完成第一项养护任务', icon: '✓' },
  { key: 'streak_3', title: '三日相伴', description: '连续完成 3 个计划养护日', icon: '③' },
  { key: 'streak_7', title: '一周守护', description: '连续完成 7 个计划养护日', icon: '⑦' },
  { key: 'first_journal', title: '第一篇日记', description: '记录第一条成长日记', icon: '✎' },
  { key: 'first_diagnosis', title: '第一次观察', description: '保存第一次图片观察', icon: '⌕' }
];

const CARE_TASK_SELECT = `
  SELECT t.id, t.openid, t.logical_key, t.plant_pet_id, t.task_type, t.title,
         t.urgent, t.icon, t.icon_color, t.icon_bg, t.description_text,
         DATE_FORMAT(t.scheduled_for, '%Y-%m-%d') AS scheduled_for,
         TIME_FORMAT(t.reminder_time, '%H:%i') AS reminder_time,
         t.recurrence_type, t.recurrence_interval, t.recurrence_parent_id,
         t.source, t.status,
         DATE_FORMAT(t.completed_at, '%Y-%m-%d %H:%i:%s') AS completed_at,
         DATE_FORMAT(t.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
         DATE_FORMAT(t.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at,
         pp.nickname AS plant_pet_name, pp.status AS plant_pet_status
  FROM todos t
  LEFT JOIN plant_pets pp ON pp.id = t.plant_pet_id AND pp.openid = t.openid
`;

function hasOwn(input, key) {
  return Boolean(input && Object.prototype.hasOwnProperty.call(input, key));
}

function normalizeText(input, maxLength) {
  const value = typeof input === 'string' ? input.trim() : '';
  return value.slice(0, maxLength);
}

function normalizeDateInput(input, label = '任务日期') {
  const value = typeof input === 'string' ? input.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { ok: false, value: '', msg: `${label}格式无效` };
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return { ok: false, value: '', msg: `${label}无效` };
  }
  return { ok: true, value };
}

function normalizeTimeInput(input) {
  if (input === undefined || input === null || input === '') {
    return { ok: true, value: null };
  }
  const value = typeof input === 'string' ? input.trim() : '';
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(value);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    return { ok: false, value: null, msg: '提醒时间无效' };
  }
  return { ok: true, value: `${match[1]}:${match[2]}` };
}

function normalizePositiveInteger(input, fallback = 1, max = 365) {
  const value = input === undefined || input === null || input === '' ? fallback : Number(input);
  if (!Number.isInteger(value) || value < 1 || value > max) return 0;
  return value;
}

function validateTaskInput(input = {}) {
  const plantPetId = Number(input.plantPetId) || 0;
  if (!Number.isInteger(plantPetId) || plantPetId <= 0) {
    return { ok: false, msg: '请选择植宠' };
  }

  const taskType = normalizeText(input.taskType, 32).toLowerCase();
  if (!TASK_TYPES.has(taskType)) {
    return { ok: false, msg: '任务类型无效' };
  }

  const title = normalizeText(input.title, 128);
  if (!title) return { ok: false, msg: '请填写任务标题' };

  const scheduledFor = normalizeDateInput(input.scheduledFor);
  if (!scheduledFor.ok) return scheduledFor;

  const reminderInput = hasOwn(input, 'reminderTime') ? input.reminderTime : '09:00';
  const reminderTime = normalizeTimeInput(reminderInput);
  if (!reminderTime.ok) return reminderTime;

  const recurrenceType = normalizeText(input.recurrenceType || 'none', 16).toLowerCase();
  if (!RECURRENCE_TYPES.has(recurrenceType)) {
    return { ok: false, msg: '重复规则无效' };
  }
  const recurrenceInterval = normalizePositiveInteger(input.recurrenceInterval, 1);
  if (!recurrenceInterval) {
    return { ok: false, msg: '重复间隔需为 1 到 365 的整数' };
  }

  const source = normalizeText(input.source || 'manual', 32).toLowerCase();
  if (!TASK_SOURCES.has(source)) return { ok: false, msg: '任务来源无效' };
  if (source !== 'manual' && input.confirmed !== true) {
    return { ok: false, msg: '建议任务需经用户确认后才能保存' };
  }

  return {
    ok: true,
    value: {
      plantPetId,
      taskType,
      title,
      description: normalizeText(input.description, 1000),
      scheduledFor: scheduledFor.value,
      reminderTime: reminderTime.value,
      recurrenceType,
      recurrenceInterval: recurrenceType === 'none' ? 1 : recurrenceInterval,
      source
    }
  };
}

function shanghaiDateFromMs(nowMs = Date.now()) {
  return new Date(Number(nowMs) + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

function shanghaiDateTimeFromMs(nowMs = Date.now()) {
  return new Date(Number(nowMs) + SHANGHAI_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ');
}

function addDays(dateString, amount) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function addMonthsClamped(dateString, amount) {
  const [year, month, day] = dateString.split('-').map(Number);
  const targetStart = new Date(Date.UTC(year, month - 1 + amount, 1));
  const targetYear = targetStart.getUTCFullYear();
  const targetMonth = targetStart.getUTCMonth();
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

function getNextScheduledDate(completedDate, recurrenceType, recurrenceInterval = 1) {
  const validDate = normalizeDateInput(completedDate, '完成日期');
  if (!validDate.ok || !RECURRENCE_TYPES.has(recurrenceType) || recurrenceType === 'none') return '';
  const interval = normalizePositiveInteger(recurrenceInterval, 1);
  if (!interval) return '';
  if (recurrenceType === 'daily') return addDays(validDate.value, interval);
  if (recurrenceType === 'weekly') return addDays(validDate.value, interval * 7);
  return addMonthsClamped(validDate.value, interval);
}

function mapCareTaskRow(row = {}) {
  return {
    id: Number(row.id) || 0,
    ownerOpenid: row.openid || '',
    plantPetId: Number(row.plant_pet_id || row.plantPetId) || 0,
    plantPetName: row.plant_pet_name || row.plantPetName || '',
    taskType: row.task_type || row.taskType || 'other',
    title: row.title || '',
    description: row.description_text || row.description || '',
    scheduledFor: row.scheduled_for || row.scheduledFor || '',
    reminderTime: row.reminder_time || row.reminderTime || '',
    recurrenceType: row.recurrence_type || row.recurrenceType || 'none',
    recurrenceInterval: Number(row.recurrence_interval || row.recurrenceInterval) || 1,
    recurrenceParentId: Number(row.recurrence_parent_id || row.recurrenceParentId) || null,
    source: row.source || 'manual',
    status: row.status || 'pending',
    completedAt: row.completed_at || row.completedAt || null,
    createdAt: row.created_at || row.createdAt || null,
    updatedAt: row.updated_at || row.updatedAt || null
  };
}

function calculateCareStreak(dayRows = [], today = shanghaiDateFromMs()) {
  const normalized = dayRows
    .map((row) => ({
      date: row.schedule_date || row.scheduledFor || row.date || '',
      pending: Number(row.pending_count ?? row.pending ?? 0),
      total: Number(row.total_count ?? row.total ?? 0)
    }))
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && row.date <= today && row.total > 0)
    .sort((a, b) => b.date.localeCompare(a.date));

  let streak = 0;
  for (const row of normalized) {
    if (row.pending > 0) {
      if (row.date === today) continue;
      break;
    }
    streak += 1;
  }
  return streak;
}

async function assertActivePlantPet(db, openid, plantPetId) {
  const [rows] = await db.execute(
    `SELECT id FROM plant_pets WHERE id = ? AND openid = ? AND status = 'active' LIMIT 1`,
    [plantPetId, openid]
  );
  return rows.length > 0;
}

async function listCareTasksForUser(db, openid, input = {}) {
  const clauses = ['t.openid = ?', 't.plant_pet_id IS NOT NULL'];
  const params = [openid];

  if (input.taskId) {
    const taskId = Number(input.taskId) || 0;
    if (!taskId) return { success: false, msg: '任务标识无效' };
    clauses.push('t.id = ?');
    params.push(taskId);
  }
  if (input.plantPetId) {
    const plantPetId = Number(input.plantPetId) || 0;
    if (!plantPetId) return { success: false, msg: '植宠标识无效' };
    clauses.push('t.plant_pet_id = ?');
    params.push(plantPetId);
  }
  if (input.startDate) {
    const start = normalizeDateInput(input.startDate, '开始日期');
    if (!start.ok) return { success: false, msg: start.msg };
    clauses.push('t.scheduled_for >= ?');
    params.push(start.value);
  }
  if (input.endDate) {
    const end = normalizeDateInput(input.endDate, '结束日期');
    if (!end.ok) return { success: false, msg: end.msg };
    clauses.push('t.scheduled_for <= ?');
    params.push(end.value);
  }
  const status = normalizeText(input.status || 'all', 16).toLowerCase();
  if (!['all', 'pending', 'completed'].includes(status)) {
    return { success: false, msg: '任务状态无效' };
  }
  if (status !== 'all') {
    clauses.push('t.status = ?');
    params.push(status);
  }
  if (input.includeArchivedPlants !== true) clauses.push("pp.status = 'active'");

  const [rows] = await db.execute(
    `${CARE_TASK_SELECT}
     WHERE ${clauses.join(' AND ')}
     ORDER BY t.scheduled_for ASC, COALESCE(t.reminder_time, '23:59:59') ASC, t.id ASC`,
    params
  );
  return { success: true, tasks: rows.map(mapCareTaskRow) };
}

async function getCareTaskForUser(db, openid, input = {}) {
  const result = await listCareTasksForUser(db, openid, {
    taskId: input.taskId,
    includeArchivedPlants: true
  });
  if (!result.success) return result;
  if (!result.tasks.length) return { success: false, msg: '任务不存在或无权访问' };
  return { success: true, task: result.tasks[0] };
}

async function insertCareTaskRecord(db, openid, value, now = shanghaiDateTimeFromMs()) {
  const [result] = await db.execute(
    `INSERT INTO todos
      (openid, logical_key, plant_pet_id, task_type, title, urgent, icon, icon_color, icon_bg,
       description_text, scheduled_for, reminder_time, recurrence_type, recurrence_interval,
       recurrence_parent_id, source, status, completed_at, created_at, updated_at)
     VALUES (?, '', ?, ?, ?, 0, '📝', 'text-green-600', 'bg-green-50', ?, ?, ?, ?, ?, NULL, ?, 'pending', NULL, ?, ?)`,
    [
      openid,
      value.plantPetId,
      value.taskType,
      value.title,
      value.description || null,
      value.scheduledFor,
      value.reminderTime,
      value.recurrenceType,
      value.recurrenceInterval,
      value.source,
      now,
      now
    ]
  );
  return Number(result.insertId) || 0;
}

async function createCareTaskForUser(db, openid, input = {}) {
  const requestedSource = normalizeText(input.source || 'manual', 32).toLowerCase();
  if (requestedSource !== 'manual') {
    return { success: false, msg: 'AI 建议任务只能从待确认候选创建' };
  }
  const validated = validateTaskInput({ ...input, source: 'manual' });
  if (!validated.ok) return { success: false, msg: validated.msg };
  const value = validated.value;
  if (!(await assertActivePlantPet(db, openid, value.plantPetId))) {
    return { success: false, msg: '植宠不存在、已归档或无权访问' };
  }

  const taskId = await insertCareTaskRecord(db, openid, value);
  return getCareTaskForUser(db, openid, { taskId });
}

async function updateCareTaskForUser(db, openid, input = {}) {
  const taskId = Number(input.taskId) || 0;
  if (!taskId) return { success: false, msg: '任务标识无效' };
  const current = await getCareTaskForUser(db, openid, { taskId });
  if (!current.success) return current;
  if (current.task.status !== 'pending') return { success: false, msg: '已完成任务不能编辑' };

  const validated = validateTaskInput({
    ...current.task,
    ...input,
    source: current.task.source,
    confirmed: true
  });
  if (!validated.ok) return { success: false, msg: validated.msg };
  const value = validated.value;
  if (!(await assertActivePlantPet(db, openid, value.plantPetId))) {
    return { success: false, msg: '植宠不存在、已归档或无权访问' };
  }

  const now = shanghaiDateTimeFromMs();
  await db.execute(
    `UPDATE todos
     SET plant_pet_id = ?, task_type = ?, title = ?, description_text = ?, scheduled_for = ?,
         reminder_time = ?, recurrence_type = ?, recurrence_interval = ?, updated_at = ?
     WHERE id = ? AND openid = ? AND status = 'pending'`,
    [
      value.plantPetId,
      value.taskType,
      value.title,
      value.description || null,
      value.scheduledFor,
      value.reminderTime,
      value.recurrenceType,
      value.recurrenceInterval,
      now,
      taskId,
      openid
    ]
  );
  return getCareTaskForUser(db, openid, { taskId });
}

async function postponeCareTaskForUser(db, openid, input = {}) {
  const taskId = Number(input.taskId) || 0;
  const scheduledFor = normalizeDateInput(input.scheduledFor);
  if (!taskId) return { success: false, msg: '任务标识无效' };
  if (!scheduledFor.ok) return { success: false, msg: scheduledFor.msg };
  const now = shanghaiDateTimeFromMs();
  const [result] = await db.execute(
    `UPDATE todos t
     INNER JOIN plant_pets pp ON pp.id = t.plant_pet_id AND pp.openid = t.openid
     SET t.scheduled_for = ?, t.updated_at = ?
     WHERE t.id = ? AND t.openid = ? AND t.status = 'pending' AND pp.status = 'active'`,
    [scheduledFor.value, now, taskId, openid]
  );
  if (!result.affectedRows) return { success: false, msg: '任务不存在、已完成或无权访问' };
  return getCareTaskForUser(db, openid, { taskId });
}

async function deleteCareTaskForUser(db, openid, input = {}) {
  const taskId = Number(input.taskId) || 0;
  if (!taskId) return { success: false, msg: '任务标识无效' };
  const [owned] = await db.execute('SELECT id FROM todos WHERE id = ? AND openid = ? LIMIT 1', [taskId, openid]);
  if (!owned.length) return { success: false, msg: '任务不存在或无权访问' };
  await db.execute('DELETE FROM care_events WHERE task_id = ? AND openid = ?', [taskId, openid]);
  await db.execute('DELETE FROM todos WHERE id = ? AND openid = ?', [taskId, openid]);
  return { success: true, taskId };
}

async function withTransaction(db, callback) {
  const connection = typeof db.getConnection === 'function' ? await db.getConnection() : db;
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    if (connection !== db && typeof connection.release === 'function') connection.release();
  }
}

async function completeCareTaskForUser(db, openid, input = {}) {
  const taskId = Number(input.taskId) || 0;
  if (!taskId) return { success: false, msg: '任务标识无效' };
  const completedAt = shanghaiDateTimeFromMs();
  const completedDate = completedAt.slice(0, 10);

  const result = await withTransaction(db, async (connection) => {
    const [rows] = await connection.execute(
      `SELECT t.*, pp.nickname AS plant_pet_name, pp.status AS plant_pet_status
       FROM todos t
       INNER JOIN plant_pets pp ON pp.id = t.plant_pet_id AND pp.openid = t.openid
       WHERE t.id = ? AND t.openid = ?
       LIMIT 1 FOR UPDATE`,
      [taskId, openid]
    );
    if (!rows.length) return { success: false, msg: '任务不存在或无权访问' };
    const row = rows[0];
    if (row.plant_pet_status !== 'active') return { success: false, msg: '已归档植宠的任务不能打卡' };
    if (row.status !== 'pending') return { success: false, msg: '任务已经完成' };

    await connection.execute(
      `UPDATE todos SET status = 'completed', completed_at = ?, updated_at = ?
       WHERE id = ? AND openid = ? AND status = 'pending'`,
      [completedAt, completedAt, taskId, openid]
    );
    await connection.execute(
      `INSERT INTO care_events
        (openid, plant_pet_id, task_id, event_date, event_type, task_type, title, source, created_at)
       VALUES (?, ?, ?, ?, 'task_completed', ?, ?, ?, ?)`,
      [openid, row.plant_pet_id, taskId, completedDate, row.task_type, row.title, row.source, completedAt]
    );

    let nextTaskId = 0;
    const nextDate = getNextScheduledDate(completedDate, row.recurrence_type, row.recurrence_interval);
    if (nextDate) {
      const [next] = await connection.execute(
        `INSERT INTO todos
          (openid, logical_key, plant_pet_id, task_type, title, urgent, icon, icon_color, icon_bg,
           description_text, scheduled_for, reminder_time, recurrence_type, recurrence_interval,
           recurrence_parent_id, source, status, completed_at, created_at, updated_at)
         VALUES (?, '', ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?)`,
        [
          openid,
          row.plant_pet_id,
          row.task_type,
          row.title,
          row.icon || '📝',
          row.icon_color || 'text-green-600',
          row.icon_bg || 'bg-green-50',
          row.description_text || null,
          nextDate,
          row.reminder_time || null,
          row.recurrence_type,
          row.recurrence_interval || 1,
          row.recurrence_parent_id || row.id,
          row.source,
          completedAt,
          completedAt
        ]
      );
      nextTaskId = Number(next.insertId) || 0;
    }
    return { success: true, taskId, nextTaskId };
  });

  if (!result.success) return result;
  const completedTask = await getCareTaskForUser(db, openid, { taskId });
  const nextTask = result.nextTaskId
    ? await getCareTaskForUser(db, openid, { taskId: result.nextTaskId })
    : null;
  await syncCareBadges(db, openid);
  return {
    success: true,
    task: completedTask.task,
    nextTask: nextTask?.task || null
  };
}

async function loadCareDayRows(db, openid, today) {
  const [rows] = await db.execute(
    `SELECT DATE_FORMAT(t.scheduled_for, '%Y-%m-%d') AS schedule_date,
            COUNT(*) AS total_count,
            SUM(CASE WHEN t.status = 'pending' THEN 1 ELSE 0 END) AS pending_count
     FROM todos t
     INNER JOIN plant_pets pp ON pp.id = t.plant_pet_id AND pp.openid = t.openid
     WHERE t.openid = ? AND t.plant_pet_id IS NOT NULL AND t.scheduled_for <= ?
     GROUP BY t.scheduled_for
     ORDER BY t.scheduled_for DESC`,
    [openid, today]
  );
  return rows;
}

async function syncCareBadges(db, openid, streakOverride) {
  const today = shanghaiDateFromMs();
  const [petRows] = await db.execute('SELECT COUNT(*) AS total FROM plant_pets WHERE openid = ?', [openid]);
  const [eventRows] = await db.execute('SELECT COUNT(*) AS total FROM care_events WHERE openid = ?', [openid]);
  const [journalRows] = await db.execute(
    'SELECT COUNT(*) AS total FROM plant_journal WHERE openid = ? AND plant_pet_id IS NOT NULL',
    [openid]
  );
  const streak = streakOverride === undefined
    ? calculateCareStreak(await loadCareDayRows(db, openid, today), today)
    : Number(streakOverride) || 0;
  const earned = [];
  if (Number(petRows[0]?.total) > 0) earned.push('first_plant_pet');
  if (Number(eventRows[0]?.total) > 0) earned.push('first_checkin');
  if (Number(journalRows[0]?.total) > 0) earned.push('first_journal');
  if (streak >= 3) earned.push('streak_3');
  if (streak >= 7) earned.push('streak_7');
  const now = shanghaiDateTimeFromMs();
  for (const key of earned) {
    await db.execute(
      `INSERT IGNORE INTO user_badges (openid, badge_key, earned_at, context_json)
       VALUES (?, ?, ?, ?)`,
      [openid, key, now, JSON.stringify(key.startsWith('streak_') ? { streak } : {})]
    );
  }
  return { streak, earned };
}

async function getCareSummaryForUser(db, openid) {
  const today = shanghaiDateFromMs();
  const tasks = await listCareTasksForUser(db, openid, {
    startDate: '2000-01-01',
    endDate: today,
    status: 'pending'
  });
  if (!tasks.success) return tasks;
  const todayTasks = tasks.tasks.filter((task) => task.scheduledFor === today);
  const overdueTasks = tasks.tasks.filter((task) => task.scheduledFor < today);
  const dayRows = await loadCareDayRows(db, openid, today);
  const streak = calculateCareStreak(dayRows, today);
  await syncCareBadges(db, openid, streak);
  const [badgeRows] = await db.execute(
    `SELECT badge_key, DATE_FORMAT(earned_at, '%Y-%m-%d %H:%i:%s') AS earned_at
     FROM user_badges WHERE openid = ? ORDER BY earned_at ASC, id ASC`,
    [openid]
  );
  const earnedMap = new Map(badgeRows.map((row) => [row.badge_key, row.earned_at]));
  return {
    success: true,
    today,
    streak,
    todayTasks,
    overdueTasks,
    badges: BADGE_DEFINITIONS.map((badge) => ({
      ...badge,
      earned: earnedMap.has(badge.key),
      earnedAt: earnedMap.get(badge.key) || null
    }))
  };
}

async function listCareEventsForUser(db, openid, input = {}) {
  const clauses = ['ce.openid = ?'];
  const params = [openid];
  if (input.plantPetId) {
    clauses.push('ce.plant_pet_id = ?');
    params.push(Number(input.plantPetId) || 0);
  }
  const [rows] = await db.execute(
    `SELECT ce.id, ce.plant_pet_id, ce.task_id,
            DATE_FORMAT(ce.event_date, '%Y-%m-%d') AS event_date,
            ce.event_type, ce.task_type, ce.title, ce.source,
            DATE_FORMAT(ce.created_at, '%Y-%m-%d %H:%i:%s') AS created_at
     FROM care_events ce
     WHERE ${clauses.join(' AND ')}
     ORDER BY ce.event_date DESC, ce.id DESC`,
    params
  );
  return {
    success: true,
    events: rows.map((row) => ({
      id: Number(row.id) || 0,
      plantPetId: Number(row.plant_pet_id) || 0,
      taskId: Number(row.task_id) || 0,
      eventDate: row.event_date || '',
      eventType: row.event_type || 'task_completed',
      taskType: row.task_type || 'other',
      title: row.title || '',
      source: row.source || 'manual',
      createdAt: row.created_at || null
    }))
  };
}

module.exports = {
  TASK_TYPES,
  RECURRENCE_TYPES,
  TASK_SOURCES,
  BADGE_DEFINITIONS,
  CARE_TASK_SELECT,
  normalizeDateInput,
  normalizeTimeInput,
  validateTaskInput,
  shanghaiDateFromMs,
  shanghaiDateTimeFromMs,
  addDays,
  addMonthsClamped,
  getNextScheduledDate,
  mapCareTaskRow,
  calculateCareStreak,
  withTransaction,
  syncCareBadges,
  listCareTasksForUser,
  getCareTaskForUser,
  insertCareTaskRecord,
  createCareTaskForUser,
  updateCareTaskForUser,
  postponeCareTaskForUser,
  deleteCareTaskForUser,
  completeCareTaskForUser,
  getCareSummaryForUser,
  listCareEventsForUser
};
