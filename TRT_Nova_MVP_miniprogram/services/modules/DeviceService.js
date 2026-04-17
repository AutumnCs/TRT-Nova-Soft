const ScfApiAdapter = require('../core/ScfApiAdapter');

/**
 * DeviceService
 * Device access via SCF API.
 * Pages should not call transport layers directly.
 */
class DeviceService {
  constructor() {
    this.scfApiAdapter = new ScfApiAdapter();
  }

  async getDeviceData(options = {}) {
    const { withHistory = false, historyLimit = 50, logicalKey = '' } = options;

    return this.scfApiAdapter.getDeviceData({
      withHistory,
      historyLimit,
      logicalKey
    });
  }

  async bindDevice(deviceCode) {
    const code = typeof deviceCode === 'string' ? deviceCode.trim() : '';
    if (!code) {
      return { success: false, msg: 'deviceCode is required' };
    }

    return this.scfApiAdapter.bindDevice({ deviceCode: code });
  }

  async bindDeviceWithProfile(payload = {}) {
    const code = typeof payload.deviceCode === 'string' ? payload.deviceCode.trim() : '';
    if (!code) {
      return { success: false, msg: 'deviceCode is required' };
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
      return { success: false, msg: 'logicalKey is required' };
    }

    return this.scfApiAdapter.unbindDevice({ logicalKey: key });
  }

  async sendDeviceCmd(logicalKey, cmdOrParams) {
    const key = typeof logicalKey === 'string' ? logicalKey.trim() : '';
    if (!key) {
      return { success: false, msg: 'logicalKey is required' };
    }

    if (cmdOrParams && typeof cmdOrParams === 'object' && !Array.isArray(cmdOrParams)) {
      return this.scfApiAdapter.sendDeviceCmd({
        logicalKey: key,
        params: cmdOrParams
      });
    }

    const command = typeof cmdOrParams === 'string' ? cmdOrParams.trim() : '';
    if (!command) {
      return { success: false, msg: 'params object or cmd JSON string is required' };
    }

    return this.scfApiAdapter.sendDeviceCmd({
      logicalKey: key,
      cmd: command
    });
  }

  async updateBoundDeviceInfo(payload = {}) {
    const key = typeof payload.logicalKey === 'string' ? payload.logicalKey.trim() : '';
    if (!key) {
      return { success: false, msg: 'logicalKey is required' };
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
