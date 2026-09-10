const { createQWeatherClient } = require('./qweather-client');

const WEATHER_CACHE_MS = 30 * 60 * 1000;

const WIND_LABELS = Object.freeze({
  n: '北风', nne: '北东北风', ne: '东北风', ene: '东东北风',
  e: '东风', ese: '东东南风', se: '东南风', sse: '南东南风',
  s: '南风', ssw: '南西南风', sw: '西南风', wsw: '西西南风',
  w: '西风', wnw: '西西北风', nw: '西北风', nnw: '北西北风',
  none: '无持续风向', vrb: '风向不定'
});

function normalizeText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeLocationPreference(input = {}) {
  const locationId = normalizeText(input.locationId, 64);
  const city = normalizeText(input.city, 128);
  const adm1 = normalizeText(input.adm1, 128);
  const adm2 = normalizeText(input.adm2, 128);
  const source = input.source === 'location' ? 'location' : 'manual';
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(locationId)) {
    return { ok: false, msg: '请选择有效城市' };
  }
  if (!city) {
    return { ok: false, msg: '城市名称不能为空' };
  }
  return { ok: true, value: { locationId, city, adm1, adm2, source } };
}

function mapPreferenceRow(row = {}) {
  if (!row.location_id) return null;
  return {
    locationId: String(row.location_id),
    city: row.city_name || '',
    adm1: row.adm1 || '',
    adm2: row.adm2 || '',
    source: row.location_source === 'location' ? 'location' : 'manual',
    updatedAt: row.updated_at || null
  };
}

function parsePayload(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (err) {
    return null;
  }
}

function optionalNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function mapCacheRow(row = {}) {
  const payload = parsePayload(row.payload_json);
  if (!payload) return null;
  return {
    payload,
    fetchedAtMs: Number(row.fetched_at_ms) || 0,
    expiresAtMs: Number(row.expires_at_ms) || 0
  };
}

function buildUnavailableWeather(reason, msg) {
  return {
    available: false,
    isStale: false,
    cacheState: 'none',
    reason,
    msg
  };
}

function buildAvailableWeather(preference, cached, nowMs, options = {}) {
  const payload = cached.payload;
  return {
    available: true,
    isStale: Boolean(options.isStale),
    cacheState: options.isStale ? 'stale' : 'fresh',
    msg: options.msg || '',
    location: {
      locationId: preference.locationId,
      city: preference.city,
      adm1: preference.adm1,
      adm2: preference.adm2
    },
    conditionCode: payload.conditionCode || '',
    conditionText: payload.conditionText || '',
    temperature: optionalNumber(payload.temperature),
    temperatureUnit: payload.temperatureUnit || '°C',
    feelsLike: optionalNumber(payload.feelsLike),
    humidity: optionalNumber(payload.humidity),
    windDirection: WIND_LABELS[payload.windCompass] || '',
    windScale: optionalNumber(payload.windScale),
    fetchedAt: cached.fetchedAtMs ? new Date(cached.fetchedAtMs).toISOString() : '',
    ageMinutes: cached.fetchedAtMs ? Math.max(0, Math.floor((nowMs - cached.fetchedAtMs) / 60000)) : null,
    source: {
      name: '和风天气',
      attributionUrls: Array.isArray(payload.attributionUrls) ? payload.attributionUrls : []
    }
  };
}

async function getPreference(db, openid) {
  const [rows] = await db.execute(
    `SELECT location_id, city_name, adm1, adm2, location_source, updated_at
     FROM user_weather_preferences
     WHERE openid = ?
     LIMIT 1`,
    [openid]
  );
  return rows.length ? mapPreferenceRow(rows[0]) : null;
}

async function saveWeatherPreferenceForUser(db, openid, input = {}) {
  const normalized = normalizeLocationPreference(input);
  if (!normalized.ok) return { success: false, msg: normalized.msg };
  const value = normalized.value;
  await db.execute(
    `INSERT INTO user_weather_preferences
      (openid, location_id, city_name, adm1, adm2, location_source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE
       location_id = VALUES(location_id), city_name = VALUES(city_name),
       adm1 = VALUES(adm1), adm2 = VALUES(adm2), location_source = VALUES(location_source),
       updated_at = CURRENT_TIMESTAMP`,
    [openid, value.locationId, value.city, value.adm1 || null, value.adm2 || null, value.source]
  );
  return { success: true, preference: value };
}

async function clearWeatherPreferenceForUser(db, openid) {
  await db.execute('DELETE FROM user_weather_preferences WHERE openid = ?', [openid]);
  return { success: true };
}

function normalizeSearchInput(input = {}) {
  const query = normalizeText(input.query, 80);
  const latitude = Number(input.latitude);
  const longitude = Number(input.longitude);
  if (query) return { ok: true, query, source: 'manual' };
  if (
    Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
    Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
  ) {
    return {
      ok: true,
      query: `${longitude.toFixed(2)},${latitude.toFixed(2)}`,
      source: 'location'
    };
  }
  return { ok: false, msg: '请输入城市，或主动授权当前位置' };
}

async function searchWeatherCities(input = {}, options = {}) {
  const normalized = normalizeSearchInput(input);
  if (!normalized.ok) return { success: false, cities: [], msg: normalized.msg };
  const client = options.client || createQWeatherClient();
  if (!client.config.ready) {
    return {
      success: false,
      cities: [],
      code: 'QWEATHER_NOT_CONFIGURED',
      msg: '和风天气尚未配置，暂时不能搜索城市'
    };
  }
  try {
    const cities = await client.searchCities(normalized.query);
    return {
      success: true,
      source: normalized.source,
      cities: cities.map((item) => ({
        locationId: item.locationId,
        city: item.city,
        adm1: item.adm1,
        adm2: item.adm2,
        country: item.country
      }))
    };
  } catch (err) {
    return {
      success: false,
      cities: [],
      code: 'QWEATHER_UNAVAILABLE',
      msg: err.message || '城市搜索暂不可用'
    };
  }
}

async function readWeatherCache(db, locationId) {
  const [rows] = await db.execute(
    `SELECT payload_json, fetched_at_ms, expires_at_ms
     FROM weather_cache
     WHERE location_id = ?
     LIMIT 1`,
    [locationId]
  );
  return rows.length ? mapCacheRow(rows[0]) : null;
}

async function writeWeatherCache(db, preference, payload, fetchedAtMs) {
  await db.execute(
    `INSERT INTO weather_cache
      (location_id, city_name, adm1, adm2, payload_json, fetched_at_ms, expires_at_ms, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE
       city_name = VALUES(city_name), adm1 = VALUES(adm1), adm2 = VALUES(adm2),
       payload_json = VALUES(payload_json), fetched_at_ms = VALUES(fetched_at_ms),
       expires_at_ms = VALUES(expires_at_ms), updated_at = CURRENT_TIMESTAMP`,
    [
      preference.locationId,
      preference.city,
      preference.adm1 || null,
      preference.adm2 || null,
      JSON.stringify(payload),
      fetchedAtMs,
      fetchedAtMs + WEATHER_CACHE_MS
    ]
  );
}

async function getWeatherSummaryForUser(db, openid, options = {}) {
  const nowMs = Number(options.nowMs) || Date.now();
  const preference = await getPreference(db, openid);
  if (!preference) {
    return {
      success: true,
      preference: null,
      weather: buildUnavailableWeather('location_required', '请先设置天气城市')
    };
  }

  const cached = await readWeatherCache(db, preference.locationId);
  if (cached && cached.expiresAtMs > nowMs) {
    return {
      success: true,
      preference,
      weather: buildAvailableWeather(preference, cached, nowMs)
    };
  }

  const client = options.client || createQWeatherClient();
  if (!client.config.ready) {
    return {
      success: true,
      preference,
      weather: cached
        ? buildAvailableWeather(preference, cached, nowMs, {
            isStale: true,
            msg: '和风天气尚未配置，正在显示上次真实数据'
          })
        : buildUnavailableWeather('not_configured', '和风天气尚未配置')
    };
  }

  try {
    const city = await client.resolveCity(preference.locationId);
    if (!city) throw new Error('城市 LocationID 无法解析');
    const payload = await client.getCurrentWeather(city.latitude, city.longitude);
    await writeWeatherCache(db, preference, payload, nowMs);
    const nextCache = {
      payload,
      fetchedAtMs: nowMs,
      expiresAtMs: nowMs + WEATHER_CACHE_MS
    };
    return {
      success: true,
      preference,
      weather: buildAvailableWeather(preference, nextCache, nowMs)
    };
  } catch (err) {
    return {
      success: true,
      preference,
      weather: cached
        ? buildAvailableWeather(preference, cached, nowMs, {
            isStale: true,
            msg: '天气刷新失败，正在显示上次真实数据'
          })
        : buildUnavailableWeather('upstream_error', err.message || '天气暂不可用')
    };
  }
}

module.exports = {
  WEATHER_CACHE_MS,
  buildAvailableWeather,
  buildUnavailableWeather,
  clearWeatherPreferenceForUser,
  getWeatherSummaryForUser,
  mapCacheRow,
  mapPreferenceRow,
  normalizeLocationPreference,
  normalizeSearchInput,
  saveWeatherPreferenceForUser,
  searchWeatherCities,
  writeWeatherCache
};
