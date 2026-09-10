const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeTaskProposal } = require('./TodoService');

test('TodoService 规范化 proposal 状态和可编辑 payload', () => {
  const proposal = normalizeTaskProposal({
    proposal_key: 'proposal-owner-a-001',
    proposal_type: 'care_task',
    conversation_id: 7,
    plant_pet_id: 9,
    plant_pet_name: '小月亮',
    status: 'pending',
    expires_at: '2026-09-11 09:00:00',
    canConfirm: true,
    payload: {
      task_type: 'inspection',
      title: '观察新叶',
      scheduled_for: '2026-09-10',
      reminderTime: null
    }
  });
  assert.equal(proposal.proposalKey, 'proposal-owner-a-001');
  assert.equal(proposal.plantPetId, 9);
  assert.equal(proposal.payload.taskType, 'inspection');
  assert.equal(proposal.payload.reminderTime, null);
  assert.equal(proposal.canConfirm, true);
});
