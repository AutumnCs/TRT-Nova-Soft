const test = require('node:test');
const assert = require('node:assert/strict');
const {
  WeatherService,
  normalizeWeatherSummary
} = require('./WeatherService');

test('未设置城市或无真实数据时不生成默认天气', () => {
  assert.deepEqual(normalizeWeatherSummary({
    success: true,
    preference: null,
    weather: { available: false, reason: 'location_required', msg: '请先设置天气城市' }
  }), {
    available: false,
    loading: false,
    isStale: false,
    reason: 'location_required',
    msg: '请先设置天气城市',
    preference: null,
    icon: '○',
    temp: '--',
    desc: '',
    humidity: '--',
    wind: '',
    fetchedAt: '',
    sourceName: ''
  });
});
test('真实天气保留陈旧标识、来源和更新时间', () => {
  const summary = normalizeWeatherSummary({
    success: true,
    preference: { locationId: '101010100', city: '北京' },
    weather: {
      available: true,
      isStale: true,
      msg: '天气刷新失败，正在显示上次真实数据',
      conditionCode: '102',
      conditionText: '少云',
      temperature: 31.7,
      humidity: 69,
      windDirection: '西南风',
      windScale: 3,
      fetchedAt: '2026-08-27T10:00:00.000Z',
      source: { name: '和风天气', attributionUrls: ['https://developer.qweather.com/attribution.html'] }
    }
  });
  assert.equal(summary.icon, '🌤️');
  assert.equal(summary.temp, '32°');
  assert.equal(summary.humidity, '69%');
  assert.equal(summary.wind, '西南风 3级');
  assert.equal(summary.isStale, true);
  assert.equal(summary.sourceName, '和风天气');
});

test('WeatherService 只通过 SCF adapter 搜索与保存城市', async () => {
  const calls = [];
  const service = new WeatherService({
    searchWeatherCities: async (payload) => {
      calls.push(['search', payload]);
      return { success: true, cities: [{ locationId: '101010100', city: '北京' }] };
    },
    saveWeatherPreference: async (payload) => {
      calls.push(['save', payload]);
      return { success: true, preference: payload };
    }
  });
  const cities = await service.searchCities({ query: '北京' });
  await service.savePreference(cities[0], 'manual');
  assert.deepEqual(calls, [
    ['search', { query: '北京' }],
    ['save', { locationId: '101010100', city: '北京', source: 'manual' }]
  ]);
});
