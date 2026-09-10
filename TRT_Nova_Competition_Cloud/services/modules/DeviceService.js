const ScfApiAdapter = require('../core/ScfApiAdapter');

/**
 * DeviceService
 * Device access via SCF API.
 * Pages should not call transport layers directly.
 */
class DeviceService {
  constructor() {
    this.scfApiAdapter = new ScfApiAdapter();
    this._deviceDetailBootstrapCache = new Map();
    this._latestDeviceListCache = null;
  }

  async getDeviceData(options = {}) {
    const {
      withHistory = false,
      historyLimit = 50,
      logicalKey = '',
      historyGranularity = '5m',
      historyRange = '24h',
      historyParamKey = ''
    } = options;

    const result = await this.scfApiAdapter.getDeviceData({
      withHistory,
      historyLimit,
      logicalKey,
      historyGranularity,
      historyRange,
      historyParamKey
    });

    if (!logicalKey && !withHistory && Array.isArray(result?.deviceData)) {
      this._latestDeviceListCache = {
        data: result.deviceData,
        cachedAt: Date.now()
      };
    }

    return result;
  }

  getCachedDeviceList(maxAgeMs = 60000) {
    if (!this._latestDeviceListCache) return [];
    if (Date.now() - this._latestDeviceListCache.cachedAt > maxAgeMs) return [];
    return Array.isArray(this._latestDeviceListCache.data)
      ? this._latestDeviceListCache.data.slice()
      : [];
  }

  setDeviceDetailBootstrap(logicalKey, payload) {
    const key = typeof logicalKey === 'string' ? logicalKey.trim() : '';
    if (!key || !payload) return;
    this._deviceDetailBootstrapCache.set(key, {
      payload,
      cachedAt: Date.now()
    });
  }

  consumeDeviceDetailBootstrap(logicalKey, maxAgeMs = 15000) {
    const key = typeof logicalKey === 'string' ? logicalKey.trim() : '';
    if (!key) return null;
    const cached = this._deviceDetailBootstrapCache.get(key);
    this._deviceDetailBootstrapCache.delete(key);
    if (!cached) return null;
    if (Date.now() - cached.cachedAt > maxAgeMs) return null;
    return cached.payload || null;
  }

  async bindDevice(deviceCode) {
    const code = typeof deviceCode === 'string' ? deviceCode.trim() : '';
    if (!code) {
      return { success: false, msg: '请输入设备码' };
    }

    return this.scfApiAdapter.bindDevice({ deviceCode: code });
  }

  async bindDeviceWithProfile(payload = {}) {
    const code = typeof payload.deviceCode === 'string' ? payload.deviceCode.trim() : '';
    if (!code) {
      return { success: false, msg: '请输入设备码' };
    }

    const requestPayload = {
      deviceCode: code,
      alias: payload.alias || '',
      location: payload.location || '',
      plantType: payload.plantType || ''
    };

    return this.scfApiAdapter.bindDevice(requestPayload);
  }

  async unbindDevice(logicalKey) {
    const key = typeof logicalKey === 'string' ? logicalKey.trim() : '';
    if (!key) {
      return { success: false, msg: '设备标识缺失' };
    }

    return this.scfApiAdapter.unbindDevice({ logicalKey: key });
  }

  async sendDeviceCmd(logicalKey, cmdOrParams) {
    const key = typeof logicalKey === 'string' ? logicalKey.trim() : '';
    if (!key) {
      return { success: false, msg: '设备标识缺失' };
    }

    if (cmdOrParams && typeof cmdOrParams === 'object' && !Array.isArray(cmdOrParams)) {
      if (typeof cmdOrParams.action === 'string' && cmdOrParams.action.trim()) {
        return this.scfApiAdapter.sendDeviceCmd({
          logicalKey: key,
          action: cmdOrParams.action.trim(),
          args: cmdOrParams.args && typeof cmdOrParams.args === 'object' && !Array.isArray(cmdOrParams.args)
            ? cmdOrParams.args
            : {}
        });
      }

      return this.scfApiAdapter.sendDeviceCmd({
        logicalKey: key,
        params: cmdOrParams
      });
    }

    const command = typeof cmdOrParams === 'string' ? cmdOrParams.trim() : '';
    if (!command) {
      return { success: false, msg: '请输入控制参数' };
    }

    return this.scfApiAdapter.sendDeviceCmd({
      logicalKey: key,
      action: command
    });
  }

  async updateBoundDeviceInfo(payload = {}) {
    const key = typeof payload.logicalKey === 'string' ? payload.logicalKey.trim() : '';
    if (!key) {
      return { success: false, msg: '设备标识缺失' };
    }

    const requestPayload = {
      logicalKey: key,
      alias: payload.alias || '',
      location: payload.location || '',
      plantType: payload.plantType || '',
      plantLibraryId: payload.plantLibraryId || null
    };

    return this.scfApiAdapter.updateBoundDeviceInfo(requestPayload);
  }
}

module.exports = new DeviceService();
