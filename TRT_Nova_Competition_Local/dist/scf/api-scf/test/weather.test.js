const test = require('node:test');
const assert = require('node:assert/strict');
const {
  WEATHER_CACHE_MS,
  clearWeatherPreferenceForUser,
  getWeatherSummaryForUser,
  normalizeLocationPreference,
  normalizeSearchInput,
  saveWeatherPreferenceForUser,
  searchWeatherCities
} = require('../lib/weather');

const preferenceRow = {
  location_id: '101010100',
  city_name: '北京',
  adm1: '北京市',
  adm2: '北京',
  location_source: 'manual',
  updated_at: '2026-08-27 20:00:00'
};

const weatherPayload = {
  conditionCode: '102',
  conditionText: '少云',
  temperature: 31.71,
  temperatureUnit: '°C',
  feelsLike: 33.64,
  humidity: 69,
  windCompass: 'sw',
  windScale: 3,
  attributionUrls: ['https://developer.qweather.com/attribution.html']
};

test('城市偏好只保存 LocationID、城市、行政区和来源', () => {
  assert.deepEqual(normalizeLocationPreference({
    locationId: '101010100', city: '北京', adm1: '北京市', adm2: '北京', source: 'location',
    latitude: 39.90499, longitude: 116.40529
  }), {
    ok: true,
    value: {
      locationId: '101010100', city: '北京', adm1: '北京市', adm2: '北京', source: 'location'
    }
  });
  assert.equal(normalizeLocationPreference({ city: '北京' }).ok, false);
});
test('定位坐标在发送给 GeoAPI 前缩减到两位小数', () => {
  assert.deepEqual(normalizeSearchInput({ latitude: 39.90499, longitude: 116.40529 }), {
    ok: true,
    query: '116.41,39.90',
    source: 'location'
  });
});

test('未设置城市时不生成默认天气', async () => {
  const db = { execute: async () => [[]] };
  const result = await getWeatherSummaryForUser(db, 'user-a', { nowMs: 1_000 });
  assert.equal(result.success, true);
  assert.equal(result.preference, null);
  assert.equal(result.weather.available, false);
  assert.equal(result.weather.reason, 'location_required');
});

test('30 分钟内直接复用真实缓存且不调用上游', async () => {
  let call = 0;
  const db = {
    execute: async () => {
      call += 1;
      if (call === 1) return [[preferenceRow]];
      return [[{
        payload_json: weatherPayload,
        fetched_at_ms: 10_000,
        expires_at_ms: 10_000 + WEATHER_CACHE_MS
      }]];
    }
  };
  const client = {
    config: { ready: true },
    resolveCity: async () => assert.fail('fresh cache must not call QWeather')
  };
  const result = await getWeatherSummaryForUser(db, 'user-a', { nowMs: 20_000, client });
  assert.equal(result.weather.available, true);
  assert.equal(result.weather.isStale, false);
  assert.equal(result.weather.source.name, '和风天气');
  assert.equal(result.weather.windDirection, '西南风');
});

test('刷新失败时只回退到同一城市的上次真实数据', async () => {
  let call = 0;
  const db = {
    execute: async () => {
      call += 1;
      if (call === 1) return [[preferenceRow]];
      return [[{ payload_json: JSON.stringify(weatherPayload), fetched_at_ms: 10_000, expires_at_ms: 20_000 }]];
    }
  };
  const client = {
    config: { ready: true },
    resolveCity: async () => { throw new Error('network down'); }
  };
  const result = await getWeatherSummaryForUser(db, 'user-a', { nowMs: 30_000, client });
  assert.equal(result.weather.available, true);
  assert.equal(result.weather.isStale, true);
  assert.match(result.weather.msg, /上次真实数据/);
  assert.equal(result.weather.temperature, 31.71);
});

test('无凭据且无历史缓存时明确不可用', async () => {
  let call = 0;
  const db = {
    execute: async () => {
      call += 1;
      return call === 1 ? [[preferenceRow]] : [[]];
    }
  };
  const result = await getWeatherSummaryForUser(db, 'user-a', {
    nowMs: 30_000,
    client: { config: { ready: false } }
  });
  assert.equal(result.weather.available, false);
  assert.equal(result.weather.reason, 'not_configured');
});

test('成功读取 v1 实时天气后写入 30 分钟缓存', async () => {
  const calls = [];
  const db = {
    execute: async (sql, params) => {
      calls.push({ sql, params });
      if (/FROM user_weather_preferences/.test(sql)) return [[preferenceRow]];
      if (/FROM weather_cache/.test(sql)) return [[]];
      return [{ affectedRows: 1 }];
    }
  };
  const client = {
    config: { ready: true },
    resolveCity: async () => ({ locationId: '101010100', latitude: 39.9, longitude: 116.4 }),
    getCurrentWeather: async () => weatherPayload
  };
  const nowMs = 1_700_000_000_000;
  const result = await getWeatherSummaryForUser(db, 'user-a', { nowMs, client });
  assert.equal(result.weather.available, true);
  assert.equal(result.weather.fetchedAt, new Date(nowMs).toISOString());
  const insert = calls.find((item) => /INSERT INTO weather_cache/.test(item.sql));
  assert.ok(insert);
  assert.equal(insert.params[5], nowMs);
  assert.equal(insert.params[6], nowMs + WEATHER_CACHE_MS);
});

test('城市搜索无凭据、错误城市和成功结果都有明确状态', async () => {
  const missing = await searchWeatherCities({ query: '北京' }, {
    client: { config: { ready: false } }
  });
  assert.equal(missing.code, 'QWEATHER_NOT_CONFIGURED');

  const empty = await searchWeatherCities({ query: '不存在的城市' }, {
    client: { config: { ready: true }, searchCities: async () => [] }
  });
  assert.equal(empty.success, true);
  assert.deepEqual(empty.cities, []);

  const found = await searchWeatherCities({ query: '北京' }, {
    client: {
      config: { ready: true },
      searchCities: async () => [{
        locationId: '101010100', city: '北京', adm1: '北京市', adm2: '北京', country: '中国'
      }]
    }
  });
  assert.equal(found.success, true);
  assert.equal(found.cities[0].locationId, '101010100');
});

test('保存和清除城市偏好只作用于当前 openid', async () => {
  const calls = [];
  const db = { execute: async (sql, params) => { calls.push({ sql, params }); return [{ affectedRows: 1 }]; } };
  const saved = await saveWeatherPreferenceForUser(db, 'user-a', {
    locationId: '101010100', city: '北京', adm1: '北京市', adm2: '北京'
  });
  assert.equal(saved.success, true);
  assert.equal(calls[0].params[0], 'user-a');
  await clearWeatherPreferenceForUser(db, 'user-a');
  assert.match(calls[1].sql, /DELETE FROM user_weather_preferences/);
  assert.deepEqual(calls[1].params, ['user-a']);
});
