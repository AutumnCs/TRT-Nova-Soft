const SOLAR_TERMS = Object.freeze([
  '小寒', '大寒', '立春', '雨水', '惊蛰', '春分',
  '清明', '谷雨', '立夏', '小满', '芒种', '夏至',
  '小暑', '大暑', '立秋', '处暑', '白露', '秋分',
  '寒露', '霜降', '立冬', '小雪', '大雪', '冬至'
]);

const TERM_MINUTES = Object.freeze([
  0, 21208, 42467, 63836, 85337, 107014,
  128867, 150921, 173149, 195551, 218072, 240693,
  263343, 285989, 308563, 331033, 353350, 375494,
  397447, 419210, 440795, 462224, 483532, 504758
]);

const TERM_TIPS = Object.freeze({
  小寒: '减少频繁浇水，避开冷风直吹，先确认盆土再行动。',
  大寒: '保温比催长更重要，浇水尽量安排在较温暖的时段。',
  立春: '气温开始回升但仍会反复，可逐步增加观察与通风。',
  雨水: '湿度可能上升，注意盆土排水，不按固定天数机械浇水。',
  惊蛰: '生长活动渐强，可检查新芽、虫害和春季养护计划。',
  春分: '光照时长增加，逐步调整摆放，避免突然暴晒。',
  清明: '适合整理枯叶并观察根系与新芽，操作后留意恢复。',
  谷雨: '雨水增多时加强通风，室内盆栽仍以实际盆土为准。',
  立夏: '温度上升，关注午后强光和蒸发速度，避免积水闷根。',
  小满: '生长旺盛期先观察叶片和盆土，再调整水肥节奏。',
  芒种: '高温高湿渐明显，保持通风并及时清理病叶。',
  夏至: '日照较强，喜阴植物注意遮阴，浇水避开正午高温。',
  小暑: '防晒与通风并重，连续高温时增加观察频率。',
  大暑: '极端热天先保水降温，不在植株受热时突然大量施肥。',
  立秋: '暑热未必立即结束，继续按真实温湿度调整养护。',
  处暑: '昼夜变化开始明显，检查浇水节奏并维持良好通风。',
  白露: '早晚温差增大，敏感植物注意夜间低温和叶面久湿。',
  秋分: '日照逐步缩短，可重新评估室内摆放与浇水间隔。',
  寒露: '减少低温时段浇水，留意不耐寒植物的保温需求。',
  霜降: '关注最低温度，提前把不耐寒盆栽移到合适位置。',
  立冬: '多数植物生长放缓，减少无依据的水肥投入。',
  小雪: '室内取暖可能使空气变干，先观察叶片与盆土再补水。',
  大雪: '避开窗缝冷风和暖气直吹，保持稳定环境。',
  冬至: '日照较短，优先保证合适光照并防止盆土长期潮湿。'
});

const BASE_TIME = Date.UTC(1900, 0, 6, 2, 5);
const TROPICAL_YEAR_MS = 31556925974.7;
const DAY_MS = 24 * 60 * 60 * 1000;

function pad(value) {
  return String(value).padStart(2, '0');
}

function solarTermDate(year, termIndex) {
  const instant = new Date(
    BASE_TIME + TROPICAL_YEAR_MS * (year - 1900) + TERM_MINUTES[termIndex] * 60 * 1000
  );
  const month = Math.floor(termIndex / 2) + 1;
  return `${year}-${pad(month)}-${pad(instant.getUTCDate())}`;
}

function toShanghaiDate(value = new Date()) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  const shanghai = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return `${shanghai.getUTCFullYear()}-${pad(shanghai.getUTCMonth() + 1)}-${pad(shanghai.getUTCDate())}`;
}

function dateNumber(value) {
  const [year, month, day] = value.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

function getSolarTermState(value = new Date()) {
  const currentDate = toShanghaiDate(value);
  const year = Number(currentDate.slice(0, 4));
  const candidates = [];
  for (const candidateYear of [year - 1, year, year + 1]) {
    SOLAR_TERMS.forEach((name, index) => {
      candidates.push({ name, date: solarTermDate(candidateYear, index) });
    });
  }
  candidates.sort((a, b) => a.date.localeCompare(b.date));
  let currentIndex = 0;
  for (let index = 0; index < candidates.length; index += 1) {
    if (candidates[index].date > currentDate) break;
    currentIndex = index;
  }
  const current = candidates[currentIndex];
  const next = candidates[currentIndex + 1];
  return {
    name: current.name,
    date: current.date,
    nextName: next.name,
    nextDate: next.date,
    daysUntilNext: Math.max(0, dateNumber(next.date) - dateNumber(currentDate)),
    tip: TERM_TIPS[current.name],
    disclaimer: '节气按中国标准时间确定，为通用养护提示，不代表本地实时物候。'
  };
}

module.exports = {
  SOLAR_TERMS,
  TERM_TIPS,
  getSolarTermState,
  solarTermDate,
  toShanghaiDate
};
