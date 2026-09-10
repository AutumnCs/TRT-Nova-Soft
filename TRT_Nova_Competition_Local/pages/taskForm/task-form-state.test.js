const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveTaskFormContext,
  formFromTaskProposal,
  buildTaskSubmissionPayload,
  proposalUnavailableMessage
} = require('./task-form-state');

test('AI 表单只从 proposalKey 进入，旧版纯本地候选会被拒绝', () => {
  const context = resolveTaskFormContext(
    { fromAi: '1' },
    { source: 'ai', title: '没有服务端凭据的旧候选' }
  );
  assert.equal(context.mode, 'create');
  assert.equal(context.missingProposalKey, true);

  const proposalContext = resolveTaskFormContext(
    { fromAi: '1' },
    { source: 'ai', proposalKey: 'proposal-owner-a-001' }
  );
  assert.equal(proposalContext.mode, 'proposal');
  assert.equal(proposalContext.proposalKey, 'proposal-owner-a-001');
  assert.equal(proposalContext.missingProposalKey, false);
});

test('后端 proposal 预填表单并固定植宠', () => {
  const form = formFromTaskProposal({
    proposalKey: 'proposal-owner-a-001',
    plantPetId: 9,
    payload: {
      plantPetId: 999,
      taskType: 'inspection',
      title: '观察新叶',
      scheduledFor: '2026-09-10',
      reminderTime: null,
      recurrenceType: 'weekly',
      recurrenceInterval: 2
    }
  });
  assert.equal(form.plantPetId, 9);
  assert.equal(form.source, 'ai');
  assert.equal(form.reminderEnabled, false);
  assert.equal(form.recurrenceInterval, 2);
});

test('proposal 确认 payload 只含 key 和可编辑字段，不发送 confirmed/source', () => {
  const payload = buildTaskSubmissionPayload('proposal', {
    plantPetId: 9,
    taskType: 'inspection',
    title: '  检查新叶和叶背  ',
    description: '  记录斑点  ',
    scheduledFor: '2026-09-12',
    reminderEnabled: true,
    reminderTime: '10:45',
    recurrenceType: 'weekly',
    recurrenceInterval: '1',
    source: 'ai'
  }, 'proposal-owner-a-001');
  assert.deepEqual(payload, {
    proposalKey: 'proposal-owner-a-001',
    plantPetId: 9,
    taskType: 'inspection',
    title: '检查新叶和叶背',
    description: '记录斑点',
    scheduledFor: '2026-09-12',
    reminderTime: '10:45',
    recurrenceType: 'weekly',
    recurrenceInterval: 1
  });
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'confirmed'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'source'), false);
});

test('手工任务始终以 manual 来源提交，proposal 状态有明确文案', () => {
  const payload = buildTaskSubmissionPayload('create', {
    plantPetId: 9,
    taskType: 'watering',
    title: '浇水',
    description: '',
    scheduledFor: '2026-09-12',
    reminderEnabled: false,
    reminderTime: '09:00',
    recurrenceType: 'none',
    recurrenceInterval: 1,
    source: 'ai'
  });
  assert.equal(payload.source, 'manual');
  assert.equal(payload.reminderTime, null);
  assert.match(proposalUnavailableMessage('confirmed'), /已经创建/);
  assert.match(proposalUnavailableMessage('cancelled'), /已经取消/);
  assert.match(proposalUnavailableMessage('expired'), /已经过期/);
});
