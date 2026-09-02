export function createDeviceService({ repository } = {}) {
  return {
    async listDevices(options = {}) {
      const devices = await repository?.listDevices?.(options) || [];
      return { success: true, devices };
    },
    async getSummary(options = {}) {
      const devices = await repository?.listDevices?.(options) || [];
      return {
        total: devices.length,
        online: devices.filter((item) => String(item.status).toLowerCase() === 'online').length,
        abnormal: devices.filter((item) => ['abnormal', 'offline'].includes(String(item.status).toLowerCase())).length
      };
    }
  };
}
