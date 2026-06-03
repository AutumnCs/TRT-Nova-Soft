/**
 * WeatherService - 真实天气数据服务
 *
 * 接入方案：和风天气（QWeather）免费开发者 API
 *   - 注册：https://dev.qweather.com/
 *   - 免费额度：1000 次/天
 *   - 接口文档：https://dev.qweather.com/docs/api/weather/weather-now/
 *
 * 使用前需要：
 *   1. 在和风天气控制台创建 Web API 应用，获取 API Key
 *   2. 在 app.js globalData.runtimeConfig 中添加：
 *      weatherApiKey: 'YOUR_QWEATHER_API_KEY'
 *   3. 在微信小程序后台「开发」→「开发设置」→「服务器域名」中
 *      将 https://devapi.qweather.com 添加到 request 合法域名
 *
 * 注意：wx.getLocation 需在 app.json 中声明 permission，并在使用前获取用户授权。
 */

const { resolveRuntimeConfig } = require('../config/runtime');

// 天气图标映射（和风天气 icon code → emoji）
const WEATHER_ICON_MAP = {
  // 晴
  100: '☀️', 150: '🌙',
  // 多云
  101: '⛅', 102: '🌤️', 103: '🌤️', 104: '☁️',
  // 阴
  151: '🌥️', 152: '🌥️', 153: '🌥️',
  // 小雨
  300: '🌧️', 301: '🌧️', 305: '🌦️', 306: '🌧️', 307: '🌧️',
  308: '⛈️', 309: '🌦️', 310: '⛈️', 311: '⛈️', 312: '⛈️',
  313: '⛈️', 314: '🌧️', 315: '🌧️', 316: '🌧️', 317: '🌧️',
  318: '🌧️', 350: '🌦️', 351: '🌧️', 399: '🌧️',
  // 雪
  400: '❄️', 401: '🌨️', 402: '🌨️', 403: '⛄', 404: '🌨️',
  405: '🌨️', 406: '🌨️', 407: '🌨️', 408: '🌨️', 409: '🌨️',
  410: '🌨️', 456: '🌨️', 457: '🌨️', 499: '❄️',
  // 雾/霾
  500: '🌫️', 501: '🌫️', 502: '🌫️', 503: '🌫️', 504: '🌫️',
  507: '🌪️', 508: '🌪️', 509: '🌫️', 510: '🌫️', 511: '🌫️',
  512: '🌫️', 513: '🌫️', 514: '🌫️', 515: '🌫️',
  // 雷暴
  302: '⛈️', 303: '⛈️'
};

// 缓存时长（ms）
const CACHE_DURATION = 30 * 60 * 1000; // 30 分钟

class WeatherService {
  constructor() {
    this._cache = null;
    this._cacheTime = 0;
    this._fetching = false; // 防止并发请求
  }

  /**
   * 获取当前天气
   * @returns {Promise<{ icon: string, temp: string, desc: string, city: string }>}
   */
  async getCurrentWeather() {
    // 命中缓存，直接返回
    if (this._cache && Date.now() - this._cacheTime < CACHE_DURATION) {
      return this._cache;
    }

    // 已有请求进行中，不重复发起，返回默认值等下次缓存命中
    if (this._fetching) {
      return this._cache || this._defaultWeather();
    }

    // API Key 未配置时，直接返回默认值，不发起 getLocation（避免模拟器卡顿）
    const config = resolveRuntimeConfig();
    if (!config.weatherApiKey) {
      return this._defaultWeather();
    }

    this._fetching = true;
    try {
      const location = await this._getLocationWithTimeout(3000);
      const weather = await this._fetchWeather(location.latitude, location.longitude);
      this._cache = weather;
      this._cacheTime = Date.now();
      return weather;
    } catch (err) {
      console.warn('[WeatherService] 获取天气失败:', err.message || err);
      return this._cache || this._defaultWeather();
    } finally {
      this._fetching = false;
    }
  }

  /**
   * 清除缓存（强制下次刷新）
   */
  clearCache() {
    this._cache = null;
    this._cacheTime = 0;
  }

  // ── 内部方法 ────────────────────────────────────────────

  _getLocationWithTimeout(ms) {
    return new Promise((resolve, reject) => {
      let done = false;

      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        reject(new Error('getLocation timeout'));
      }, ms);

      wx.getLocation({
        type: 'wgs84',
        success: (res) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve({ latitude: res.latitude, longitude: res.longitude });
        },
        fail: (err) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          reject(new Error(err.errMsg || 'getLocation failed'));
        }
      });
    });
  }

  async _fetchWeather(lat, lon) {
    const config = resolveRuntimeConfig();
    const apiKey = config.weatherApiKey || '';

    if (!apiKey) {
      console.warn('[WeatherService] weatherApiKey 未配置，请在 app.js runtimeConfig 中添加');
      return this._defaultWeather();
    }

    // 和风天气免费版接口（开发环境 devapi，正式环境换 api.qweather.com）
    const url = `https://devapi.qweather.com/v7/weather/now?location=${lon},${lat}&key=${apiKey}&lang=zh`;

    return new Promise((resolve, reject) => {
      wx.request({
        url,
        method: 'GET',
        timeout: 5000,
        success: (res) => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          const data = res.data;
          if (data.code !== '200') {
            reject(new Error(`QWeather API error: ${data.code}`));
            return;
          }
          const now = data.now;
          resolve({
            icon: WEATHER_ICON_MAP[parseInt(now.icon)] || '🌤️',
            temp: `${now.temp}℃`,
            desc: now.text || '',
            humidity: now.humidity || '--',
            windDir: now.windDir || '',
            city: ''
          });
        },
        fail: (err) => reject(err)
      });
    });
  }

  _defaultWeather() {
    return {
      icon: '🌤️',
      temp: '--',
      desc: '天气获取失败',
      humidity: '--',
      windDir: '',
      city: ''
    };
  }
}

module.exports = new WeatherService();
