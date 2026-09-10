const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_IMAGE_BYTES,
  detectImageMime,
  validateImageInput,
  parseVisionContent,
  buildVisionPrompt,
  buildVisionRequest,
  analyzeImageWithVision
} = require('../lib/visionClient');
const {
  buildVisionTaskSuggestions,
  buildVisionConversationText,
  buildVisionConversationResponse,
  imageMatchesSelectedPlantPet,
  saveVisionExchangeWithMedia
} = require('../agent/visionHandler');

function tinyPngBuffer() {
  return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
}

test('Vision 只接受内容和声明一致的 JPEG、PNG 或 WebP', () => {
  const png = tinyPngBuffer();
  assert.equal(detectImageMime(png), 'image/png');
  assert.equal(validateImageInput({ mimeType: 'image/png', imageBase64: png.toString('base64') }).ok, true);
  assert.match(
    validateImageInput({ mimeType: 'image/jpeg', imageBase64: png.toString('base64') }).msg,
    /格式与声明不一致/
  );
  assert.match(validateImageInput({ mimeType: 'image/png', imageBase64: 'not-base64' }).msg, /格式无效/);
  const brokenPng = png.subarray(0, 24);
  assert.match(validateImageInput({ mimeType: 'image/png', imageBase64: brokenPng.toString('base64') }).msg, /不完整|损坏/);
});

test('Vision 在请求模型前拒绝超过 2 MB 的图片', () => {
  const tooLarge = Buffer.alloc(MAX_IMAGE_BYTES + 1, 1);
  tooLarge[0] = 0x89; tooLarge[1] = 0x50; tooLarge[2] = 0x4e; tooLarge[3] = 0x47;
  tooLarge[4] = 0x0d; tooLarge[5] = 0x0a; tooLarge[6] = 0x1a; tooLarge[7] = 0x0a;
  const result = validateImageInput({ mimeType: 'image/png', imageBase64: tooLarge.toString('base64') });
  assert.equal(result.ok, false);
  assert.match(result.msg, /超过 2 MB/);
});

test('Vision 结构化结果限制候选、置信度并保留不确定边界', () => {
  const result = parseVisionContent('```json\n' + JSON.stringify({
    isPlant: true,
    uncertain: true,
    reply: '我看到了叶缘轻微发黄，先检查盆土湿度会更稳妥。',
    candidates: [
      { name: '月季', confidence: 1.4, reason: '复叶与花型' },
      { name: '玫瑰', confidence: -1 },
      { name: '蔷薇', confidence: 0.4 },
      { name: '第四候选', confidence: 0.2 }
    ],
    visibleSigns: ['叶缘轻微发黄'],
    possibleCauses: [{ name: '可能的水分胁迫', evidence: '叶缘发黄', confidence: 0.5 }],
    advice: [{ title: '检查盆土', detail: '先摸表层两厘米', priority: 'now' }],
    reshootQuestions: ['请补拍叶背']
  }) + '\n```');
  assert.equal(result.isPlant, true);
  assert.equal(result.uncertain, true);
  assert.equal(result.candidates.length, 3);
  assert.equal(result.candidates[0].confidence, 1);
  assert.equal(result.candidates[1].confidence, 0);
  assert.match(result.reply, /叶缘轻微发黄/);
  assert.match(result.disclaimer, /不构成确定性病害结论/);
});

test('Vision 提示把随图文字作为本轮观察重点交给 NOVA', () => {
  const prompt = buildVisionPrompt('小月，月季，南窗台', '叶子边缘为什么发黄？需要现在浇水吗？');
  assert.match(prompt, /reply 用自然的 NOVA 口吻直接回应/);
  assert.match(prompt, /小月，月季，南窗台/);
  assert.match(prompt, /叶子边缘为什么发黄？需要现在浇水吗？/);
});

test('Vision 请求启用官方 JSON Output，DeepSeek 简单识别关闭多余推理', () => {
  const request = buildVisionRequest({
    model: 'deepseek-v4-flash-vision-exp',
    prompt: '只输出 JSON',
    mimeType: 'image/png',
    base64: tinyPngBuffer().toString('base64'),
    detail: 'low',
    maxTokens: 800
  });
  assert.deepEqual(request.response_format, { type: 'json_object' });
  assert.deepEqual(request.thinking, { type: 'disabled' });
  assert.equal(request.messages[0].content[1].type, 'image_url');
  assert.equal(request.max_tokens, 800);

  const otherProvider = buildVisionRequest({ model: 'qwen-vision', mimeType: 'image/png', base64: 'AA==' });
  assert.equal(otherProvider.thinking, undefined);
});

test('Vision 解析有限兼容前后说明和文本块数组，但拒绝缺少 isPlant 的对象', () => {
  const wrapped = parseVisionContent([
    { type: 'text', text: '下面是结构化结果：\n```json\n{"isPlant":true,"reply":"这是月季","candidates":[]}' },
    { type: 'text', text: '\n```\n以上。' }
  ]);
  assert.equal(wrapped.isPlant, true);
  assert.equal(wrapped.reply, '这是月季');
  assert.throws(() => parseVisionContent('{"reply":"缺少类型判断"}'), /没有返回可解析/);
  assert.throws(() => parseVisionContent('{"isPlant":true'), /没有返回可解析/);
});

test('非植物图片返回明确原因且不伪造候选', () => {
  const result = parseVisionContent(JSON.stringify({
    isPlant: false,
    nonPlantReason: '画面主体是一只杯子',
    candidates: [{ name: '月季', confidence: 0.9 }],
    reshootQuestions: ['请拍摄完整植物']
  }));
  assert.equal(result.isPlant, false);
  assert.deepEqual(result.candidates, []);
  assert.equal(result.nonPlantReason, '画面主体是一只杯子');
});

test('Vision 模型未配置时明确回退到手动路径', async () => {
  const previousEnabled = process.env.LLM_API_ENABLED;
  process.env.LLM_API_ENABLED = 'false';
  try {
    await assert.rejects(
      analyzeImageWithVision({ mimeType: 'image/png', imageBase64: tinyPngBuffer().toString('base64') }),
      /尚未配置.*手动建档|手动.*记录/
    );
  } finally {
    if (previousEnabled === undefined) delete process.env.LLM_API_ENABLED;
    else process.env.LLM_API_ENABLED = previousEnabled;
  }
});

test('Vision 会话保存持久媒体标识，但不保存原始图片字节或临时路径', () => {
  const analysis = {
    isPlant: true,
    reply: '这看起来像一株月季。',
    candidates: [{ name: '月季', confidence: 0.96 }],
    visibleSigns: ['花瓣颜色鲜红'],
    possibleCauses: [],
    advice: [{ title: '检查盆土', detail: '表层干燥后再浇水' }],
    disclaimer: '仅描述图片中可见迹象。'
  };
  const response = buildVisionConversationResponse(
    { analysis, model: 'vision-model' },
    [],
    'local://12345678-1234-1234-1234-123456789abc'
  );
  const serialized = JSON.stringify(response);
  assert.equal(response.kind, 'vision_analysis');
  assert.equal(response.attachment.originalPersisted, true);
  assert.match(response.attachment.mediaFileId, /^local:\/\//);
  assert.deepEqual(response.analysis, analysis);
  assert.doesNotMatch(serialized, /imageBase64|tempFilePath|data:image/);
  assert.match(buildVisionConversationText(analysis), /月季/);
  assert.match(buildVisionConversationText(analysis), /花瓣颜色鲜红/);
});

test('Vision 建议动作只有在明确任务意图且图片候选匹配当前植宠时才转成候选', () => {
  const analysis = {
    isPlant: true,
    uncertain: false,
    candidates: [{ name: '月季', confidence: 0.95 }],
    advice: [{ title: '保持通风和光照', detail: '放在光照充足处' }]
  };
  const rose = { id: 7, nickname: '阳台月季', speciesName: '月季' };
  const monstera = { id: 8, nickname: '客厅龟背竹', speciesName: '龟背竹' };
  assert.equal(imageMatchesSelectedPlantPet(analysis, rose), true);
  assert.equal(imageMatchesSelectedPlantPet(analysis, monstera), false);
  assert.deepEqual(buildVisionTaskSuggestions(analysis, 7, '你好', rose), []);
  assert.deepEqual(buildVisionTaskSuggestions(analysis, 7, '请观察一下叶片', rose), []);
  assert.deepEqual(buildVisionTaskSuggestions(analysis, 8, '帮我安排观察任务', monstera), []);
  assert.equal(
    buildVisionTaskSuggestions(analysis, 7, '请识别这盆植物，不要安排任务', rose).length,
    0
  );
  const tasks = buildVisionTaskSuggestions(analysis, 7, '帮我安排观察任务', rose);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].plantPetId, 7);
  assert.equal(tasks[0].source, 'diagnosis');
  assert.equal(
    buildVisionTaskSuggestions(analysis, 7, '请识别这盆植物，并帮我安排一个今天观察月季花瓣的任务。', rose).length,
    1
  );
});

test('Vision 明确任务候选与图片引用在单一事务持久化并返回 pending proposal', async () => {
  const lifecycle = [];
  const calls = [];
  let storedProposal = null;
  const connection = {
    async beginTransaction() { lifecycle.push('begin'); },
    async commit() { lifecycle.push('commit'); },
    async rollback() { lifecycle.push('rollback'); },
    release() { lifecycle.push('release'); },
    async execute(sql, params = []) {
      calls.push({ sql, params });
      if (/FROM media_objects/.test(sql) && /^\s*SELECT/.test(sql)) {
        return [[{
          file_id: 'local://vision-1',
          plant_pet_id: 7,
          reference_type: null,
          reference_key: null
        }]];
      }
      if (/event_key = \?/.test(sql)) return [[]];
      if (/SELECT id FROM ai_conversations/.test(sql)) return [[{ id: 9 }]];
      if (/INSERT INTO ai_messages/.test(sql) && /'user'/.test(sql)) return [{ insertId: 101 }];
      if (/INSERT INTO ai_messages/.test(sql) && /'assistant'/.test(sql)) return [{ insertId: 102 }];
      if (/INSERT INTO ai_action_proposals/.test(sql)) {
        storedProposal = {
          id: 201,
          proposal_key: params[0],
          conversation_id: 9,
          source_user_message_id: 101,
          source_assistant_message_id: 102,
          plant_pet_id: 7,
          proposal_type: 'care_task',
          payload_json: params[7],
          status: 'pending',
          expires_at: '2026-09-04 09:00:00'
        };
        return [{ insertId: 201 }];
      }
      if (/FROM ai_action_proposals/.test(sql)) return [[storedProposal]];
      if (/INSERT INTO ai_conversation_events/.test(sql)) return [{ insertId: 301 }];
      if (/SELECT id, conversation_id FROM ai_messages/.test(sql)) return [[]];
      if (/ORDER BY id DESC LIMIT 40/.test(sql)) return [[]];
      return [{ affectedRows: 1 }];
    }
  };
  const task = {
    plantPetId: 7,
    taskType: 'inspection',
    title: '观察新叶',
    description: '明天复查',
    scheduledFor: '2026-09-04',
    reminderTime: '09:00',
    recurrenceType: 'none',
    recurrenceInterval: 1,
    source: 'diagnosis'
  };
  const response = buildVisionConversationResponse(
    { analysis: { isPlant: true, reply: '这是月季。' }, model: 'vision-model' },
    [task],
    'local://vision-1'
  );

  const exchange = await saveVisionExchangeWithMedia(
    { async getConnection() { return connection; } },
    'owner',
    { id: 9 },
    {
      mediaFileId: 'local://vision-1',
      plantPetId: 7,
      clientTurnKey: 'vision-turn-1',
      historyText: '请安排明天观察任务\n[本轮包含一张图片]',
      assistantText: '这是月季。',
      response,
      proposals: [{ proposalType: 'care_task', plantPetId: 7, payload: task }],
      userResponse: { kind: 'vision_input' }
    }
  );

  assert.deepEqual(lifecycle, ['begin', 'commit', 'release']);
  assert.equal(exchange.response.taskSuggestions[0].status, 'pending');
  assert.match(exchange.response.taskSuggestions[0].proposalKey, /^proposal_/);
  assert.ok(calls.some((item) => /INSERT IGNORE INTO ai_message_media_links/.test(item.sql)));
  assert.ok(calls.some((item) => /INSERT INTO ai_action_proposals/.test(item.sql)));
  assert.ok(calls.some((item) => /UPDATE media_objects/.test(item.sql)));
});
