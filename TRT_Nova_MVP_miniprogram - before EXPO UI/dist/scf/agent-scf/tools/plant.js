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
    agentNotes: row.agent_notes || ''
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

  if (plantLibraryId) {
    const [exactRows] = await db.execute(
      `SELECT id, name, family, scientific_name, feature, feature_text, category,
              tags_json, description, aliases_json, difficulty,
              care_light, care_water, care_temperature, care_humidity, care_soil,
              care_fertilizer, care_ventilation, seasonal_tips_json,
              common_issues_json, faq_json, recommend_questions_json,
              device_interpretation_json, agent_notes
       FROM plant_library
       WHERE id = ? AND is_active = 1
       LIMIT 1`,
      [plantLibraryId]
    );
    rows = exactRows;
  } else {
    const [allRows] = await db.execute(
      `SELECT id, name, family, scientific_name, feature, feature_text, category,
              tags_json, description, aliases_json, difficulty,
              care_light, care_water, care_temperature, care_humidity, care_soil,
              care_fertilizer, care_ventilation, seasonal_tips_json,
              common_issues_json, faq_json, recommend_questions_json,
              device_interpretation_json, agent_notes
       FROM plant_library
       WHERE is_active = 1
       ORDER BY sort_order ASC, id ASC
       LIMIT 200`
    );
    rows = allRows;
  }

  const normalizedRows = rows.map(normalizePlantRow);
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

module.exports = {
  searchPlantProfiles
};
