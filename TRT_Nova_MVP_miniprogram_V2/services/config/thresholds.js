/**
 * Sensor threshold configuration and derived UI helpers.
 * Use Unicode escapes so text stays stable across editors/encodings.
 */
const SENSOR_THRESHOLDS = {
  temp: {
    low: 15,
    high: 35,
    unit: '\u2103',
    lowIcon: '\u{1F321}\uFE0F',
    lowMsg: '\u6e29\u5ea6\u504f\u4f4e',
    lowType: 'warning',
    highIcon: '\u{1F525}',
    highMsg: '\u6e29\u5ea6\u504f\u9ad8',
    highType: 'warning',
    okIcon: '\u{1F4A1}',
    okMsg: '\u6e29\u5ea6\u9002\u5b9c',
    okType: 'success'
  },
  humidity: {
    low: 30,
    high: 85,
    unit: '%',
    lowIcon: '\u{1F4A7}',
    lowMsg: '\u6e7f\u5ea6\u504f\u4f4e',
    lowType: 'warning',
    highIcon: '\u{1F4A6}',
    highMsg: '\u6e7f\u5ea6\u504f\u9ad8',
    highType: 'warning',
    okIcon: '\u{1F4A7}',
    okMsg: '\u6e7f\u5ea6\u9002\u5b9c',
    okType: 'success'
  },
  soil: {
    low: 20,
    high: 80,
    unit: '%',
    lowIcon: '\u{1F4A9}',
    lowMsg: '\u571f\u58e4\u7f3a\u6c34',
    lowType: 'warning',
    highIcon: '\u{1F4A9}',
    highMsg: '\u571f\u58e4\u8fc7\u6e7f',
    highType: 'warning',
    okIcon: '\u{1F33F}',
    okMsg: '\u571f\u58e4\u6e7f\u6da6',
    okType: 'success'
  },
  light: {
    low: 500,
    high: 80000,
    unit: 'lx',
    lowIcon: '\u{1F506}',
    lowMsg: '\u5149\u7167\u4e0d\u8db3',
    lowType: 'warning',
    highIcon: '\u2600\uFE0F',
    highMsg: '\u5149\u7167\u8fc7\u5f3a',
    highType: 'warning',
    okIcon: '\u{1F31E}',
    okMsg: '\u5149\u7167\u9002\u5b9c',
    okType: 'success'
  }
};

function computeBubbles(sensors) {
  const results = [];

  for (const [key, cfg] of Object.entries(SENSOR_THRESHOLDS)) {
    const rawValue = sensors?.[key]?.value;
    if (rawValue === '--' || rawValue === null || rawValue === undefined) continue;

    const num = parseFloat(rawValue);
    if (!Number.isFinite(num)) continue;

    if (num < cfg.low) {
      results.push({ icon: cfg.lowIcon, text: cfg.lowMsg, type: cfg.lowType });
    } else if (num > cfg.high) {
      results.push({ icon: cfg.highIcon, text: cfg.highMsg, type: cfg.highType });
    } else {
      results.push({ icon: cfg.okIcon, text: cfg.okMsg, type: cfg.okType });
    }
  }

  const warnings = results.filter((item) => item.type === 'warning');
  const oks = results.filter((item) => item.type === 'success');
  return [...warnings, ...oks].slice(0, 2);
}

function normalizeNumericValue(raw) {
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

function normalizeBooleanValue(raw) {
  if (raw === true || raw === false) return raw;
  if (raw === 1 || raw === '1') return true;
  if (raw === 0 || raw === '0') return false;
  if (typeof raw === 'string') {
    const value = raw.trim().toLowerCase();
    if (['true', 'yes', 'alive', 'normal'].includes(value)) return true;
    if (['false', 'no', 'dead'].includes(value)) return false;
  }
  return null;
}

function resolveMoodByPersonality(personality) {
  const value = typeof personality === 'string' ? personality.trim().toLowerCase() : '';
  if (!value) {
    const code = normalizeNumericValue(personality);
    if (code === null) return '';
    if (code === 1) return '\u{1F603}';
    if (code === 2) return '\u{1F60A}';
    if (code === 3) return '\u{1F60C}';
    if (code === 4) return '\u{1F607}';
    if (code === 5) return '\u{1F617}';
    return '\u{1F60D}';
  }

  if (value.includes('\u5f00\u5fc3') || value.includes('happy') || value.includes('cheerful') || value.includes('\u6d3b\u6cfc')) return '\u{1F603}';
  if (value.includes('\u5e73\u9759') || value.includes('calm') || value.includes('gentle') || value.includes('\u6e29\u67d4')) return '\u{1F60D}';
  if (value.includes('\u5bb3\u7f9e') || value.includes('shy') || value.includes('\u53ef\u7231') || value.includes('cute')) return '\u{1F60A}';
  if (value.includes('\u751f\u6c14') || value.includes('angry') || value.includes('\u50a2\u50f5') || value.includes('\u501a\u5f3a')) return '\u{1F60C}';
  if (value.includes('\u96be\u8fc7') || value.includes('sad') || value.includes('\u4f4e\u843d') || value.includes('\u5b64\u5355')) return '\u{1F617}';
  if (value.includes('\u56f0') || value.includes('sleepy') || value.includes('lazy') || value.includes('\u61d2\u60f0')) return '\u{1F617}';
  return '';
}

function computeMoodEmoji(sensors, extra = {}) {
  const deadFlag = normalizeBooleanValue(extra.isDead);
  if (deadFlag === true) return '\u{1F480}';

  const personalityMood = resolveMoodByPersonality(extra.personality);
  if (personalityMood) return personalityMood;

  const favorability = normalizeNumericValue(extra.favorability);
  if (favorability !== null) {
    if (favorability >= 85) return '\u{1F60A}';
    if (favorability >= 65) return '\u{1F642}';
    if (favorability >= 40) return '\u{1F60C}';
    if (favorability >= 20) return '\u{1F615}';
    return '\u{1F617}';
  }

  const soulState = normalizeNumericValue(extra.soulState);
  if (soulState !== null) {
    if (soulState >= 80) return '\u{1F60A}';
    if (soulState >= 60) return '\u{1F642}';
    if (soulState >= 30) return '\u{1F610}';
    return '\u{1F480}';
  }

  const bubbles = computeBubbles(sensors);
  const warningCount = bubbles.filter((item) => item.type === 'warning').length;
  if (warningCount === 0) return '\u{1F642}';
  if (warningCount === 1) return '\u{1F610}';
  return '\u{1F615}';
}

module.exports = { SENSOR_THRESHOLDS, computeBubbles, computeMoodEmoji };
