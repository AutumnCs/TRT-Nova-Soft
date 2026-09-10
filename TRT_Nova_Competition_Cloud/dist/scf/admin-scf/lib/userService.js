export function createUserService({ repository } = {}) {
  return {
    async listUsers(options = {}) {
      const users = await repository?.listUsers?.(options) || [];
      return { success: true, users };
    }
  };
}
