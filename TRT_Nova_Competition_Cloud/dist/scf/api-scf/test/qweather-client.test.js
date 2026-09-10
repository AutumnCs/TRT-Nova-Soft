const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const {
  createQWeatherClient,
  createQWeatherJwt,
  normalizeApiHost,
  normalizeCurrentWeather,
  readQWeatherConfig,
  requestJsonOverHttps
} = require('../lib/qweather-client');

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='), 'base64');
}

test('QWeather 配置只接受专属 HTTPS Host 且默认关闭', () => {
  assert.equal(normalizeApiHost('abc123.def.qweatherapi.com'), 'abc123.def.qweatherapi.com');
  assert.throws(() => normalizeApiHost('https://abc123.def.qweatherapi.com/path'), /不能包含路径/);
  const config = readQWeatherConfig({});
  assert.equal(config.ready, false);
  assert.equal(config.enabled, false);
});

test('QWeather JWT 只携带 EdDSA kid、sub、iat、exp 并可验签', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const privatePem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  const token = createQWeatherJwt({
    projectId: 'PROJECT123',
    credentialId: 'CREDENTIAL456',
    privateKey: privatePem
  }, 1_700_000_000_000);
  const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
  const header = JSON.parse(decodeBase64Url(encodedHeader).toString('utf8'));
  const payload = JSON.parse(decodeBase64Url(encodedPayload).toString('utf8'));
  assert.deepEqual(header, { alg: 'EdDSA', kid: 'CREDENTIAL456' });
  assert.deepEqual(payload, {
    sub: 'PROJECT123',
    iat: 1_699_999_970,
    exp: 1_700_000_600
  });
  assert.equal(
    crypto.verify(
      null,
      Buffer.from(`${encodedHeader}.${encodedPayload}`),
      publicKey,
      decodeBase64Url(encodedSignature)
    ),
    true
  );
});

test('QWeather 城市搜索使用 GeoAPI 并保留 LocationID 与行政区', async () => {
  const calls = [];
  const client = createQWeatherClient({
    config: {
      ready: true,
      apiHost: 'abc.def.qweatherapi.com',
      projectId: 'project',
      credentialId: 'credential',
      privateKey: crypto.generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
      timeoutMs: 5000
    },
    requestJson: async (request) => {
      calls.push(request);
      return {
        code: '200',
        location: [{
          id: '101010100', name: '北京', adm1: '北京市', adm2: '北京',
          country: '中国', lat: '39.90499', lon: '116.40529'
        }]
      };
    },
    now: () => 1_700_000_000_000
  });
  const cities = await client.searchCities('北京');
  assert.equal(cities.length, 1);
  assert.equal(cities[0].locationId, '101010100');
  assert.equal(cities[0].adm1, '北京市');
  assert.match(calls[0].path, /^\/geo\/v2\/city\/lookup\?/);
  assert.match(calls[0].path, /location=%E5%8C%97%E4%BA%AC/);
  assert.match(calls[0].token, /^[^.]+\.[^.]+\.[^.]+$/);
});

test('QWeather v1 实时天气映射为稳定的服务端字段', () => {
  assert.deepEqual(normalizeCurrentWeather({
    metadata: { attributions: ['https://developer.qweather.com/attribution.html'] },
    condition: { text: '少云', code: '102' },
    temperature: { value: 31.71, unit: '°C' },
    feelsLike: { value: 33.64, unit: '°C' },
    humidity: 0.69,
    wind: { direction: { compass: 'sw' }, scale: 3 }
  }), {
    conditionCode: '102',
    conditionText: '少云',
    temperature: 31.71,
    temperatureUnit: '°C',
    feelsLike: 33.64,
    humidity: 69,
    windCompass: 'sw',
    windScale: 3,
    attributionUrls: ['https://developer.qweather.com/attribution.html']
  });
});

test('QWeather v1 缺少天气现象或温度时拒绝写入真实缓存', async () => {
  const client = createQWeatherClient({
    config: {
      ready: true,
      apiHost: 'abc.def.qweatherapi.com',
      projectId: 'project',
      credentialId: 'credential',
      privateKey: crypto.generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
      timeoutMs: 5000
    },
    requestJson: async () => ({ condition: { text: '' }, temperature: {} })
  });
  await assert.rejects(client.getCurrentWeather(39.9, 116.4), /response incomplete/);
});

test('QWeather HTTPS 请求达到超时后明确失败', async () => {
  let configuredTimeout = 0;
  const fakeRequest = new EventEmitter();
  fakeRequest.setTimeout = (milliseconds, callback) => {
    configuredTimeout = milliseconds;
    fakeRequest.timeoutCallback = callback;
  };
  fakeRequest.destroy = (error) => fakeRequest.emit('error', error);
  fakeRequest.end = () => fakeRequest.timeoutCallback();
  const fakeHttps = { request: () => fakeRequest };
  await assert.rejects(
    requestJsonOverHttps({
      apiHost: 'abc.def.qweatherapi.com',
      path: '/weather/v1/current/39.90/116.40',
      token: 'jwt',
      timeoutMs: 3456
    }, { https: fakeHttps }),
    /QWeather request timeout/
  );
  assert.equal(configuredTimeout, 3456);
});
