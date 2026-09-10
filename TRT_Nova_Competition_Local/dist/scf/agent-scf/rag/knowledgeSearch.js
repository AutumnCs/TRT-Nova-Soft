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

function containsEither(left, right) {
  const a = String(left || '').trim().toLowerCase();
  const b = String(right || '').trim().toLowerCase();
  return Boolean(a && b && (a.includes(b) || b.includes(a)));
}

const QUERY_STOP_TERMS = new Set([
  '什么', '怎么', '怎样', '如何', '一下', '可以', '是否', '我的', '这个', '那个',
  '现在', '一般', '帮我', '请问', '植物', '植株', '养护', '问题', '需要', '应该'
]);

function normalizeSearchText(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .trim();
}

function tokenizeKnowledgeQuery(input) {
  const source = String(input || '').toLowerCase();
  const tokens = new Set();
  const asciiTerms = source.match(/[a-z0-9_]{2,}/g) || [];
  asciiTerms.forEach((term) => tokens.add(term));
  const cjkRuns = source.match(/[\u3400-\u9fff]{2,}/g) || [];
  cjkRuns.forEach((run) => {
    if (run.length <= 4 && !QUERY_STOP_TERMS.has(run)) tokens.add(run);
    for (let size = 2; size <= Math.min(4, run.length); size += 1) {
      for (let index = 0; index <= run.length - size; index += 1) {
        const token = run.slice(index, index + size);
        if (!QUERY_STOP_TERMS.has(token)) tokens.add(token);
      }
    }
  });
  return Array.from(tokens).filter((token) => token.length >= 2).slice(0, 80);
}

function scoreFieldTerms(field, terms, weight) {
  const normalized = normalizeSearchText(field);
  if (!normalized) return { score: 0, matched: [] };
  const matched = terms.filter((term) => normalized.includes(normalizeSearchText(term)));
  return { score: matched.length * weight, matched };
}

function splitKnowledgePassages(content) {
  const source = String(content || '').replace(/\r\n?/g, '\n').trim();
  if (!source) return [];
  const paragraphs = source.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const passages = [];
  paragraphs.forEach((paragraph) => {
    if (paragraph.length <= 420) {
      passages.push(paragraph);
      return;
    }
    const sentences = paragraph.split(/(?<=[。！？；])/u).map((item) => item.trim()).filter(Boolean);
    let current = '';
    sentences.forEach((sentence) => {
      if (current && current.length + sentence.length > 420) {
        passages.push(current);
        current = sentence;
      } else {
        current += sentence;
      }
    });
    if (current) passages.push(current);
  });
  return passages;
}

function selectRelevantPassages(article, terms = [], plantType = '') {
  const passages = splitKnowledgePassages(article.content);
  if (!passages.length) return [];
  const evidenceTerms = Array.from(new Set(terms.concat(plantType ? [plantType] : [])));
  const ranked = passages.map((passage, index) => {
    const match = scoreFieldTerms(passage, evidenceTerms, 1);
    return { passage, index, score: match.score };
  }).sort((left, right) => right.score - left.score || left.index - right.index);
  const selected = ranked.filter((item) => item.score > 0).slice(0, 3);
  if (!selected.length) selected.push(ranked[0]);
  return selected.map((item) => item.passage).filter(Boolean);
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
    sourceType: String(article.sourceType || 'external-reference').trim() || 'external-reference',
    sourceRef: String(article.sourceRef || '').trim(),
    sourceTitle: String(article.sourceTitle || '').trim(),
    sourcePublisher: String(article.sourcePublisher || '').trim(),
    sourceUpdatedAt: String(article.sourceUpdatedAt || '').trim(),
    sourceUrl: String(article.sourceUrl || '').trim(),
    sourceId: String(article.sourceId || '').trim(),
    contentUpdatedAt: String(article.contentUpdatedAt || '').trim(),
    reviewedAt: article.reviewedAt || null,
    reviewedBy: String(article.reviewedBy || '').trim(),
    status: String(article.status || 'draft').trim() || 'draft',
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
  if (plantType && (article.plantTypes || []).length && !(article.plantTypes || []).some((item) => containsEither(item, plantType))) return 0;

  const terms = tokenizeKnowledgeQuery(text);
  let score = 0;
  const matched = new Set();
  const addField = (value, weight) => {
    const result = scoreFieldTerms(value, terms, weight);
    score += result.score;
    result.matched.forEach((term) => matched.add(term));
  };
  addField(article.title, 16);
  addField((article.aliases || []).join(' '), 14);
  addField((article.tags || []).join(' '), 12);
  addField((article.plantTypes || []).join(' '), 12);
  addField((article.problemTypes || []).join(' '), 11);
  addField(article.summary, 6);
  addField(article.content, 2);
  if (plantType && (article.plantTypes || []).some((item) => containsEither(item, plantType))) {
    score += 36;
    matched.add(plantType.toLowerCase());
  }
  if (!text && plantType) score += 12;
  article._matchedTerms = Array.from(matched);
  return score >= 8 ? score : 0;
}

function buildKnowledgeArticleEntry(article) {
  const relevantPassages = selectRelevantPassages(
    article,
    Array.isArray(article._matchedTerms) ? article._matchedTerms : [],
    article._matchedPlantType || ''
  );
  const contentParts = [article.summary].concat(relevantPassages).map((item) => String(item || '').trim()).filter(Boolean);
  return {
    type: 'knowledge_article',
    title: article.title || '知识文章',
    content: Array.from(new Set(contentParts)).join('\n'),
    source: article.sourceUrl || (article.sourceRef ? `knowledge_articles:${article.sourceRef}` : `knowledge_articles:${article.slug || article.id}`),
    articleId: article.id,
    slug: article.slug,
    category: article.category,
    score: Number(article.score) || 0,
    matchedTerms: Array.isArray(article._matchedTerms) ? article._matchedTerms : [],
    tags: Array.isArray(article.tags) ? article.tags : [],
    aliases: Array.isArray(article.aliases) ? article.aliases : [],
    plantTypes: Array.isArray(article.plantTypes) ? article.plantTypes : [],
    problemTypes: Array.isArray(article.problemTypes) ? article.problemTypes : [],
    status: article.status || 'draft',
    sourceTitle: article.sourceTitle || '',
    sourcePublisher: article.sourcePublisher || '',
    sourceUrl: article.sourceUrl || '',
    sourceId: article.sourceId || '',
    contentUpdatedAt: article.contentUpdatedAt || '',
    reviewedAt: article.reviewedAt || null,
    reviewedBy: article.reviewedBy || '',
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
    source: plant.sourceUrl || `plant_library:${plant.sourceId || plant.id}`,
    plantId: plant.id,
    status: plant.status || 'draft',
    sourceTitle: plant.sourceTitle || '',
    sourcePublisher: plant.sourcePublisher || '',
    sourceUrl: plant.sourceUrl || '',
    sourceId: plant.sourceId || '',
    contentUpdatedAt: plant.contentUpdatedAt || '',
    reviewedAt: plant.reviewedAt || null,
    reviewedBy: plant.reviewedBy || ''
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
            problem_types_json, source_type, source_ref, source_title, source_publisher,
            source_updated_at, source_url, source_id, content_updated_at, reviewed_at,
            reviewed_by, status, sort_order
     FROM knowledge_articles
     WHERE status = 'published'
     ORDER BY sort_order ASC, id ASC`
  ).then(([rows]) => {
    if (Array.isArray(rows)) {
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
        sourceType: row.source_type || 'external-reference',
        sourceRef: row.source_ref || '',
        sourceTitle: row.source_title || '',
        sourcePublisher: row.source_publisher || '',
        sourceUpdatedAt: row.source_updated_at || '',
        sourceUrl: row.source_url || '',
        sourceId: row.source_id || '',
        contentUpdatedAt: row.content_updated_at || '',
        reviewedAt: row.reviewed_at || null,
        reviewedBy: row.reviewed_by || '',
        status: row.status || 'draft',
        sortOrder: Number(row.sort_order) || 0
      }));
    }
    return [];
  }).catch(() => (Array.isArray(seedArticles) ? seedArticles : [])
    .map(normalizeSeedArticle)
    .filter((item) => item.status === 'published'));
}

async function searchKnowledgeArticles(db, options = {}) {
  const query = String(options.query || '').trim();
  const plantType = String(options.plantType || '').trim();
  const category = String(options.category || '').trim();
  const tag = String(options.tag || '').trim();
  const limit = Math.max(1, Number(options.limit) || 2);
  const articles = (await loadKnowledgeArticles(db)).filter((item) => item.status === 'published');

  return articles
    .map((article) => ({
      ...article,
      _matchedPlantType: plantType,
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

  const [plantProfiles, knowledgeHits] = await Promise.all([
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
    })
  ]);

  const plantHits = plantProfiles
    .filter((item) => item.status === 'published')
    .map(buildPlantKnowledgeEntry);
  const hits = plantHits.concat(knowledgeHits);

  return {
    hits,
    contextText: hits.length
      ? [
          '以下仅包含人工复核且已发布的知识依据。没有覆盖到的事实请明确说不知道或不确定，不得补造来源。',
          ...hits.map((item, index) => `${index + 1}. [${item.title}] ${item.content}\n来源：${item.sourcePublisher || '未标注机构'}｜${item.sourceTitle || item.sourceId || item.source}｜${item.sourceUrl || item.source}`)
        ].join('\n')
      : '',
    unknown: hits.length === 0
  };
}

module.exports = {
  searchKnowledgeBundle,
  searchKnowledgeArticles,
  searchProtocolKnowledge,
  tokenizeKnowledgeQuery,
  splitKnowledgePassages,
  selectRelevantPassages,
  scoreKnowledgeArticle
};
