const MAX_MEMORY_CANDIDATES = 80;
const DEFAULT_MEMORY_LIMIT = 8;

const MEMORY_CUE_GROUPS = [
  {
    query: /(我是谁|我叫什么|我的名字|我的昵称|怎么称呼我|如何称呼我|叫我什么|记得.{0,6}(名字|昵称|称呼)|以后.{0,6}叫我)/i,
    memory: /(preferred[_ -]?name|display[_ -]?name|nickname|称呼|名字|昵称|叫我)/i,
    weight: 24
  },
  {
    query: /(我的偏好|我的习惯|我喜欢|我不喜欢|偏好什么|习惯什么)/i,
    memory: /(preference|habit|偏好|习惯|喜欢|不喜欢)/i,
    weight: 16
  }
];

function isUserConfirmed(value) {
  return value === true || Number(value) === 1;
}

function normalizeMemory(row = {}) {
  return {
    id: Number(row.id) || 0,
    plantPetId: Number(row.plantPetId ?? row.plant_pet_id) || null,
    type: row.type || row.memory_type || '',
    key: row.key || row.memory_key || '',
    content: String(row.content || '').trim(),
    sourceType: row.sourceType || row.source_type || '',
    sourceId: row.sourceId || row.source_id || '',
    sourceTime: row.sourceTime || row.source_time || null,
    userConfirmed: isUserConfirmed(row.userConfirmed ?? row.user_confirmed),
    createdAt: row.createdAt || row.created_at || null,
    updatedAt: row.updatedAt || row.updated_at || null
  };
}

function normalizeMemoryText(input = '') {
  return String(input || '').toLowerCase().replace(/\s+/g, '');
}

function tokenizeMemoryQuery(input = '') {
  const text = String(input || '').toLowerCase();
  const terms = new Set(text.match(/[a-z0-9_]{2,}/g) || []);
  const runs = text.match(/[\u3400-\u9fff]{2,}/g) || [];
  runs.forEach((run) => {
    for (let size = 2; size <= Math.min(4, run.length); size += 1) {
      for (let index = 0; index <= run.length - size; index += 1) {
        terms.add(run.slice(index, index + size));
      }
    }
  });
  return Array.from(terms).slice(0, 60);
}

function scoreMemory(memory, query = '', queryTerms = tokenizeMemoryQuery(query)) {
  const haystack = normalizeMemoryText(`${memory.key} ${memory.content}`);
  if (!haystack) return 0;
  const termMatches = queryTerms.filter((term) => haystack.includes(normalizeMemoryText(term))).length;
  let score = Math.min(24, termMatches * 4);
  for (const cue of MEMORY_CUE_GROUPS) {
    if (cue.query.test(String(query || '')) && cue.memory.test(`${memory.key} ${memory.content}`)) {
      score += cue.weight;
    }
  }
  if (/(你还?记得我吗|你还?认识我吗|你记得我什么|关于我的记忆|关于我记得什么|记得我的偏好)/i.test(String(query || ''))) {
    score += 1;
  }
  return score;
}

function selectRelevantMemories(memories = [], query = '', limit = DEFAULT_MEMORY_LIMIT) {
  const queryTerms = tokenizeMemoryQuery(query);
  const seen = new Set();
  const boundedLimit = Math.max(1, Math.min(DEFAULT_MEMORY_LIMIT, Number(limit) || DEFAULT_MEMORY_LIMIT));
  return (Array.isArray(memories) ? memories : [])
    .map((row, index) => ({ memory: normalizeMemory(row), index }))
    .filter(({ memory }) => memory.type === 'user_preference' && memory.userConfirmed && memory.content)
    .map(({ memory, index }) => ({ memory, index, score: scoreMemory(memory, query, queryTerms) }))
    .filter(({ memory, score }) => {
      const fingerprint = normalizeMemoryText(memory.content);
      if (score <= 0 || !fingerprint || seen.has(fingerprint)) return false;
      seen.add(fingerprint);
      return true;
    })
    .sort((left, right) => right.score - left.score
      || String(right.memory.updatedAt || '').localeCompare(String(left.memory.updatedAt || ''))
      || left.index - right.index)
    .slice(0, boundedLimit)
    .map(({ memory }) => memory);
}

async function listConfirmedPreferences(db, openid, plantPetId = null, limit = MAX_MEMORY_CANDIDATES) {
  const owner = String(openid || '').trim();
  if (!owner) return [];
  const normalizedPlantPetId = Number(plantPetId) || 0;
  const boundedLimit = Math.max(1, Math.min(MAX_MEMORY_CANDIDATES, Number(limit) || MAX_MEMORY_CANDIDATES));
  const plantScope = normalizedPlantPetId
    ? '(plant_pet_id = ? OR plant_pet_id IS NULL)'
    : 'plant_pet_id IS NULL';
  const params = normalizedPlantPetId ? [owner, normalizedPlantPetId] : [owner];
  const [rows] = await db.execute(
    `SELECT id, plant_pet_id, memory_type, memory_key, content, source_type, source_id,
            DATE_FORMAT(source_time, '%Y-%m-%d %H:%i:%s') AS source_time,
            user_confirmed,
            DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
            DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
     FROM ai_memories
     WHERE openid = ? AND memory_type = 'user_preference' AND user_confirmed = 1
       AND ${plantScope}
     ORDER BY updated_at DESC, id DESC
     LIMIT ${boundedLimit}`,
    params
  );
  return rows.map(normalizeMemory);
}

async function recallRelevantMemories(db, input = {}) {
  const limit = Math.max(1, Math.min(DEFAULT_MEMORY_LIMIT, Number(input.limit) || DEFAULT_MEMORY_LIMIT));
  const candidates = await listConfirmedPreferences(
    db,
    input.openid,
    input.plantPetId,
    MAX_MEMORY_CANDIDATES
  );
  return selectRelevantMemories(candidates, input.query, limit);
}

module.exports = {
  MAX_MEMORY_CANDIDATES,
  DEFAULT_MEMORY_LIMIT,
  isUserConfirmed,
  normalizeMemory,
  normalizeMemoryText,
  tokenizeMemoryQuery,
  scoreMemory,
  selectRelevantMemories,
  listConfirmedPreferences,
  recallRelevantMemories
};
