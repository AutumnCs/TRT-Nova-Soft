const crypto = require('crypto');
const { loadUserDisplayProfile } = require('../agent/userIdentity');
const { loadOwnedPlantPet } = require('../agent/petContext');
const { searchKnowledgeBundle } = require('../rag/knowledgeSearch');
const { recallRelevantMemories } = require('./memoryAdapter');

const TOOL_META = Object.freeze({
  get_account_nickname: Object.freeze({ sideEffect: 'none', dataClass: 'account_profile' }),
  get_selected_plant: Object.freeze({ sideEffect: 'none', dataClass: 'owned_plant_pet' }),
  search_published_knowledge: Object.freeze({ sideEffect: 'none', dataClass: 'published_knowledge' }),
  recall_relevant_memories: Object.freeze({ sideEffect: 'none', dataClass: 'confirmed_user_preference' }),
  propose_memory_candidate: Object.freeze({ sideEffect: 'proposal_only', dataClass: 'user_preference_candidate' }),
  propose_care_task: Object.freeze({ sideEffect: 'proposal_only', dataClass: 'care_task_candidate' })
});

const READ_ONLY_TOOL_DEFINITIONS = Object.freeze([
  Object.freeze({
    type: 'function',
    function: Object.freeze({
      name: 'get_account_nickname',
      description: '仅当用户明确询问自己的账号昵称、身份称呼或希望如何被称呼时，读取当前已鉴权账号昵称。不得仅为了个性化普通问候或植物回答而调用；工具不接受 openid 或其他账号标识。',
      parameters: Object.freeze({ type: 'object', properties: Object.freeze({}), additionalProperties: false })
    })
  }),
  Object.freeze({
    type: 'function',
    function: Object.freeze({
      name: 'get_selected_plant',
      description: '仅当问题明确依赖“当前/这盆/它”等已选植宠、其状态或任务对象时，读取当前会话已选中且属于当前账号的植宠。通用植物知识和账号身份问题不得调用；工具不接受任意植宠 ID。',
      parameters: Object.freeze({ type: 'object', properties: Object.freeze({}), additionalProperties: false })
    })
  }),
  Object.freeze({
    type: 'function',
    function: Object.freeze({
      name: 'search_published_knowledge',
      description: '检索人工复核并已发布的植物图鉴和养护知识。植物事实和养护建议必须先参考此工具结果。',
      parameters: Object.freeze({
        type: 'object',
        properties: Object.freeze({
          query: Object.freeze({ type: 'string', maxLength: 300, description: '与用户原问题一致或更具体的植物知识查询' }),
          plantType: Object.freeze({ type: 'string', maxLength: 80, description: '已知植物名；不确定时留空' })
        }),
        additionalProperties: false
      })
    })
  })
]);

const PROPOSAL_TOOL_DEFINITIONS = Object.freeze([
  Object.freeze({
    type: 'function',
    function: Object.freeze({
      name: 'recall_relevant_memories',
      description: '只在用户明确询问自己已确认的称呼或偏好时，读取与本轮问题相关的已确认长期偏好。不得读取业务事实、诊断摘要或其他账号数据。',
      parameters: Object.freeze({
        type: 'object',
        properties: Object.freeze({ query: Object.freeze({ type: 'string', maxLength: 300 }) }),
        required: Object.freeze(['query']),
        additionalProperties: false
      })
    })
  }),
  Object.freeze({
    type: 'function',
    function: Object.freeze({
      name: 'propose_memory_candidate',
      description: '把用户明确表达的非敏感称呼偏好准备为待确认候选。只生成候选，不会写入长期记忆；必须由用户随后确认。',
      parameters: Object.freeze({
        type: 'object',
        properties: Object.freeze({
          kind: Object.freeze({ type: 'string', enum: Object.freeze(['preferred_name']) }),
          value: Object.freeze({ type: 'string', minLength: 1, maxLength: 32 }),
          content: Object.freeze({ type: 'string', minLength: 1, maxLength: 160 })
        }),
        required: Object.freeze(['kind', 'value', 'content']),
        additionalProperties: false
      })
    })
  }),
  Object.freeze({
    type: 'function',
    function: Object.freeze({
      name: 'propose_care_task',
      description: '仅在用户明确请求为当前选中植宠创建养护任务时，准备一个待确认任务。只生成候选，不写正式任务；openid、植宠 ID、会话和确认状态均由服务端绑定。',
      parameters: Object.freeze({
        type: 'object',
        properties: Object.freeze({
          taskType: Object.freeze({ type: 'string', enum: Object.freeze(['watering', 'fertilizing', 'pruning', 'inspection', 'repotting', 'other']) }),
          title: Object.freeze({ type: 'string', minLength: 1, maxLength: 128 }),
          description: Object.freeze({ type: 'string', maxLength: 1000 }),
          scheduledFor: Object.freeze({ type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
          reminderTime: Object.freeze({ type: ['string', 'null'], pattern: '^\\d{2}:\\d{2}$' }),
          recurrenceType: Object.freeze({ type: 'string', enum: Object.freeze(['none', 'daily', 'weekly', 'monthly']) }),
          recurrenceInterval: Object.freeze({ type: 'integer', minimum: 1, maximum: 365 }),
          reason: Object.freeze({ type: 'string', maxLength: 240 })
        }),
        required: Object.freeze(['taskType', 'title', 'scheduledFor', 'recurrenceType', 'recurrenceInterval']),
        additionalProperties: false
      })
    })
  })
]);

const TOOL_DEFINITIONS = Object.freeze([...READ_ONLY_TOOL_DEFINITIONS, ...PROPOSAL_TOOL_DEFINITIONS]);

function toolError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseArguments(input) {
  if (input === undefined || input === null || input === '') return {};
  if (typeof input === 'object' && !Array.isArray(input)) return input;
  if (typeof input !== 'string') throw toolError('TOOL_ARGS_INVALID', 'tool arguments must be an object');
  try {
    const parsed = JSON.parse(input);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed;
  } catch (error) {
    throw toolError('TOOL_ARGS_INVALID', 'tool arguments must be valid JSON object');
  }
}

function validateNoArguments(args, name) {
  const keys = Object.keys(args);
  if (keys.length) throw toolError('TOOL_ARGS_FORBIDDEN', `${name} does not accept arguments`);
  return {};
}

function validateSearchArguments(args, fallbackQuery = '', fallbackPlantType = '') {
  const allowed = new Set(['query', 'plantType']);
  const unknown = Object.keys(args).filter((key) => !allowed.has(key));
  if (unknown.length) throw toolError('TOOL_ARGS_FORBIDDEN', 'search contains unsupported arguments');

  const query = String(args.query || fallbackQuery || '').trim();
  const plantType = String(args.plantType || fallbackPlantType || '').trim();
  if (!query) throw toolError('TOOL_ARGS_INVALID', 'search query is required');
  if (query.length > 300 || plantType.length > 80) {
    throw toolError('TOOL_ARGS_INVALID', 'search arguments exceed length limits');
  }
  return { query, plantType };
}

function assertOnlyKeys(args, allowed, label) {
  const unknown = Object.keys(args).filter((key) => !allowed.has(key));
  if (unknown.length) throw toolError('TOOL_ARGS_FORBIDDEN', `${label} contains unsupported arguments`);
}

function validateRecallArguments(args, fallbackQuery = '') {
  assertOnlyKeys(args, new Set(['query']), 'memory recall');
  const query = String(args.query || fallbackQuery || '').trim().slice(0, 300);
  if (!query) throw toolError('TOOL_ARGS_INVALID', 'memory recall query is required');
  return { query };
}

function containsSensitiveMemoryValue(value = '', content = '') {
  const combined = `${String(value || '')} ${String(content || '')}`;
  const compactDigits = String(value || '').replace(/\D/g, '');
  return /(密码|口令|验证码|身份证|证件号|银行卡|信用卡|护照|手机号|电话号码|邮箱|住址|openid|token|密钥|私钥|bearer)/i.test(combined)
    || /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(combined)
    || /^1[3-9]\d{9}$/.test(compactDigits)
    || /(?:sk-|eyJ)[A-Za-z0-9._-]{12,}/.test(String(value || ''))
    || /^[A-Za-z0-9_-]{24,}$/.test(String(value || ''))
    || /\d{6,}/.test(String(value || ''));
}

function validateMemoryProposalArguments(args) {
  assertOnlyKeys(args, new Set(['kind', 'value', 'content']), 'memory proposal');
  const kind = String(args.kind || '').trim();
  const value = String(args.value || '').trim();
  const content = String(args.content || '').trim();
  if (kind !== 'preferred_name' || !value || value.length > 32 || !content || content.length > 160) {
    throw toolError('TOOL_ARGS_INVALID', 'memory proposal is invalid');
  }
  if (containsSensitiveMemoryValue(value, content)) {
    throw toolError('MEMORY_SENSITIVE_BLOCKED', 'sensitive information cannot become a memory candidate');
  }
  return { kind, value, content };
}

function validateTaskProposalArguments(args) {
  const allowed = new Set([
    'taskType', 'title', 'description', 'scheduledFor', 'reminderTime',
    'recurrenceType', 'recurrenceInterval', 'reason'
  ]);
  assertOnlyKeys(args, allowed, 'task proposal');
  const taskType = String(args.taskType || '').trim().toLowerCase();
  const title = String(args.title || '').trim().slice(0, 128);
  const description = String(args.description || '').trim().slice(0, 1000);
  const scheduledFor = String(args.scheduledFor || '').trim();
  const reminderTime = args.reminderTime === null || args.reminderTime === '' || args.reminderTime === undefined
    ? null
    : String(args.reminderTime).trim();
  const recurrenceType = String(args.recurrenceType || 'none').trim().toLowerCase();
  const recurrenceInterval = Number(args.recurrenceInterval || 1);
  if (!new Set(['watering', 'fertilizing', 'pruning', 'inspection', 'repotting', 'other']).has(taskType)) {
    throw toolError('TOOL_ARGS_INVALID', 'task type is invalid');
  }
  if (!title) throw toolError('TOOL_ARGS_INVALID', 'task title is required');
  const scheduledDate = /^\d{4}-\d{2}-\d{2}$/.test(scheduledFor)
    ? new Date(`${scheduledFor}T00:00:00.000Z`)
    : null;
  if (!scheduledDate
    || Number.isNaN(scheduledDate.getTime())
    || scheduledDate.toISOString().slice(0, 10) !== scheduledFor) {
    throw toolError('TOOL_ARGS_INVALID', 'task date is invalid');
  }
  if (reminderTime && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(reminderTime)) {
    throw toolError('TOOL_ARGS_INVALID', 'task reminder time is invalid');
  }
  if (!new Set(['none', 'daily', 'weekly', 'monthly']).has(recurrenceType)
    || !Number.isInteger(recurrenceInterval) || recurrenceInterval < 1 || recurrenceInterval > 365) {
    throw toolError('TOOL_ARGS_INVALID', 'task recurrence is invalid');
  }
  return {
    taskType, title, description, scheduledFor, reminderTime, recurrenceType,
    recurrenceInterval: recurrenceType === 'none' ? 1 : recurrenceInterval,
    reason: String(args.reason || '').trim().slice(0, 240)
  };
}

function normalizeToolCall(call = {}, defaults = {}) {
  const name = String(call.name || call.function?.name || '').trim();
  if (!TOOL_META[name]) throw toolError('TOOL_NOT_ALLOWED', 'tool is not in the read-only allowlist');
  const args = parseArguments(call.arguments ?? call.function?.arguments);
  if (name === 'search_published_knowledge') {
    return { name, arguments: validateSearchArguments(args, defaults.query, defaults.plantType) };
  }
  if (name === 'recall_relevant_memories') {
    return { name, arguments: validateRecallArguments(args, defaults.query) };
  }
  if (name === 'propose_memory_candidate') {
    return { name, arguments: validateMemoryProposalArguments(args) };
  }
  if (name === 'propose_care_task') {
    return { name, arguments: validateTaskProposalArguments(args) };
  }
  return { name, arguments: validateNoArguments(args, name) };
}

function sanitizePlant(pet) {
  if (!pet) return null;
  return {
    id: Number(pet.id) || 0,
    nickname: String(pet.nickname || '').slice(0, 80),
    speciesName: String(pet.speciesName || '').slice(0, 120),
    scientificName: String(pet.scientificName || '').slice(0, 160),
    enteredAt: String(pet.enteredAt || '').slice(0, 10),
    location: String(pet.location || '').slice(0, 120),
    careNotes: String(pet.careNotes || '').slice(0, 500),
    status: String(pet.status || '').slice(0, 32)
  };
}

function sanitizeKnowledgeHit(hit = {}) {
  return {
    type: String(hit.type || '').slice(0, 40),
    title: String(hit.title || '').slice(0, 160),
    content: String(hit.content || '').slice(0, 1600),
    sourceTitle: String(hit.sourceTitle || '').slice(0, 200),
    sourcePublisher: String(hit.sourcePublisher || '').slice(0, 200),
    sourceUrl: String(hit.sourceUrl || '').slice(0, 800),
    sourceId: String(hit.sourceId || '').slice(0, 160),
    contentUpdatedAt: String(hit.contentUpdatedAt || '').slice(0, 40),
    reviewedAt: hit.reviewedAt || null
  };
}

async function defaultMemoryReader(db, openid, input = {}) {
  return recallRelevantMemories(db, {
    openid,
    plantPetId: Number(input.plantPetId) || null,
    query: String(input.query || ''),
    limit: 5
  });
}

function opaqueProposalKey() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString('hex');
}

function createAgentToolExecutor(options = {}) {
  const db = options.db;
  const openid = String(options.openid || '');
  const selectedPlantPetId = Number(options.selectedPlantPetId) || 0;
  const defaultQuery = String(options.defaultQuery || '').trim();
  const defaultPlantType = String(options.defaultPlantType || '').trim();
  const profileReader = options.profileReader || loadUserDisplayProfile;
  const plantReader = options.plantReader || loadOwnedPlantPet;
  const knowledgeSearcher = options.knowledgeSearcher || searchKnowledgeBundle;
  const memoryReader = options.memoryReader || defaultMemoryReader;
  const proposalKeyFactory = options.proposalKeyFactory || opaqueProposalKey;
  const allowedNames = new Set(Array.isArray(options.allowedToolNames) ? options.allowedToolNames : TOOL_DEFINITIONS.map((item) => item.function.name));
  const proposalDrafts = [];
  let selectedPlantCache;

  if (!db || !openid) throw toolError('TOOL_SCOPE_INVALID', 'authenticated tool scope is required');

  return {
    definitions: TOOL_DEFINITIONS.filter((item) => allowedNames.has(item.function.name)),
    metadata: TOOL_META,
    getProposalDrafts() {
      return proposalDrafts.map((item) => ({ ...item, payload: { ...item.payload } }));
    },
    async execute(call = {}) {
      const normalized = normalizeToolCall(call, { query: defaultQuery, plantType: defaultPlantType });
      if (!allowedNames.has(normalized.name)) throw toolError('TOOL_NOT_ALLOWED', 'tool is not allowed for this turn');
      if (normalized.name === 'get_account_nickname') {
        const profile = await profileReader(db, openid);
        const displayName = String(profile?.displayName || '').trim().slice(0, 80);
        return {
          available: profile?.available !== false,
          hasNickname: Boolean(displayName),
          displayName
        };
      }

      if (normalized.name === 'get_selected_plant') {
        if (!selectedPlantPetId) return { selected: false, found: false, plant: null };
        const pet = selectedPlantCache === undefined
          ? await plantReader(db, openid, selectedPlantPetId)
          : selectedPlantCache;
        selectedPlantCache = pet || null;
        return { selected: true, found: Boolean(pet), plant: sanitizePlant(pet) };
      }

      if (normalized.name === 'recall_relevant_memories') {
        const memories = await memoryReader(db, openid, {
          query: normalized.arguments.query,
          plantPetId: selectedPlantPetId || null
        });
        return {
          memories: (Array.isArray(memories) ? memories : []).slice(0, 5).map((item) => ({
            id: Number(item.id) || 0,
            plantPetId: Number(item.plant_pet_id || item.plantPetId) || null,
            key: String(item.memory_key || item.key || '').slice(0, 128),
            content: String(item.content || '').slice(0, 300),
            updatedAt: item.updated_at || item.updatedAt || null
          }))
        };
      }

      if (normalized.name === 'propose_memory_candidate') {
        const draft = {
          proposalKey: proposalKeyFactory(),
          proposalType: 'memory_preference',
          plantPetId: null,
          payload: normalized.arguments,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        };
        proposalDrafts.push(draft);
        return { prepared: true, proposalType: draft.proposalType, content: draft.payload.content, requiresUserConfirmation: true };
      }

      if (normalized.name === 'propose_care_task') {
        if (!selectedPlantPetId) throw toolError('PROPOSAL_PLANT_REQUIRED', 'selected plant is required');
        const pet = selectedPlantCache === undefined
          ? await plantReader(db, openid, selectedPlantPetId)
          : selectedPlantCache;
        selectedPlantCache = pet || null;
        if (!pet) throw toolError('PROPOSAL_PLANT_NOT_OWNED', 'selected plant is unavailable');
        const genericTitle = ['浇水', '施肥', '修剪', '换盆', '观察植株'].includes(normalized.arguments.title);
        const payload = {
          ...normalized.arguments,
          title: genericTitle && pet.nickname
            ? `${normalized.arguments.title} · ${String(pet.nickname).slice(0, 48)}`
            : normalized.arguments.title
        };
        const draft = {
          proposalKey: proposalKeyFactory(),
          proposalType: 'care_task',
          plantPetId: selectedPlantPetId,
          payload,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        };
        proposalDrafts.push(draft);
        return {
          prepared: true,
          proposalType: draft.proposalType,
          plant: { nickname: String(pet.nickname || '').slice(0, 80) },
          task: payload,
          requiresUserConfirmation: true
        };
      }

      const bundle = await knowledgeSearcher(db, {
        query: normalized.arguments.query,
        plantType: normalized.arguments.plantType,
        knowledgeLimit: 3
      });
      const hits = (Array.isArray(bundle?.hits) ? bundle.hits : []).slice(0, 3).map(sanitizeKnowledgeHit);
      return { hits, unknown: hits.length === 0 };
    }
  };
}

function createReadOnlyToolExecutor(options = {}) {
  return createAgentToolExecutor({
    ...options,
    allowedToolNames: READ_ONLY_TOOL_DEFINITIONS.map((item) => item.function.name)
  });
}

module.exports = {
  TOOL_META,
  READ_ONLY_TOOL_DEFINITIONS,
  PROPOSAL_TOOL_DEFINITIONS,
  TOOL_DEFINITIONS,
  parseArguments,
  normalizeToolCall,
  sanitizePlant,
  sanitizeKnowledgeHit,
  defaultMemoryReader,
  validateRecallArguments,
  containsSensitiveMemoryValue,
  validateMemoryProposalArguments,
  validateTaskProposalArguments,
  createAgentToolExecutor,
  createReadOnlyToolExecutor
};
