const { todayInShanghai } = require('../../services/modules/care-task-presenter');

function createDefaultForm(options = {}) {
  return {
    plantPetId: Number(options.plantPetId) || 0,
    taskType: options.taskType || 'watering',
    title: options.title || '',
    description: options.description || '',
    scheduledFor: options.scheduledFor || options.date || todayInShanghai(),
    reminderEnabled: options.reminderTime !== null,
    reminderTime: options.reminderTime || '09:00',
    recurrenceType: options.recurrenceType || 'none',
    recurrenceInterval: Number(options.recurrenceInterval) || 1,
    source: options.source || 'manual'
  };
}

function normalizeProposalKey(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(text)) return '';
  return text;
}

function resolveTaskFormContext(options = {}, cachedSuggestion = null) {
  const taskId = Number(options.taskId) || 0;
  const proposalKey = normalizeProposalKey(options.proposalKey || cachedSuggestion?.proposalKey || '');
  const requestedAiFlow = options.fromAi === true || options.fromAi === '1' || Boolean(cachedSuggestion);
  const mode = taskId ? 'edit' : (proposalKey ? 'proposal' : 'create');
  return {
    taskId,
    proposalKey,
    mode,
    missingProposalKey: requestedAiFlow && !taskId && !proposalKey
  };
}

function formFromCareTask(task = {}) {
  return createDefaultForm({
    plantPetId: task.plantPetId,
    taskType: task.taskType,
    title: task.title,
    description: task.description,
    scheduledFor: task.scheduledFor,
    reminderTime: task.reminderTime || null,
    recurrenceType: task.recurrenceType,
    recurrenceInterval: task.recurrenceInterval,
    source: task.source || 'manual'
  });
}

function formFromTaskProposal(proposal = {}) {
  const payload = proposal.payload && typeof proposal.payload === 'object' ? proposal.payload : {};
  return createDefaultForm({
    ...payload,
    plantPetId: Number(proposal.plantPetId || payload.plantPetId) || 0,
    source: 'ai'
  });
}

function buildTaskSubmissionPayload(mode, form = {}, proposalKey = '') {
  const editable = {
    plantPetId: Number(form.plantPetId) || 0,
    taskType: form.taskType,
    title: String(form.title || '').trim(),
    description: String(form.description || '').trim(),
    scheduledFor: form.scheduledFor,
    reminderTime: form.reminderEnabled ? form.reminderTime : null,
    recurrenceType: form.recurrenceType,
    recurrenceInterval: Number(form.recurrenceInterval) || 1
  };
  if (mode === 'proposal') {
    return { proposalKey: normalizeProposalKey(proposalKey), ...editable };
  }
  return { ...editable, source: mode === 'edit' ? (form.source || 'manual') : 'manual' };
}

function proposalUnavailableMessage(status) {
  if (status === 'confirmed') return '这个建议已经创建为任务，无需再次确认';
  if (status === 'cancelled') return '这个任务建议已经取消';
  if (status === 'expired') return '这个任务建议已经过期，请回到对话重新生成';
  return '这个任务建议当前不可确认';
}

module.exports = {
  createDefaultForm,
  normalizeProposalKey,
  resolveTaskFormContext,
  formFromCareTask,
  formFromTaskProposal,
  buildTaskSubmissionPayload,
  proposalUnavailableMessage
};
