const PLANT_IMAGE_LIGHT = '/images/plant-light.png';
const PLANT_IMAGE_NIGHT = '/images/plant-night.png';

const DEFAULT_SENSORS = {
  temp: { value: '--', unit: 'C', label: 'temperature' },
  light: { value: '--', unit: 'lx', label: 'light' },
  humidity: { value: '--', unit: '%', label: 'humidity' },
  soil: { value: '--', unit: '%', label: 'soil moisture' }
};

const DEFAULT_EXTRA = {
  uid: '--',
  runState: null,
  irStatus: null,
  dsbTemp: '--',
  isDead: null,
  soulState: '--',
  favorability: '--',
  personality: '--',
  reportedPlantType: '--',
  updatedAt: '--'
};

const DEFAULT_FAN = {
  name: '风扇',
  icon: 'fan',
  isOn: false,
  pending: false,
  hasReportedState: false,
  statusText: '暂无上报',
  hintText: '等待设备最新上报'
};

const STALE_THRESHOLD_MS = 2 * 60 * 1000;

function derivePlantStatus({ device = null, soilValue = '--', nowTs = Date.now(), isOffline = false } = {}) {
  const base = {
    key: 'empty',
    tone: 'muted',
    icon: '○',
    label: '等待设备',
    description: '绑定设备后，我会开始陪你照顾它。',
    freshnessText: '暂无数据',
    growthText: '成长记录待解锁',
    careSuggestion: '',
    metrics: { soil: soilValue, humidity: '--' }
  };
  if (!device) return base;

  const updatedAt = Number(device.updatedAt || 0);
  if (isOffline || device.hasLatest === false) {
    return { ...base, key: 'offline', tone: 'offline', icon: '!', label: '暂时离线', description: '暂时收不到设备上报，先别急着操作。', freshnessText: '离线 · 等待上报' };
  }
  if (updatedAt > 0 && nowTs - updatedAt > STALE_THRESHOLD_MS) {
    return { ...base, key: 'stale', tone: 'stale', icon: '↻', label: '数据有点旧', description: '设备还在线，但最近一次数据需要再确认。', freshnessText: '数据陈旧 · 请留意' };
  }

  const soil = Number.parseFloat(soilValue);
  if (Number.isFinite(soil) && soil < 20) {
    return { ...base, key: 'attention', tone: 'attention', icon: '!', label: '有点口渴', description: '土壤有点干，今天记得给我浇水。', freshnessText: '在线 · 状态需关注', careSuggestion: '浇水' };
  }
  return { ...base, key: 'normal', tone: 'normal', icon: '●', label: '状态不错', description: '今天状态很好，继续保持这份照顾。', freshnessText: '在线 · 数据新鲜' };
}

function cloneSensors() {
  return JSON.parse(JSON.stringify(DEFAULT_SENSORS));
}

function cloneExtra() {
  return { ...DEFAULT_EXTRA };
}

function buildDefaultWeather() {
  return { icon: 'weather', temp: '--', desc: '' };
}

function buildDeviceMeta(item = {}) {
  const plantType = String(item.plantType || item?.plant?.name || '').trim();
  const location = String(item.location || '').trim();
  return {
    plantType,
    location,
    summary: [plantType, location].filter(Boolean).join(' / ') || '\u672a\u8bbe\u7f6e\u690d\u7269\u7c7b\u578b\u548c\u4f4d\u7f6e'
  };
}

function normalizeBooleanMetric(raw) {
  if (raw === true || raw === false) return raw;
  if (raw === 1 || raw === '1') return true;
  if (raw === 0 || raw === '0') return false;
  if (typeof raw === 'string') {
    const value = raw.trim().toLowerCase();
    if (['true', 'yes', 'dead'].includes(value)) return true;
    if (['false', 'no', 'alive'].includes(value)) return false;
  }
  return null;
}

function normalizeDisplayMetric(raw, fallback = '--') {
  if (raw === undefined || raw === null || raw === '') return fallback;
  return String(raw);
}

function normalizeTodoTitle(raw) {
  return typeof raw === 'string' ? raw.trim() : '';
}

function formatSoulStateByIr(raw) {
  const normalized = normalizeBooleanMetric(raw);
  if (normalized === true) return '\u5916';
  if (normalized === false) return '\u5185';
  return '--';
}

function buildDeviceRows(rawRows = [], previousKey = '', options = {}) {
  const isDeviceOffline = typeof options.isDeviceOffline === 'function'
    ? options.isDeviceOffline
    : () => false;

  const devices = Array.isArray(rawRows)
    ? rawRows.map((item) => ({
        ...buildDeviceMeta(item),
        _id: item.logicalKey || '',
        logicalKey: item.logicalKey || '',
        name: item.alias || item.deviceName || '\u672a\u547d\u540d\u8bbe\u5907',
        status: isDeviceOffline(item) ? '\u79bb\u7ebf' : '\u5728\u7ebf',
        icon: isDeviceOffline(item) ? 'offline' : 'online',
        active: false
      }))
    : [];

  let activeIndex = 0;
  if (previousKey) {
    const foundIndex = devices.findIndex((item) => item.logicalKey === previousKey);
    if (foundIndex >= 0) activeIndex = foundIndex;
  }
  if (devices.length > 0) {
    devices[activeIndex].active = true;
  }

  const selected = devices[activeIndex] || null;
  return {
    devices,
    selected,
    selectedLogicalKey: selected ? selected.logicalKey : '',
    plantName: selected ? selected.name : '\u8bf7\u9009\u62e9\u8bbe\u5907',
    plantMeta: selected ? selected.summary : '\u672a\u8bbe\u7f6e\u690d\u7269\u7c7b\u578b\u548c\u4f4d\u7f6e'
  };
}

function buildTelemetryState(deviceRows, selectedLogicalKey = '', options = {}) {
  if (!Array.isArray(deviceRows) || deviceRows.length === 0) {
    return {
      shouldReset: true,
      sensors: cloneSensors(),
      extraMetrics: cloneExtra(),
      fan: { ...DEFAULT_FAN },
      bubbles: [],
      moodEmoji: '\u{1f642}',
      dialogue: '\u690d\u682a\u72b6\u6001\u826f\u597d\u3002',
      plantStatus: derivePlantStatus()
    };
  }

  const formatTs = typeof options.formatTs === 'function'
    ? options.formatTs
    : (ts) => String(ts || '--');
  const isDeviceOffline = typeof options.isDeviceOffline === 'function'
    ? options.isDeviceOffline
    : () => false;
  const computeBubbles = typeof options.computeBubbles === 'function'
    ? options.computeBubbles
    : () => [];
  const computeMoodEmoji = typeof options.computeMoodEmoji === 'function'
    ? options.computeMoodEmoji
    : () => '\u{1f642}';

  const selected =
    deviceRows.find((item) => item && item.logicalKey === selectedLogicalKey) ||
    deviceRows.find((item) => item && !isDeviceOffline(item) && item.params) ||
    deviceRows[0];

  const params = selected && selected.params ? selected.params : {};
  const getNode = (keys) => {
    for (const key of keys) {
      const node = params[key];
      if (
        node &&
        typeof node === 'object' &&
        node.value !== undefined &&
        node.value !== null &&
        node.value !== ''
      ) {
        return node;
      }
    }
    return null;
  };

  const getBooleanValue = (node) => {
    if (typeof node === 'boolean') return node;
    if (node && typeof node === 'object' && typeof node.value === 'boolean') {
      return node.value;
    }
    return null;
  };

  const getNodeTime = (node) => {
    if (node && typeof node === 'object' && node.time) {
      return formatTs(node.time);
    }
    return null;
  };

  const tempNode = getNode(['dht_temp', 'temp', 'temperature', 'air_temp']);
  const humidityNode = getNode(['dht_humi', 'humidity', 'air_humidity']);
  const lightNode = getNode(['light_val', 'light', 'illuminance', 'lux']);
  const soilNode = getNode(['soil_percent', 'soil', 'soil_moisture']);
  const uidNode = getNode(['uid']);
  const dsbTempNode = getNode(['dsb_temp']);
  const runStateNode = params.run_state || null;
  const irStatusNode = params.ir_status || null;
  const isDeadNode = params.is_dead || null;
  const favorabilityNode = getNode(['favorability', 'favor', 'affinity', 'likability', 'haogandu']);
  const personalityNode = getNode(['plant_personality', 'personality', 'character']);
  const plantTypeNode = getNode(['plant_type', 'ptype']);
  const fanNode = params.fan_switch || params.test || null;

  const sensors = cloneSensors();
  const extraMetrics = cloneExtra();
  extraMetrics.reportedPlantType = selected?.plantType || selected?.plant?.name || '--';

  if (tempNode) sensors.temp.value = String(tempNode.value);
  if (humidityNode) sensors.humidity.value = String(humidityNode.value);
  if (lightNode) sensors.light.value = String(lightNode.value);
  if (soilNode) sensors.soil.value = String(soilNode.value);
  if (uidNode) extraMetrics.uid = String(uidNode.value);
  if (dsbTempNode) extraMetrics.dsbTemp = String(dsbTempNode.value);
  const runStateValue = getBooleanValue(runStateNode);
  const irStatusValue = getBooleanValue(irStatusNode);
  const isDeadValue = normalizeBooleanMetric(isDeadNode && typeof isDeadNode === 'object' ? isDeadNode.value : isDeadNode);
  if (runStateValue !== null) extraMetrics.runState = runStateValue;
  if (irStatusValue !== null) {
    extraMetrics.irStatus = irStatusValue;
    extraMetrics.soulState = formatSoulStateByIr(irStatusValue);
  }
  if (isDeadValue !== null) extraMetrics.isDead = isDeadValue;
  if (favorabilityNode) extraMetrics.favorability = normalizeDisplayMetric(favorabilityNode.value);
  if (personalityNode) extraMetrics.personality = normalizeDisplayMetric(personalityNode.value);
  if (plantTypeNode) extraMetrics.reportedPlantType = normalizeDisplayMetric(plantTypeNode.value);
  extraMetrics.updatedAt = selected && selected.updatedAt ? formatTs(selected.updatedAt) : '--';

  const fanReportedState = getBooleanValue(fanNode);
  const fanTime = getNodeTime(fanNode) || extraMetrics.updatedAt;
  const fan = {
    ...DEFAULT_FAN,
    isOn: fanReportedState === true,
    pending: false,
    hasReportedState: fanReportedState !== null,
    statusText: fanReportedState === null ? '\u6682\u65e0\u4e0a\u62a5' : (fanReportedState ? '\u98ce\u6247\u5df2\u5f00\u542f' : '\u98ce\u6247\u5df2\u5173\u95ed'),
    hintText: fanReportedState === null ? '\u7b49\u5f85\u8bbe\u5907\u6700\u65b0\u4e0a\u62a5' : `\u6700\u8fd1\u540c\u6b65 ${fanTime}`
  };

  const latestSensors = {
    temp: { value: sensors.temp.value },
    humidity: { value: sensors.humidity.value },
    light: { value: sensors.light.value },
    soil: { value: sensors.soil.value }
  };
  const bubbles = computeBubbles(latestSensors);
  const moodEmoji = computeMoodEmoji(latestSensors, extraMetrics);
  const warningBubble = bubbles.find((item) => item.type === 'warning');
  const dialogue = warningBubble
    ? `\u6ce8\u610f\uff1a${warningBubble.text}`
    : '\u690d\u682a\u72b6\u6001\u826f\u597d\u3002'
  const plantStatus = derivePlantStatus({
    device: selected,
    soilValue: sensors.soil.value,
    nowTs: options.nowTs || Date.now(),
    isOffline: isDeviceOffline(selected)
  });
  plantStatus.metrics = {
    soil: sensors.soil.value,
    humidity: sensors.humidity.value,
    updatedAt: extraMetrics.updatedAt
  };

  const resolvedFan = fanReportedState === null && selected && selected.fan && selected.fan.hasReportedState
    ? {
        ...selected.fan,
        pending: false,
        hintText: '\u7b49\u5f85\u8bbe\u5907\u786e\u8ba4'
      }
    : fan;

  return {
    shouldReset: false,
    sensors,
    extraMetrics,
    fan: resolvedFan,
    bubbles,
    moodEmoji,
    dialogue,
    plantStatus
  };
}

module.exports = {
  PLANT_IMAGE_LIGHT,
  PLANT_IMAGE_NIGHT,
  DEFAULT_SENSORS,
  DEFAULT_EXTRA,
  DEFAULT_FAN,
  cloneSensors,
  cloneExtra,
  buildDefaultWeather,
  buildDeviceMeta,
  normalizeBooleanMetric,
  normalizeDisplayMetric,
  normalizeTodoTitle,
  derivePlantStatus,
  formatSoulStateByIr,
  buildDeviceRows,
  buildTelemetryState
};
