/**
 * DeviceService
 * Unifies all device-related cloud function calls.
 * Pages should not call wx.cloud.callFunction directly for device flow.
 */
class DeviceService {
  async getDeviceData(options = {}) {
    const { withHistory = false, historyLimit = 50 } = options;
    const res = await wx.cloud.callFunction({
      name: 'getDeviceData',
      data: { withHistory, historyLimit }
    });
    return res?.result || {};
  }

  async bindDevice(deviceCode) {
    const code = typeof deviceCode === 'string' ? deviceCode.trim() : '';
    if (!code) {
      return { success: false, msg: 'deviceCode is required' };
    }
    const res = await wx.cloud.callFunction({
      name: 'bindDevice',
      data: { deviceCode: code }
    });
    return res?.result || {};
  }

  async unbindDevice(logicalKey) {
    const key = typeof logicalKey === 'string' ? logicalKey.trim() : '';
    if (!key) {
      return { success: false, msg: 'logicalKey is required' };
    }
    const res = await wx.cloud.callFunction({
      name: 'unbindDevice',
      data: { logicalKey: key }
    });
    return res?.result || {};
  }

  async sendDeviceCmd(logicalKey, cmd) {
    const key = typeof logicalKey === 'string' ? logicalKey.trim() : '';
    const command = typeof cmd === 'string' ? cmd.trim() : '';
    if (!key || !command) {
      return { success: false, msg: 'logicalKey and cmd are required' };
    }
    const res = await wx.cloud.callFunction({
      name: 'sendDeviceCmd',
      data: { logicalKey: key, cmd: command }
    });
    return res?.result || {};
  }

  async listRegistry() {
    const res = await wx.cloud.callFunction({
      name: 'registerDevice',
      data: { action: 'list' }
    });
    return res?.result || {};
  }

  async upsertRegistry(payload = {}) {
    const res = await wx.cloud.callFunction({
      name: 'registerDevice',
      data: {
        action: 'upsert',
        physicalCode: payload.physicalCode || '',
        productId: payload.productId || '',
        deviceName: payload.deviceName || '',
        externalDeviceId: payload.externalDeviceId || '',
        alias: payload.alias || '',
        adminKey: payload.adminKey || ''
      }
    });
    return res?.result || {};
  }
}

module.exports = new DeviceService();
