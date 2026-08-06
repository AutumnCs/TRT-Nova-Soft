export function createAdminAuth() {
  return {
    async authenticate(event = {}) {
      const headers = event.headers || {};
      const authorization = headers.authorization || headers.Authorization;

      if (!authorization) {
        return { ok: false };
      }

      return {
        ok: true,
        admin: {
          role: 'admin'
        }
      };
    }
  };
}
