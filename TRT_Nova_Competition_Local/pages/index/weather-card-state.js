function formatShanghaiTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const shanghai = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const pad = (item) => String(item).padStart(2, '0');
  return `${pad(shanghai.getUTCMonth() + 1)}月${pad(shanghai.getUTCDate())}日 ${pad(shanghai.getUTCHours())}:${pad(shanghai.getUTCMinutes())}`;
}

function buildWeatherCardState(summary = {}) {
  const preference = summary.preference || null;
  const cityParts = preference
    ? [preference.city, preference.adm2, preference.adm1].filter((item, index, values) => item && values.indexOf(item) === index)
    : [];
  return {
    available: Boolean(summary.available),
    loading: Boolean(summary.loading),
    isStale: Boolean(summary.isStale),
    reason: summary.reason || '',
    msg: summary.msg || '',
    icon: summary.icon || '○',
    temp: summary.temp || '--',
    desc: summary.desc || '',
    humidity: summary.humidity || '--',
    wind: summary.wind || '',
    cityLabel: cityParts.join(' · ') || '未设置城市',
    updatedLabel: formatShanghaiTime(summary.fetchedAt),
    sourceName: summary.sourceName || ''
  };
}

function buildLoadingWeatherCard() {
  return buildWeatherCardState({
    loading: true,
    available: false,
    msg: '正在读取真实天气'
  });
}

module.exports = {
  buildLoadingWeatherCard,
  buildWeatherCardState,
  formatShanghaiTime
};
