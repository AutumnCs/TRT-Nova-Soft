const authService = require('../../services/modules/AuthService');
const weatherService = require('../../services/modules/WeatherService');
const { getTokenOpenid } = require('../../services/modules/auth-session-state');
const {
  buildCityLabel,
  decorateCityResults,
  roundCoordinates
} = require('./weather-settings-state');

Page({
  data: {
    currentPreference: null,
    currentCityLabel: '尚未设置',
    query: '',
    searching: false,
    searchError: '',
    results: [],
    resultSource: 'manual',
    savingIndex: -1,
    locating: false
  },

  onShow() {
    this.loadCurrentPreference();
  },

  onUnload() {
    this._preferenceRequestId = (this._preferenceRequestId || 0) + 1;
  },

  async loadCurrentPreference() {
    const expectedOpenid = getTokenOpenid(authService.getTokenMeta());
    const requestId = (this._preferenceRequestId || 0) + 1;
    this._preferenceRequestId = requestId;
    try {
      const summary = await weatherService.getCurrentWeather();
      if (
        this._preferenceRequestId !== requestId ||
        getTokenOpenid(authService.getTokenMeta()) !== expectedOpenid
      ) return;
      const preference = summary.preference || null;
      this.setData({
        currentPreference: preference,
        currentCityLabel: preference ? buildCityLabel(preference) : '尚未设置'
      });
    } catch (err) {
      if (
        this._preferenceRequestId !== requestId ||
        getTokenOpenid(authService.getTokenMeta()) !== expectedOpenid
      ) return;
      this.setData({ currentPreference: null, currentCityLabel: '暂时无法读取' });
    }
  },

  onQueryInput(e) {
    this.setData({ query: String(e.detail.value || ''), searchError: '' });
  },

  submitSearch() {
    const query = this.data.query.trim();
    if (!query) {
      wx.showToast({ title: '请输入城市名称', icon: 'none' });
      return;
    }
    return this.searchCities({ query }, 'manual');
  },

  async searchCities(payload, source) {
    if (this.data.searching) return;
    this.setData({ searching: true, searchError: '', results: [], resultSource: source });
    try {
      const cities = await weatherService.searchCities(payload);
      this.setData({
        results: decorateCityResults(cities),
        searchError: cities.length ? '' : '没有找到匹配城市，请换一个名称重试'
      });
    } catch (err) {
      this.setData({ searchError: err.message || '城市搜索暂不可用' });
    } finally {
      this.setData({ searching: false, locating: false });
    }
  },

  useCurrentLocation() {
    if (this.data.locating || this.data.searching) return;
    this.setData({ locating: true, searchError: '', results: [] });
    wx.getLocation({
      type: 'wgs84',
      success: (result) => {
        const coordinates = roundCoordinates(result.latitude, result.longitude);
        if (!coordinates) {
          this.setData({ locating: false, searchError: '当前位置无法解析，请手动搜索城市' });
          return;
        }
        this.searchCities(coordinates, 'location');
      },
      fail: () => {
        this.setData({
          locating: false,
          searchError: '未获得定位授权；你仍可在上方手动搜索城市'
        });
      }
    });
  },

  async chooseCity(e) {
    const index = Number(e.currentTarget.dataset.index);
    const city = this.data.results[index];
    if (!city || this.data.savingIndex >= 0) return;
    const expectedOpenid = getTokenOpenid(authService.getTokenMeta());
    this.setData({ savingIndex: index });
    try {
      const preference = await weatherService.savePreference(city, this.data.resultSource);
      if (getTokenOpenid(authService.getTokenMeta()) !== expectedOpenid) return;
      this.setData({
        currentPreference: preference,
        currentCityLabel: buildCityLabel(preference)
      });
      wx.showToast({ title: '天气城市已保存', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 350);
    } catch (err) {
      wx.showToast({ title: err.message || '城市保存失败', icon: 'none' });
    } finally {
      this.setData({ savingIndex: -1 });
    }
  },

  clearCity() {
    if (!this.data.currentPreference) return;
    const expectedOpenid = getTokenOpenid(authService.getTokenMeta());
    wx.showModal({
      title: '清除天气城市？',
      content: '首页将不再显示天气数值，但确定性节气提示仍会保留。',
      confirmText: '确认清除',
      success: async (result) => {
        if (!result.confirm) return;
        if (getTokenOpenid(authService.getTokenMeta()) !== expectedOpenid) {
          this.loadCurrentPreference();
          return;
        }
        try {
          await weatherService.clearPreference();
          if (getTokenOpenid(authService.getTokenMeta()) !== expectedOpenid) return;
          this.setData({ currentPreference: null, currentCityLabel: '尚未设置' });
          wx.showToast({ title: '城市已清除', icon: 'success' });
        } catch (err) {
          wx.showToast({ title: err.message || '清除失败', icon: 'none' });
        }
      }
    });
  }
});
