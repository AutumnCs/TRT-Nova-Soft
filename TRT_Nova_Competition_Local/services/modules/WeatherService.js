const ScfApiAdapter = require('../core/ScfApiAdapter');

const WEATHER_ICON_MAP = Object.freeze({
  100: '☀️', 150: '🌙',
  101: '⛅', 102: '🌤️', 103: '🌤️', 104: '☁️',
  151: '🌥️', 152: '🌥️', 153: '🌥️',
  300: '🌧️', 301: '🌧️', 302: '⛈️', 303: '⛈️', 305: '🌦️',
  306: '🌧️', 307: '🌧️', 308: '⛈️', 309: '🌦️', 310: '⛈️',
  311: '⛈️', 312: '⛈️', 313: '⛈️', 314: '🌧️', 315: '🌧️',
  316: '🌧️', 317: '🌧️', 318: '🌧️', 350: '🌦️', 351: '🌧️', 399: '🌧️',
  400: '❄️', 401: '🌨️', 402: '🌨️', 403: '⛄', 404: '🌨️',
  405: '🌨️', 406: '🌨️', 407: '🌨️', 408: '🌨️', 409: '🌨️',
  410: '🌨️', 456: '🌨️', 457: '🌨️', 499: '❄️',
  500: '🌫️', 501: '🌫️', 502: '🌫️', 503: '🌫️', 504: '🌫️',
  507: '🌪️', 508: '🌪️', 509: '🌫️', 510: '🌫️', 511: '🌫️',
  512: '🌫️', 513: '🌫️', 514: '🌫️', 515: '🌫️'
});

function buildUnavailableSummary(weather = {}, preference = null) {
  return {
    available: false,
    loading: false,
    isStale: false,
    reason: weather.reason || 'unavailable',
    msg: weather.msg || '天气暂不可用',
    preference,
    icon: '○',
    temp: '--',
    desc: '',
    humidity: '--',
    wind: '',
    fetchedAt: '',
    sourceName: ''
  };
}

function optionalNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeWeatherSummary(response = {}) {
  if (response.success === false) {
    throw new Error(response.msg || '天气加载失败');
  }
  const preference = response.preference || null;
  const weather = response.weather || {};
  if (!weather.available) return buildUnavailableSummary(weather, preference);
  const temperature = optionalNumber(weather.temperature);
  const humidity = optionalNumber(weather.humidity);
  const windScale = optionalNumber(weather.windScale);
  const windParts = [weather.windDirection, windScale === null ? '' : `${windScale}级`]
    .filter(Boolean);
  return {
    available: true,
    loading: false,
    isStale: Boolean(weather.isStale),
    reason: '',
    msg: weather.msg || '',
    preference,
    icon: WEATHER_ICON_MAP[Number(weather.conditionCode)] || '🌤️',
    temp: temperature === null ? '--' : `${Math.round(temperature)}°`,
    desc: weather.conditionText || '',
    humidity: humidity === null ? '--' : `${humidity}%`,
    wind: windParts.join(' '),
    fetchedAt: weather.fetchedAt || '',
    sourceName: weather.source?.name || '和风天气',
    attributionUrls: Array.isArray(weather.source?.attributionUrls)
      ? weather.source.attributionUrls
      : []
  };
}

class WeatherService {
  constructor(adapter = new ScfApiAdapter()) {
    this.adapter = adapter;
  }

  async getCurrentWeather() {
    return normalizeWeatherSummary(await this.adapter.getWeatherSummary());
  }

  async searchCities(payload = {}) {
    const result = await this.adapter.searchWeatherCities(payload);
    if (result?.success === false) {
      const error = new Error(result.msg || '城市搜索失败');
      error.code = result.code || '';
      throw error;
    }
    return Array.isArray(result?.cities) ? result.cities : [];
  }

  async savePreference(city, source = 'manual') {
    const result = await this.adapter.saveWeatherPreference({ ...city, source });
    if (result?.success === false) throw new Error(result.msg || '城市保存失败');
    return result.preference;
  }

  async clearPreference() {
    const result = await this.adapter.clearWeatherPreference();
    if (result?.success === false) throw new Error(result.msg || '城市清除失败');
    return true;
  }

  clearCache() {
    // 30 分钟缓存由后端统一维护，客户端不再持有天气事实缓存。
  }
}

module.exports = new WeatherService();
module.exports.WeatherService = WeatherService;
module.exports.WEATHER_ICON_MAP = WEATHER_ICON_MAP;
module.exports.buildUnavailableSummary = buildUnavailableSummary;
module.exports.normalizeWeatherSummary = normalizeWeatherSummary;
