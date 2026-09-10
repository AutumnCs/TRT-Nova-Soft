const crypto = require('crypto');
const https = require('https');
const zlib = require('zlib');

function parseEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function normalizeApiHost(value) {
  const raw = String(value || '').trim().replace(/\/+$/g, '');
  if (!raw) return '';
  const parsed = new URL(/^https:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (parsed.protocol !== 'https:' || parsed.pathname !== '/') {
    throw new Error('QWEATHER_API_HOST 必须是专属 HTTPS Host，不能包含路径');
  }
  return parsed.host;
}

function normalizePrivateKey(value) {
  return String(value || '').trim().replace(/\\n/g, '\n');
}

function readQWeatherConfig(env = process.env) {
  const enabled = parseEnabled(env.QWEATHER_ENABLED);
  let apiHost = '';
  try {
    apiHost = normalizeApiHost(env.QWEATHER_API_HOST);
  } catch (err) {
    apiHost = '';
  }
  const config = {
    enabled,
    apiHost,
    projectId: String(env.QWEATHER_PROJECT_ID || '').trim(),
    credentialId: String(env.QWEATHER_CREDENTIAL_ID || '').trim(),
    privateKey: normalizePrivateKey(env.QWEATHER_PRIVATE_KEY),
    timeoutMs: Math.max(1000, Number(env.QWEATHER_TIMEOUT_MS) || 5000)
  };
  const missing = [];
  if (!config.apiHost) missing.push('QWEATHER_API_HOST');
  if (!config.projectId) missing.push('QWEATHER_PROJECT_ID');
  if (!config.credentialId) missing.push('QWEATHER_CREDENTIAL_ID');
  if (!config.privateKey) missing.push('QWEATHER_PRIVATE_KEY');
  return {
    ...config,
    ready: enabled && missing.length === 0,
    missing
  };
}

function toBase64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function createQWeatherJwt(config, nowMs = Date.now()) {
  if (!config?.projectId || !config?.credentialId || !config?.privateKey) {
    throw new Error('QWeather JWT 配置不完整');
  }
  const now = Math.floor(Number(nowMs) / 1000);
  const header = { alg: 'EdDSA', kid: config.credentialId };
  const payload = { sub: config.projectId, iat: now - 30, exp: now + 600 };
  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.sign(null, Buffer.from(signingInput), config.privateKey);
  return `${signingInput}.${toBase64Url(signature)}`;
}

function decodeResponse(buffer, encoding) {
  if (String(encoding || '').toLowerCase() === 'gzip') {
    return zlib.gunzipSync(buffer).toString('utf8');
  }
  return buffer.toString('utf8');
}

function requestJsonOverHttps({ apiHost, path, token, timeoutMs = 5000 }, options = {}) {
  const url = new URL(`https://${apiHost}${path}`);
  const transport = options.https || https;
  return new Promise((resolve, reject) => {
    const request = transport.request(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Accept-Encoding': 'gzip'
      }
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        try {
          const text = decodeResponse(Buffer.concat(chunks), response.headers['content-encoding']);
          const data = text ? JSON.parse(text) : {};
          if (Number(response.statusCode) < 200 || Number(response.statusCode) >= 300) {
            throw new Error(`QWeather HTTP ${response.statusCode}`);
          }
          resolve(data);
        } catch (err) {
          reject(err);
        }
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error('QWeather request timeout')));
    request.on('error', reject);
    request.end();
  });
}

function normalizeCity(item = {}) {
  return {
    locationId: String(item.id || '').trim(),
    city: String(item.name || '').trim(),
    adm1: String(item.adm1 || '').trim(),
    adm2: String(item.adm2 || '').trim(),
    country: String(item.country || '').trim(),
    latitude: Number(item.lat),
    longitude: Number(item.lon)
  };
}

function toFiniteNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeCurrentWeather(data = {}) {
  const humidity = toFiniteNumber(data.humidity);
  return {
    conditionCode: String(data.condition?.code || '').trim(),
    conditionText: String(data.condition?.text || '').trim(),
    temperature: toFiniteNumber(data.temperature?.value),
    temperatureUnit: String(data.temperature?.unit || '°C'),
    feelsLike: toFiniteNumber(data.feelsLike?.value),
    humidity: humidity === null ? null : Math.round(humidity * 100),
    windCompass: String(data.wind?.direction?.compass || '').trim().toLowerCase(),
    windScale: toFiniteNumber(data.wind?.scale),
    attributionUrls: Array.isArray(data.metadata?.attributions)
      ? data.metadata.attributions.map((item) => String(item || '').trim()).filter(Boolean)
      : []
  };
}

function createQWeatherClient(options = {}) {
  const config = options.config || readQWeatherConfig(options.env || process.env);
  const requestJson = options.requestJson || requestJsonOverHttps;
  const now = options.now || (() => Date.now());

  function assertReady() {
    if (!config.ready) {
      const detail = config.enabled ? `缺少 ${config.missing.join(', ')}` : 'QWEATHER_ENABLED 未开启';
      throw new Error(`和风天气尚未配置：${detail}`);
    }
  }

  async function request(path) {
    assertReady();
    return requestJson({
      apiHost: config.apiHost,
      path,
      token: createQWeatherJwt(config, now()),
      timeoutMs: config.timeoutMs
    });
  }

  return {
    config,

    async searchCities(location) {
      const query = String(location || '').trim();
      if (!query) return [];
      const data = await request(`/geo/v2/city/lookup?location=${encodeURIComponent(query)}&range=cn&number=10&lang=zh`);
      if (String(data.code || '') !== '200') {
        throw new Error(`QWeather city lookup error: ${data.code || 'unknown'}`);
      }
      return (Array.isArray(data.location) ? data.location : [])
        .map(normalizeCity)
        .filter((item) => item.locationId && item.city && Number.isFinite(item.latitude) && Number.isFinite(item.longitude));
    },

    async resolveCity(locationId) {
      const cities = await this.searchCities(locationId);
      return cities.find((item) => item.locationId === String(locationId)) || cities[0] || null;
    },

    async getCurrentWeather(latitude, longitude) {
      const lat = Number(latitude).toFixed(2);
      const lon = Number(longitude).toFixed(2);
      const data = await request(`/weather/v1/current/${lat}/${lon}?localTime=true&lang=zh`);
      const weather = normalizeCurrentWeather(data);
      if (!weather.conditionText || weather.temperature === null) {
        throw new Error('QWeather current weather response incomplete');
      }
      return weather;
    }
  };
}

module.exports = {
  createQWeatherClient,
  createQWeatherJwt,
  normalizeApiHost,
  normalizeCity,
  normalizeCurrentWeather,
  readQWeatherConfig,
  requestJsonOverHttps,
  toBase64Url
};
