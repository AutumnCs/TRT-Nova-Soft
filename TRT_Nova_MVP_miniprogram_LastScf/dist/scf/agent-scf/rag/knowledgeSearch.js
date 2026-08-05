const { searchPlantProfiles } = require('../tools/plant');

const fs = require('fs');
const path = require('path');

function loadSeedArticles() {
  const candidates = [
    path.join(__dirname, '..', 'data', 'knowledge', 'articles.json'),
    path.join(__dirname, '..', '..', '..', '..', 'data', 'knowledge', 'articles.json')
  ];

  for (const filePath of candidates) {
    try {
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      }
    } catch (err) {
      console.warn('[knowledgeSearch] failed to load seed articles:', err.message);
    }
  }

  return [];
}

const seedArticles = loadSeedArticles();

const PROTOCOL_SNIPPETS = [
  {
    id: 'soil_percent',
    title: '土壤湿度 soil_percent',
    keywords: ['soil_percent', '土壤湿度', '湿度多少', '缺水', '浇水'],
    content: 'soil_percent 表示土壤湿度百分比，适合用来判断当前是否接近缺水区间，但必须结合植物类型、温度和通风一起看。'
  },
  {
    id: 'dht_temp',
    title: '环境温度 dht_temp',
    keywords: ['dht_temp', '温度', '环境温度', '热不热', '通风'],
    content: 'dht_temp 表示环境温度，通常用于判断是否过热、过冷，以及是否需要调整浇水或通风建议。'
  },
  {
    id: 'dht_humi',
    title: '环境湿度 dht_humi',
    keywords: ['dht_humi', '空气湿度', '环境湿度', '太干', '太湿'],
    content: 'dht_humi 表示环境湿度，可用于判断空气是否过干或过湿，并结合通风状态一起给出建议。'
  },
  {
    id: 'light_val',
    title: '光照 light_val',
    keywords: ['light_val', '光照', '照度', 'lux', '晒太阳'],
    content: 'light_val 表示光照强度，适合判断是否缺光或存在强光直晒风险，但最终解释要回到植物类型。'
  },
  {
    id: 'run_state',
    title: '设备运行状态 run_state',
    keywords: ['run_state', '运行状态', '设备状态', '在运行吗'],
    content: 'run_state 表示设备运行状态，通常用于展示设备是否处于运行中，但不等于业务动作一定已执行成功。'
  },
  {
    id: 'fan_switch',
    title: '风扇状态 fan_switch',
    keywords: ['fan_switch', '风扇', '开风扇', '关风扇', '通风'],
    content: 'fan_switch 是风扇开关状态字段。当前系统兼容历史字段 test，并建议统一迁移到正式业务字段。'
  },
  {
    id: 'business_rule_latest',
    title: '业务规则：真实状态来自最新数据',
    keywords: ['真实状态', '为什么没执行', '命令发出', '为什么没开', '最新状态'],
    content: '当前项目里 device_latest 作为设备真实状态来源。命令发送成功不等于设备已经执行成功，仍需等待设备回传确认。'
  }
];

function normalizeArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return [];
}

function parseJsonField(input, fallback) {
  if (input === undefined || input === null || input === '') return fallback;
  if (Array.isArray(input)) return input;
  if (typeof input === 'object') return input;
  if (typeof input === 'string') {
    try {
      return JSON.parse(input);
    } catch (err) {
      return fallback;
    }
  }
  return fallback;
}

function normalizeSeedArticle(article = {}) {
  return {
    id: Number(article.id) || 0,
    slug: String(article.slug || '').trim(),
    title: String(article.title || '').trim(),
    summary: String(article.summary || '').trim(),
    content: String(article.content || '').trim(),
    category: String(article.category || 'general').trim() || 'general',
    tags: normalizeArray(article.tags),
    aliases: normalizeArray(article.aliases),
    plantTypes: normalizeArray(article.plantTypes),
    problemTypes: normalizeArray(article.problemTypes),
    sourceType: String(article.sourceType || 'seed').trim() || 'seed',
    sourceRef: String(article.sourceRef || '').trim(),
    status: String(article.status || 'published').trim() || 'published',
    sortOrder: Number(article.sortOrder) || 0
  };
}

function scoreTextMatch(text, keywords = []) {
  const query = String(text || '').trim().toLowerCase();
  if (!query) return 0;

  return keywords.reduce((score, keyword) => {
    const part = String(keyword || '').trim().toLowerCase();
    if (!part) return score;
    return query.includes(part) ? score + (part.length > 4 ? 5 : 3) : score;
  }, 0);
}

function scoreKnowledgeArticle(query, article, filters = {}) {
  const text = String(query || '').trim().toLowerCase();
  const category = String(filters.category || '').trim().toLowerCase();
  const tag = String(filters.tag || '').trim().toLowerCase();
  const plantType = String(filters.plantType || '').trim().toLowerCase();

  if (category && String(article.category || '').toLowerCase() !== category) return 0;
  if (tag && !(article.tags || []).some((item) => item.toLowerCase() === tag || item.toLowerCase().includes(tag))) return 0;
  if (plantType && !(article.plantTypes || []).some((item) => item.toLowerCase() === plantType || item.toLowerCase().includes(plantType))) return 0;

  let score = Number(article.sortOrder || 0) ? Math.max(0, 500 - Number(article.sortOrder || 0)) : 1;
  if (text) {
    if ((article.title || '').toLowerCase().includes(text)) score += 100;
    if ((article.summary || '').toLowerCase().includes(text)) score += 60;
    if ((article.aliases || []).some((item) => item.toLowerCase().includes(text))) score += 45;
    if ((article.tags || []).some((item) => item.toLowerCase().includes(text))) score += 40;
    if ((article.plantTypes || []).some((item) => item.toLowerCase().includes(text))) score += 25;
    if ((article.problemTypes || []).some((item) => item.toLowerCase().includes(text))) score += 20;
    if ((article.content || '').toLowerCase().includes(text)) score += 10;
  }
  return score;
}

function buildKnowledgeArticleEntry(article) {
  return {
    type: 'knowledge_article',
    title: article.title || '知识文章',
    content: [article.summary, article.content].filter(Boolean).join('\n'),
    source: article.sourceRef ? `knowledge_articles:${article.sourceRef}` : `knowledge_articles:${article.slug || article.id}`,
    articleId: article.id,
    slug: article.slug,
    category: article.category,
    score: Number(article.score) || 0,
    tags: Array.isArray(article.tags) ? article.tags : [],
    aliases: Array.isArray(article.aliases) ? article.aliases : [],
    plantTypes: Array.isArray(article.plantTypes) ? article.plantTypes : [],
    problemTypes: Array.isArray(article.problemTypes) ? article.problemTypes : [],
    status: article.status || 'published',
    sortOrder: Number(article.sortOrder) || 0
  };
}

function buildProtocolEntry(snippet) {
  return {
    type: 'protocol',
    title: snippet.title,
    content: snippet.content,
    source: `device-field:${snippet.id}`
  };
}

function buildPlantKnowledgeEntry(plant) {
  const parts = [
    plant.name ? `植物：${plant.name}` : '',
    plant.scientificName ? `学名：${plant.scientificName}` : '',
    plant.feature || plant.featureText ? `特点：${plant.featureText || plant.feature}` : '',
    plant.description ? `简介：${plant.description}` : '',
    plant.care?.light ? `光照建议：${plant.care.light}` : '',
    plant.care?.water ? `浇水建议：${plant.care.water}` : ''
  ].filter(Boolean);

  return {
    type: 'plant_library',
    title: plant.name || '植物资料',
    content: parts.join('\n'),
    source: `plant_library:${plant.id}`,
    plantId: plant.id
  };
}

function searchProtocolKnowledge(query, limit = 3) {
  return PROTOCOL_SNIPPETS
    .map((snippet) => ({ snippet, score: scoreTextMatch(query, snippet.keywords) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => buildProtocolEntry(item.snippet));
}

function loadKnowledgeArticles(db) {
  return db.execute(
    `SELECT id, slug, title, summary, content, category, tags_json, aliases_json, plant_types_json,
            problem_types_json, source_type, source_ref, status, sort_order
     FROM knowledge_articles
     WHERE status = 'published'
     ORDER BY sort_order ASC, id ASC`
  ).then(([rows]) => {
    if (Array.isArray(rows) && rows.length > 0) {
      return rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        summary: row.summary,
        content: row.content,
        category: row.category,
        tags: normalizeArray(parseJsonField(row.tags_json, [])),
        aliases: normalizeArray(parseJsonField(row.aliases_json, [])),
        plantTypes: normalizeArray(parseJsonField(row.plant_types_json, [])),
        problemTypes: normalizeArray(parseJsonField(row.problem_types_json, [])),
        sourceType: row.source_type || 'seed',
        sourceRef: row.source_ref || '',
        status: row.status || 'published',
        sortOrder: Number(row.sort_order) || 0
      }));
    }
    return (Array.isArray(seedArticles) ? seedArticles : []).map(normalizeSeedArticle);
  }).catch(() => (Array.isArray(seedArticles) ? seedArticles : []).map(normalizeSeedArticle));
}

async function searchKnowledgeArticles(db, options = {}) {
  const query = String(options.query || '').trim();
  const plantType = String(options.plantType || '').trim();
  const category = String(options.category || '').trim();
  const tag = String(options.tag || '').trim();
  const limit = Math.max(1, Number(options.limit) || 2);
  const articles = await loadKnowledgeArticles(db);

  return articles
    .map((article) => ({
      ...article,
      score: scoreKnowledgeArticle(query || plantType || tag, article, { category, tag, plantType })
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.id - b.id;
    })
    .slice(0, limit)
    .map(buildKnowledgeArticleEntry);
}

async function searchKnowledgeBundle(db, options = {}) {
  const query = String(options.query || '').trim();
  const plantType = String(options.plantType || '').trim();
  const plantLibraryId = Number(options.plantLibraryId) || 0;
  const knowledgeLimit = Math.max(1, Number(options.knowledgeLimit) || 2);

  const [plantProfiles, knowledgeHits, protocolHits] = await Promise.all([
    searchPlantProfiles(db, {
      plantLibraryId,
      plantType,
      query,
      limit: 2
    }),
    searchKnowledgeArticles(db, {
      query,
      category: options.category || '',
      tag: options.tag || '',
      plantType,
      limit: knowledgeLimit
    }),
    Promise.resolve(searchProtocolKnowledge(query, 2))
  ]);

  const plantHits = plantProfiles.map(buildPlantKnowledgeEntry);
  const hits = plantHits.concat(knowledgeHits, protocolHits);

  return {
    hits,
    contextText: hits.length
      ? [
          '以下是本轮可引用的知识依据，请优先基于这些内容回答，避免超出依据自由发挥。',
          ...hits.map((item, index) => `${index + 1}. [${item.title}] ${item.content}`)
        ].join('\n')
      : ''
  };
}

module.exports = {
  searchKnowledgeBundle,
  searchKnowledgeArticles,
  searchProtocolKnowledge
};
