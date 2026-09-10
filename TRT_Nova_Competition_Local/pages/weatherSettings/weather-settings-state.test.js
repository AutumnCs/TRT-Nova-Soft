const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildCityLabel,
  decorateCityResults,
  roundCoordinates
} = require('./weather-settings-state');

test('定位坐标在离开小程序前缩减到两位小数', () => {
  assert.deepEqual(roundCoordinates(39.90499, 116.40529), {
    latitude: 39.9,
    longitude: 116.41
  });
  assert.equal(roundCoordinates(200, 116), null);
});
test('城市标签去除重复行政区名称', () => {
  assert.equal(buildCityLabel({ city: '北京', adm2: '北京', adm1: '北京市' }), '北京 · 北京市');
  assert.equal(decorateCityResults([{ city: '朝阳', adm2: '北京', adm1: '北京市', country: '中国' }])[0].meta, '北京 · 北京市 · 中国');
});
