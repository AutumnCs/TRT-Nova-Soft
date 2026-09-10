const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildLoadingWeatherCard,
  buildWeatherCardState,
  formatShanghaiTime
} = require('./weather-card-state');

test('天气卡时间固定按 Asia/Shanghai 展示', () => {
  assert.equal(formatShanghaiTime('2026-08-27T10:23:00.000Z'), '08月27日 18:23');
});
test('未设置城市的加载态不伪造天气值', () => {
  const state = buildLoadingWeatherCard();
  assert.equal(state.loading, true);
  assert.equal(state.available, false);
  assert.equal(state.temp, '--');
  assert.equal(state.cityLabel, '未设置城市');
});

test('真实天气卡保留城市、陈旧状态、来源和更新时间', () => {
  const state = buildWeatherCardState({
    available: true,
    isStale: true,
    preference: { city: '北京', adm2: '北京', adm1: '北京市' },
    icon: '🌤️',
    temp: '32°',
    desc: '少云',
    humidity: '69%',
    wind: '西南风 3级',
    fetchedAt: '2026-08-27T10:23:00.000Z',
    sourceName: '和风天气'
  });
  assert.equal(state.cityLabel, '北京 · 北京市');
  assert.equal(state.isStale, true);
  assert.equal(state.updatedLabel, '08月27日 18:23');
  assert.equal(state.sourceName, '和风天气');
});
