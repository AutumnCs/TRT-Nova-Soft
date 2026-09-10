const ScfApiAdapter = require('../core/ScfApiAdapter');

const scfApiAdapter = new ScfApiAdapter();

function normalizeTodoRow(row = {}) {
  return {
    _id: row._id || row.id || '',
    id: row.id || row._id || '',
    openid: row.openid || '',
    logicalKey: row.logicalKey || row.logical_key || '',
    title: row.title || row.content || '',
    urgent: Boolean(row.urgent),
    icon: row.icon || '📝',
    iconColor: row.iconColor || row.icon_color || 'text-blue-500',
    iconBg: row.iconBg || row.icon_bg || 'bg-blue-50',
    desc: row.desc || row.descriptionText || row.description_text || '',
    status: row.status || 'pending',
    createdAt: row.createdAt || row.created_at || null,
    updatedAt: row.updatedAt || row.updated_at || null
  };
}

function normalizeCareTaskRow(row = {}) {
  return {
    id: Number(row.id) || 0,
    ownerOpenid: row.ownerOpenid || row.openid || '',
    plantPetId: Number(row.plantPetId || row.plant_pet_id) || 0,
    plantPetName: row.plantPetName || row.plant_pet_name || '',
    taskType: row.taskType || row.task_type || 'other',
    title: row.title || '',
    description: row.description || row.description_text || '',
    scheduledFor: row.scheduledFor || row.scheduled_for || '',
    reminderTime: row.reminderTime || row.reminder_time || '',
    recurrenceType: row.recurrenceType || row.recurrence_type || 'none',
    recurrenceInterval: Number(row.recurrenceInterval || row.recurrence_interval) || 1,
    recurrenceParentId: Number(row.recurrenceParentId || row.recurrence_parent_id) || null,
    source: row.source || 'manual',
    status: row.status || 'pending',
    completedAt: row.completedAt || row.completed_at || null,
    createdAt: row.createdAt || row.created_at || null,
    updatedAt: row.updatedAt || row.updated_at || null
  };
}

function normalizeTaskProposal(input = {}) {
  const payload = input.payload && typeof input.payload === 'object' ? input.payload : {};
  return {
    proposalKey: input.proposalKey || input.proposal_key || '',
    proposalType: input.proposalType || input.proposal_type || 'care_task',
    conversationId: Number(input.conversationId || input.conversation_id) || 0,
    plantPetId: Number(input.plantPetId || input.plant_pet_id || payload.plantPetId) || 0,
    plantPetName: input.plantPetName || input.plant_pet_name || '',
    payload: {
      plantPetId: Number(input.plantPetId || input.plant_pet_id || payload.plantPetId) || 0,
      taskType: payload.taskType || payload.task_type || 'inspection',
      title: payload.title || '',
      description: payload.description || payload.description_text || '',
      scheduledFor: payload.scheduledFor || payload.scheduled_for || '',
      reminderTime: Object.prototype.hasOwnProperty.call(payload, 'reminderTime')
        ? payload.reminderTime
        : (payload.reminder_time ?? '09:00'),
      recurrenceType: payload.recurrenceType || payload.recurrence_type || 'none',
      recurrenceInterval: Number(payload.recurrenceInterval || payload.recurrence_interval) || 1
    },
    status: input.status || 'unavailable',
    expiresAt: input.expiresAt || input.expires_at || '',
    consumedTaskId: Number(input.consumedTaskId || input.consumed_target_id) || 0,
    canConfirm: input.canConfirm === true
  };
}

function assertSuccess(result, fallbackMessage) {
  if (result?.success === false) throw new Error(result.msg || fallbackMessage);
  return result || {};
}

class TodoService {
  async listCareTasks(filters = {}) {
    const result = assertSuccess(
      await scfApiAdapter.listCareTasks(filters),
      '任务加载失败'
    );
    return Array.isArray(result.tasks) ? result.tasks.map(normalizeCareTaskRow) : [];
  }

  async getCareTask(taskId) {
    const result = assertSuccess(await scfApiAdapter.getCareTask(taskId), '任务加载失败');
    return normalizeCareTaskRow(result.task);
  }

  async createCareTask(payload = {}) {
    const source = String(payload.source || 'manual').trim().toLowerCase();
    if (source !== 'manual') throw new Error('AI 建议任务只能从待确认候选创建');
    const { confirmed, proposalKey, ...manualPayload } = payload;
    const result = assertSuccess(
      await scfApiAdapter.createCareTask({ ...manualPayload, source: 'manual' }),
      '任务创建失败'
    );
    return normalizeCareTaskRow(result.task);
  }

  async getCareTaskProposal(proposalKey) {
    const result = assertSuccess(
      await scfApiAdapter.getCareTaskProposal(proposalKey),
      '任务候选加载失败'
    );
    return normalizeTaskProposal(result.proposal);
  }

  async confirmCareTaskProposal(payload = {}) {
    const result = assertSuccess(
      await scfApiAdapter.confirmCareTaskProposal(payload),
      '任务候选确认失败'
    );
    return {
      task: normalizeCareTaskRow(result.task),
      proposal: normalizeTaskProposal(result.proposal)
    };
  }

  async cancelCareTaskProposal(proposalKey) {
    const result = assertSuccess(
      await scfApiAdapter.cancelCareTaskProposal(proposalKey),
      '任务候选取消失败'
    );
    return normalizeTaskProposal(result.proposal);
  }

  async updateCareTask(payload = {}) {
    const result = assertSuccess(await scfApiAdapter.updateCareTask(payload), '任务更新失败');
    return normalizeCareTaskRow(result.task);
  }

  async postponeCareTask(taskId, scheduledFor) {
    const result = assertSuccess(
      await scfApiAdapter.postponeCareTask({ taskId, scheduledFor }),
      '任务延期失败'
    );
    return normalizeCareTaskRow(result.task);
  }

  async deleteCareTask(taskId) {
    return assertSuccess(await scfApiAdapter.deleteCareTask(taskId), '任务删除失败');
  }

  async completeCareTask(taskId) {
    const result = assertSuccess(await scfApiAdapter.completeCareTask(taskId), '任务打卡失败');
    return {
      task: normalizeCareTaskRow(result.task),
      nextTask: result.nextTask ? normalizeCareTaskRow(result.nextTask) : null
    };
  }

  async getCareSummary() {
    const result = assertSuccess(await scfApiAdapter.getCareSummary(), '养护概览加载失败');
    return {
      today: result.today || '',
      streak: Number(result.streak) || 0,
      todayTasks: Array.isArray(result.todayTasks) ? result.todayTasks.map(normalizeCareTaskRow) : [],
      overdueTasks: Array.isArray(result.overdueTasks) ? result.overdueTasks.map(normalizeCareTaskRow) : [],
      badges: Array.isArray(result.badges) ? result.badges : []
    };
  }

  async listCareEvents(filters = {}) {
    const result = assertSuccess(await scfApiAdapter.listCareEvents(filters), '养护记录加载失败');
    return Array.isArray(result.events) ? result.events : [];
  }

  async getTodos(logicalKey = '') {
    try {
      const res = await scfApiAdapter.getTodos(logicalKey);
      const todos = res?.todos || res?.data || [];
      return Array.isArray(todos) ? todos.map(normalizeTodoRow) : [];
    } catch (err) {
      console.error('getTodos failed:', err);
      return [];
    }
  }

  async getGlobalTodos() {
    try {
      const res = await scfApiAdapter.getGlobalTodos();
      const todos = res?.todos || res?.data || [];
      return Array.isArray(todos) ? todos.map(normalizeTodoRow) : [];
    } catch (err) {
      console.error('getGlobalTodos failed:', err);
      return [];
    }
  }

  async addTodo(content, logicalKey = '') {
    try {
      const payload = {
        content: typeof content === 'string' ? content.trim() : '',
        logicalKey: logicalKey || ''
      };
      const res = await scfApiAdapter.addTodo(payload);
      return normalizeTodoRow(res?.todo || res?.data || res);
    } catch (err) {
      console.error('addTodo failed:', err);
      throw new Error(`addTodo failed: ${err.message}`);
    }
  }

  async toggleUrgency(todo, logicalKey = '') {
    try {
      const todoId = todo?._id || todo?.id || '';
      if (!todoId) throw new Error('todoId is required');
      const res = await scfApiAdapter.toggleTodoUrgency({
        todoId,
        logicalKey: logicalKey || todo?.logicalKey || ''
      });
      return normalizeTodoRow(res?.todo || res?.data || res);
    } catch (err) {
      console.error('toggleUrgency failed:', err);
      throw new Error(`toggleUrgency failed: ${err.message}`);
    }
  }

  async completeTodo(id, logicalKey = '') {
    try {
      const todoId = typeof id === 'string' ? id.trim() : String(id || '').trim();
      if (!todoId) throw new Error('todoId is required');
      const res = await scfApiAdapter.completeTodo({
        todoId,
        logicalKey: logicalKey || ''
      });
      return normalizeTodoRow(res?.todo || res?.data || res);
    } catch (err) {
      console.error('completeTodo failed:', err);
      throw new Error(`completeTodo failed: ${err.message}`);
    }
  }
}

module.exports = new TodoService();
module.exports.normalizeCareTaskRow = normalizeCareTaskRow;
module.exports.normalizeTaskProposal = normalizeTaskProposal;
