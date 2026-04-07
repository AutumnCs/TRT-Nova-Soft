/**
 * 传感器告警阈值配置
 *
 * 每个指标配置：
 *   low    - 低于此值触发低警告
 *   high   - 高于此值触发高警告
 *   unit   - 单位（用于展示）
 *   lowMsg / highMsg - 气泡提示文字
 *   lowIcon / highIcon - 气泡 emoji
 *   lowType / highType - 'warning'（橙/红） | 'success'（绿）
 *
 * 所有值均为可根据实际植物品种调整的默认值。
 * TODO: 未来可从服务端按 plantType 下发个性化阈值。
 */
const SENSOR_THRESHOLDS = {
  // 环境温度 ℃
  temp: {
    low: 15,
    high: 35,
    unit: '℃',
    lowIcon: '🥶',
    lowMsg: '温度偏低',
    lowType: 'warning',
    highIcon: '🔥',
    highMsg: '温度偏高',
    highType: 'warning',
    okIcon: '🌡️',
    okMsg: '温度适宜',
    okType: 'success'
  },
  // 环境湿度 %
  humidity: {
    low: 30,
    high: 85,
    unit: '%',
    lowIcon: '🏜️',
    lowMsg: '湿度偏低',
    lowType: 'warning',
    highIcon: '💦',
    highMsg: '湿度偏高',
    highType: 'warning',
    okIcon: '💧',
    okMsg: '湿度适宜',
    okType: 'success'
  },
  // 土壤湿度 %
  soil: {
    low: 20,
    high: 80,
    unit: '%',
    lowIcon: '🌵',
    lowMsg: '土壤缺水',
    lowType: 'warning',
    highIcon: '🌊',
    highMsg: '土壤过湿',
    highType: 'warning',
    okIcon: '🌱',
    okMsg: '土壤湿润',
    okType: 'success'
  },
  // 光照强度 lx
  light: {
    low: 500,
    high: 80000,
    unit: 'lx',
    lowIcon: '🌑',
    lowMsg: '光照不足',
    lowType: 'warning',
    highIcon: '☀️',
    highMsg: '光照过强',
    highType: 'warning',
    okIcon: '🌤️',
    okMsg: '光照适宜',
    okType: 'success'
  }
};

/**
 * 根据传感器当前值计算气泡提示列表（最多 2 条，优先展示异常）
 * @param {Object} sensors - { temp, humidity, soil, light }，每个包含 value 字段
 * @returns {Array<{ icon, text, type }>} 气泡数组（最多 2 条）
 */
function computeBubbles(sensors) {
  const results = [];

  for (const [key, cfg] of Object.entries(SENSOR_THRESHOLDS)) {
    const rawValue = sensors[key] && sensors[key].value;
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

  // 优先展示异常（warning），最多返回 2 条
  const warnings = results.filter(r => r.type === 'warning');
  const oks = results.filter(r => r.type === 'success');
  const ordered = [...warnings, ...oks];
  return ordered.slice(0, 2);
}

/**
 * 计算植物心情 emoji（根据异常条数）
 */
function computeMoodEmoji(sensors) {
  const bubbles = computeBubbles(sensors);
  const warningCount = bubbles.filter(b => b.type === 'warning').length;
  if (warningCount === 0) return '😊';
  if (warningCount === 1) return '😐';
  return '😟';
}

module.exports = { SENSOR_THRESHOLDS, computeBubbles, computeMoodEmoji };
