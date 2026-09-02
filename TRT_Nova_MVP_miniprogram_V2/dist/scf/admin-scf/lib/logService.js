export function createLogService({ repository } = {}) {
  return {
    async listLogs(options = {}) {
      const logs = await repository?.listLogs?.(options) || [];
      return { success: true, logs };
    }
  };
}
