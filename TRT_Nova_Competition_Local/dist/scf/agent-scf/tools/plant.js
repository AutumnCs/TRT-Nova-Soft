const fs = require('fs');
const path = require('path');

function loadSeedPlants() {
  const candidates = [
    path.join(__dirname, '..', 'data', 'knowledge', 'plants.json'),
    path.join(__dirname, '..', '..', '..', '..', 'data', 'knowledge', 'plants.json')
  ];
  for (const filePath of candidates) {
    try {
      if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
      console.warn('[plant] failed to load seed plants:', err.message);
    }
  }
  return [];
}

const seedPlants = loadSeedPlants();

function parseJsonField(input, fallback) {
  if (!input) return fallback;
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

function normalizePlantRow(row) {
  return {
    id: row.id,
    name: row.name || '',
    aliases: parseJsonField(row.aliases_json, []),
    family: row.family || '',
    scientificName: row.scientific_name || '',
    feature: row.feature || '',
    featureText: row.feature_text || '',
    category: row.category || '',
    tags: parseJsonField(row.tags_json, []),
    description: row.description || '',
    difficulty: row.difficulty || '',
    care: {
      light: row.care_light || '',
      water: row.care_water || '',
      temperature: row.care_temperature || '',
      humidity: row.care_humidity || '',
      soil: row.care_soil || '',
      fertilizer: row.care_fertilizer || '',
      ventilation: row.care_ventilation || ''
    },
    seasonalTips: parseJsonField(row.seasonal_tips_json, []),
    commonIssues: parseJsonField(row.common_issues_json, []),
    faq: parseJsonField(row.faq_json, []),
    recommendQuestions: parseJsonField(row.recommend_questions_json, []),
    deviceInterpretation: parseJsonField(row.device_interpretation_json, {}),
    agentNotes: row.agent_notes || '',
    status: row.content_status || 'draft',
    sourceTitle: row.source_title || '',
    sourcePublisher: row.source_publisher || '',
    sourceUpdatedAt: row.source_updated_at || '',
    sourceUrl: row.source_url || '',
    sourceId: row.source_id || '',
    contentUpdatedAt: row.content_updated_at || '',
    reviewedAt: row.reviewed_at || null,
    reviewedBy: row.reviewed_by || '',
    imageLicense: row.image_license || '',
    imageSourceUrl: row.image_source_url || ''
  };
}

function normalizeSeedPlant(row = {}) {
  const care = row.care && typeof row.care === 'object' ? row.care : {};
  return {
    id: Number(row.id) || 0,
    name: row.name || '',
    aliases: Array.isArray(row.aliases) ? row.aliases : [],
    family: row.family || '',
    scientificName: row.scientificName || '',
    feature: row.feature || '',
    featureText: row.featureText || '',
    category: row.category || '',
    tags: Array.isArray(row.tags) ? row.tags : [],
    description: row.description || '',
    difficulty: row.difficulty || '',
    care,
    seasonalTips: Array.isArray(row.seasonalTips) ? row.seasonalTips : [],
    commonIssues: Array.isArray(row.commonIssues) ? row.commonIssues : [],
    faq: Array.isArray(row.faq) ? row.faq : [],
    recommendQuestions: Array.isArray(row.recommendQuestions) ? row.recommendQuestions : [],
    deviceInterpretation: row.deviceInterpretation || {},
    agentNotes: row.agentNotes || '',
    status: String(row.status || row.contentStatus || 'draft').trim() || 'draft',
    sourceTitle: row.sourceTitle || '',
    sourcePublisher: row.sourcePublisher || '',
    sourceUpdatedAt: row.sourceUpdatedAt || '',
    sourceUrl: row.sourceUrl || '',
    sourceId: row.sourceId || '',
    contentUpdatedAt: row.contentUpdatedAt || '',
    reviewedAt: row.reviewedAt || null,
    reviewedBy: row.reviewedBy || '',
    imageLicense: row.imageLicense || '',
    imageSourceUrl: row.imageSourceUrl || ''
  };
}

function tokenizeSearchInput(input) {
  return String(input || '')
    .split(/[・,，\/\s()（）\-]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function scorePlant(row, options = {}) {
  const plantType = String(options.plantType || '').trim();
  const query = String(options.query || '').trim();
  const text = [
    row.name,
    ...(Array.isArray(row.aliases) ? row.aliases : []),
    row.family,
    row.scientificName,
    row.feature,
    row.featureText,
    row.category,
    row.description,
    row.care.light,
    row.care.water,
    ...(Array.isArray(row.tags) ? row.tags : [])
  ].join(' ');

  let score = 0;
  const containsEither = (left, right) => {
    const a = String(left || '').trim().toLowerCase();
    const b = String(right || '').trim().toLowerCase();
    if (!a || !b) return false;
    return a.includes(b) || b.includes(a);
  };
  const tokenize = (input) =>
    String(input || '')
      .split(/[・,，\/\s()（）\-]+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2);
  const fuzzyMatch = (left, right) => {
    if (containsEither(left, right)) return true;
    const leftTokens = tokenize(left);
    const rightTokens = tokenize(right);
    return leftTokens.some((token) => rightTokens.some((part) => containsEither(token, part))) ||
      leftTokens.some((token) => String(right || '').includes(token)) ||
      rightTokens.some((part) => String(left || '').includes(part));
  };

  if (plantType) {
    if (row.name === plantType) score += 12;
    else if (fuzzyMatch(text, plantType)) score += 8;
  }

  if (query) {
    if (row.name && fuzzyMatch(row.name, query)) score += 10;
    if (row.scientificName && fuzzyMatch(row.scientificName, query)) score += 8;
    if (row.category === 'succulent' && query.includes('多肉')) score += 10;
    if (row.category === 'foliage' && (query.includes('观叶') || query.includes('绿植'))) score += 6;
    if (row.featureText && fuzzyMatch(row.featureText, query)) score += 5;
    if (row.description && fuzzyMatch(row.description, query)) score += 3;
    if (Array.isArray(row.aliases)) {
      row.aliases.forEach((alias) => {
        if (fuzzyMatch(alias, query)) score += 8;
      });
    }
    if (Array.isArray(row.tags)) {
      row.tags.forEach((tag) => {
        if (fuzzyMatch(tag, query)) score += 4;
      });
    }
  }

  return score;
}

async function searchPlantProfiles(db, options = {}) {
  const plantLibraryId = Number(options.plantLibraryId) || 0;
  const plantType = String(options.plantType || '').trim();
  const query = String(options.query || '').trim();
  const limit = Math.max(1, Number(options.limit) || 3);

  let rows = [];

  try {
    if (plantLibraryId) {
      const [exactRows] = await db.query(
      `SELECT id, name, family, scientific_name, feature, feature_text, category,
              tags_json, description, aliases_json, difficulty,
              care_light, care_water, care_temperature, care_humidity, care_soil,
              care_fertilizer, care_ventilation, seasonal_tips_json,
              common_issues_json, faq_json, recommend_questions_json,
              device_interpretation_json, agent_notes, content_status,
              source_title, source_publisher, source_updated_at, source_url, source_id,
              content_updated_at, reviewed_at, reviewed_by, image_license, image_source_url
       FROM plant_library
       WHERE id = ? AND is_active = 1 AND content_status = 'published'
       LIMIT 1`,
      [plantLibraryId]
      );
      rows = exactRows;
    } else {
      const [allRows] = await db.query(
      `SELECT id, name, family, scientific_name, feature, feature_text, category,
              tags_json, description, aliases_json, difficulty,
              care_light, care_water, care_temperature, care_humidity, care_soil,
              care_fertilizer, care_ventilation, seasonal_tips_json,
              common_issues_json, faq_json, recommend_questions_json,
              device_interpretation_json, agent_notes, content_status,
              source_title, source_publisher, source_updated_at, source_url, source_id,
              content_updated_at, reviewed_at, reviewed_by, image_license, image_source_url
       FROM plant_library
       WHERE is_active = 1 AND content_status = 'published'
       ORDER BY sort_order ASC, id ASC
       LIMIT 200`
      );
      rows = allRows;
    }
  } catch (err) {
    rows = (Array.isArray(seedPlants) ? seedPlants : [])
      .map(normalizeSeedPlant)
      .filter((item) => item.status === 'published');
  }

  const normalizedRows = rows.map((row) => row.scientificName !== undefined ? row : normalizePlantRow(row));
  const matchedRows = normalizedRows
    .map((row) => ({ row, score: scorePlant(row, { plantType, query }) }))
    .filter((item) => plantLibraryId || item.score > 0)
    .sort((a, b) => b.score - a.score || a.row.id - b.row.id)
    .slice(0, limit)
    .map((item) => item.row);

  if (matchedRows.length) {
    return matchedRows;
  }

  return [];
}

function normalizePlantMention(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[・,，、\/\s()（）\-]+/g, '');
}

function getPlantMentionTerms(plant = {}) {
  return [plant.name, plant.scientificName]
    .concat(Array.isArray(plant.aliases) ? plant.aliases : [])
    .map(normalizePlantMention)
    .filter((item) => item.length >= 2);
}

function messageMentionsPlant(message, plant = {}) {
  const text = normalizePlantMention(message);
  if (!text) return false;
  return getPlantMentionTerms(plant).some((term) => text.includes(term));
}

function plantPetMatchesProfile(pet = {}, plant = {}) {
  const petTerms = [pet.speciesName]
    .map(normalizePlantMention)
    .filter((item) => item.length >= 2);
  const profileTerms = getPlantMentionTerms(plant);
  return petTerms.some((petTerm) =>
    profileTerms.some((profileTerm) =>
      petTerm === profileTerm || petTerm.includes(profileTerm) || profileTerm.includes(petTerm)
    )
  );
}

async function findMentionedPlantProfiles(db, query, limit = 3) {
  const rows = await searchPlantProfiles(db, { query, limit: 200 });
  return rows
    .filter((plant) => messageMentionsPlant(query, plant))
    .slice(0, Math.max(1, Number(limit) || 3));
}

module.exports = {
  searchPlantProfiles,
  findMentionedPlantProfiles,
  messageMentionsPlant,
  plantPetMatchesProfile
};
