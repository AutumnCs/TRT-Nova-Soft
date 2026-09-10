import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import { Agent } from '@earendil-works/pi-agent-core';
import {
  EventStream,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  registerFauxProvider,
  streamSimple
} from '@earendil-works/pi-ai/compat';
import { Type } from 'typebox';

const require = createRequire(import.meta.url);
const { loadPiAgentCore } = require('./cjs-bridge.cjs');

function textOf(message) {
  return (message?.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

class ControlledAssistantStream extends EventStream {
  constructor() {
    super(
      (event) => event.type === 'done' || event.type === 'error',
      (event) => event.type === 'done' ? event.message : event.error
    );
  }
}

function createAgent(faux, tools = [], options = {}) {
  return new Agent({
    streamFn: streamSimple,
    initialState: {
      systemPrompt: 'NOVA test runtime. Use only the supplied test tools.',
      model: faux.getModel(),
      thinkingLevel: 'off',
      tools
    },
    ...options
  });
}

function selectedPlantTool(onExecute = () => {}) {
  return {
    name: 'get_selected_plant',
    label: '读取当前植宠',
    description: 'Read one already-authorized selected PlantPet.',
    parameters: Type.Object({
      plantPetId: Type.Number({ minimum: 1 })
    }, { additionalProperties: false }),
    async execute(_toolCallId, params) {
      onExecute(params);
      return {
        content: [{ type: 'text', text: '当前植宠是 2 号月季“小红”。' }],
        details: { plantPetId: params.plantPetId, species: '月季', nickname: '小红' }
      };
    }
  };
}

function proposeTaskTool(onExecute = () => {}) {
  return {
    name: 'propose_care_task',
    label: '生成任务候选',
    description: 'Create an editable proposal only. It cannot write a formal care task.',
    parameters: Type.Object({
      plantPetId: Type.Number({ minimum: 1 }),
      title: Type.String({ minLength: 1, maxLength: 80 }),
      dueAt: Type.String({ minLength: 1 })
    }, { additionalProperties: false }),
    async execute(_toolCallId, params) {
      onExecute(params);
      return {
        content: [{ type: 'text', text: `已生成待确认候选：${params.title}` }],
        details: {
          proposalId: 'proposal-test-1',
          status: 'proposed',
          sideEffect: 'proposal_only',
          ...params
        }
      };
    }
  };
}

async function withFaux(options, responses, run) {
  const faux = registerFauxProvider(options);
  faux.setResponses(responses);
  try {
    return await run(faux);
  } finally {
    faux.unregister();
  }
}

async function promptWithDeadline(agent, prompt, timeoutMs) {
  const timer = setTimeout(() => agent.abort(), timeoutMs);
  try {
    await agent.prompt(prompt);
  } finally {
    clearTimeout(timer);
  }
}

test('CommonJS entry can load the ESM PI core through a cached bridge', async () => {
  const loaded = await loadPiAgentCore();
  assert.equal(loaded.Agent, Agent);
});

test('PI Agent performs a two-step read then proposal tool loop and emits ordered events', async () => {
  const executed = [];
  const responses = [
    fauxAssistantMessage([
      fauxText('我先读取当前植宠。'),
      fauxToolCall('get_selected_plant', { plantPetId: 2 }, { id: 'plant-call-1' })
    ], { stopReason: 'toolUse' }),
    fauxAssistantMessage([
      fauxText('已经确认对象，现在生成待确认任务。'),
      fauxToolCall('propose_care_task', {
        plantPetId: 2,
        title: '观察新叶',
        dueAt: '2026-09-04T09:00:00+08:00'
      }, { id: 'proposal-call-1' })
    ], { stopReason: 'toolUse' }),
    fauxAssistantMessage('我准备好了“观察新叶”任务候选，请你预览并确认。')
  ];

  await withFaux({}, responses, async (faux) => {
    const events = [];
    const agent = createAgent(faux, [
      selectedPlantTool((params) => executed.push(['get_selected_plant', params])),
      proposeTaskTool((params) => executed.push(['propose_care_task', params]))
    ], { toolExecution: 'sequential' });
    agent.subscribe((event) => events.push(event.type));

    await agent.prompt('帮我安排一个明天观察新叶的任务');

    assert.deepEqual(executed.map(([name]) => name), [
      'get_selected_plant',
      'propose_care_task'
    ]);
    const toolResults = agent.state.messages.filter((message) => message.role === 'toolResult');
    assert.equal(toolResults.length, 2);
    assert.equal(toolResults[0].isError, false);
    assert.equal(toolResults[1].isError, false);
    assert.equal(toolResults[1].details.sideEffect, 'proposal_only');
    assert.match(textOf(agent.state.messages.at(-1)), /预览并确认/);
    assert.equal(events[0], 'agent_start');
    assert.equal(events.at(-1), 'agent_end');
    assert.equal(events.filter((type) => type === 'turn_start').length, 3);
    assert.equal(events.filter((type) => type === 'tool_execution_start').length, 2);
    assert.equal(events.filter((type) => type === 'tool_execution_end').length, 2);
  });
});

test('invalid tool arguments are rejected before the application tool executes', async () => {
  let executionCount = 0;
  const responses = [
    fauxAssistantMessage([
      fauxToolCall('get_selected_plant', { plantPetId: 'other-user' }, { id: 'invalid-call-1' })
    ], { stopReason: 'toolUse' }),
    fauxAssistantMessage('这个工具参数无效，我不会把它当成真实植宠。')
  ];

  await withFaux({}, responses, async (faux) => {
    const agent = createAgent(faux, [selectedPlantTool(() => { executionCount += 1; })]);
    await agent.prompt('读取一个伪造的植宠');

    assert.equal(executionCount, 0);
    const toolResult = agent.state.messages.find((message) => message.role === 'toolResult');
    assert.ok(toolResult);
    assert.equal(toolResult.isError, true);
    assert.match(textOf(toolResult), /validation|number|invalid/i);
  });
});

test('beforeToolCall can block a schema-valid direct business write', async () => {
  let executionCount = 0;
  const directWriteTool = {
    name: 'direct_business_write',
    label: '正式写入任务',
    description: 'A deliberately forbidden spike tool.',
    parameters: Type.Object({ title: Type.String() }, { additionalProperties: false }),
    async execute() {
      executionCount += 1;
      return { content: [{ type: 'text', text: 'should never execute' }], details: {} };
    }
  };
  const responses = [
    fauxAssistantMessage([
      fauxToolCall('direct_business_write', { title: '越权任务' }, { id: 'blocked-call-1' })
    ], { stopReason: 'toolUse' }),
    fauxAssistantMessage('正式写入被策略层阻止。')
  ];

  await withFaux({}, responses, async (faux) => {
    const agent = createAgent(faux, [directWriteTool], {
      beforeToolCall: async ({ toolCall }) => {
        if (toolCall.name === 'direct_business_write') {
          return { block: true, reason: 'formal writes require user confirmation through api-scf' };
        }
        return undefined;
      }
    });
    await agent.prompt('直接创建正式任务');

    assert.equal(executionCount, 0);
    const toolResult = agent.state.messages.find((message) => message.role === 'toolResult');
    assert.ok(toolResult);
    assert.equal(toolResult.isError, true);
    assert.match(textOf(toolResult), /user confirmation/);
  });
});

test('runtime can enforce a maximum completed-turn budget', async () => {
  let completedTurns = 0;
  let executionCount = 0;
  const responses = [
    fauxAssistantMessage([
      fauxToolCall('get_selected_plant', { plantPetId: 2 }, { id: 'bounded-call-1' })
    ], { stopReason: 'toolUse' }),
    fauxAssistantMessage('This response must not be requested.')
  ];

  await withFaux({}, responses, async (faux) => {
    const agent = createAgent(faux, [selectedPlantTool(() => { executionCount += 1; })], {
      shouldStopAfterTurn: async () => {
        completedTurns += 1;
        return completedTurns >= 1;
      }
    });
    await agent.prompt('读取当前植宠，然后继续循环');

    assert.equal(executionCount, 1);
    assert.equal(completedTurns, 1);
    assert.equal(agent.state.messages.filter((message) => message.role === 'assistant').length, 1);
    assert.equal(agent.state.messages.at(-1).role, 'toolResult');
  });
});

test('runtime deadline aborts an in-flight model response and still emits agent_end', async () => {
  const streamFn = (_model, _context, options = {}) => {
    const stream = new ControlledAssistantStream();
    const normalTimer = setTimeout(() => {
      const message = fauxAssistantMessage('This response should have been aborted.');
      stream.push({ type: 'done', reason: 'stop', message });
    }, 5000);
    const finishAborted = () => {
      clearTimeout(normalTimer);
      const message = fauxAssistantMessage('', {
        stopReason: 'aborted',
        errorMessage: 'runtime deadline exceeded'
      });
      stream.push({ type: 'done', reason: 'aborted', message });
    };
    if (options.signal?.aborted) queueMicrotask(finishAborted);
    else options.signal?.addEventListener('abort', finishAborted, { once: true });
    return stream;
  };
  const agent = new Agent({ streamFn });
  const events = [];
  agent.subscribe((event) => events.push(event.type));
  const startedAt = performance.now();

  await promptWithDeadline(agent, '缓慢输出一段内容', 30);

  const elapsedMs = performance.now() - startedAt;
  const finalMessage = agent.state.messages.at(-1);
  assert.equal(agent.state.isStreaming, false);
  assert.equal(finalMessage.role, 'assistant');
  assert.equal(finalMessage.stopReason, 'aborted');
  assert.equal(finalMessage.errorMessage, 'runtime deadline exceeded');
  assert.equal(events.at(-1), 'agent_end');
  assert.ok(elapsedMs < 1000, `abort took too long: ${elapsedMs}ms`);
});
