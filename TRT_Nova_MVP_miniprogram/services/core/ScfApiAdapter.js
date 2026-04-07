const { resolveRuntimeConfig } = require('../config/runtime');
const authService = require('../modules/AuthService');

function normalizeResponseBody(body) {
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch (err) {
      return { raw: body };
    }
  }

  return body && typeof body === 'object' ? body : {};
}

class ScfApiAdapter {
  async request(path, method = 'POST', data = {}) {
    const config = resolveRuntimeConfig();
    const baseUrl = (config.scfApiBaseUrl || '').trim().replace(/\/+$/, '');

    if (!baseUrl) {
      throw new Error('scfApiBaseUrl is not configured');
    }

    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const url = `${baseUrl}${cleanPath}`;

    const accessToken = authService.getToken();

    return new Promise((resolve, reject) => {
      wx.request({
        url,
        method,
        data,
        timeout: Number(config.scfRequestTimeoutMs) || 8000,
        header: {
          'content-type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
        },
        success: (res) => {
          const body = normalizeResponseBody(res.data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(body);
            return;
          }

          const msg = body?.message || body?.msg || `HTTP ${res.statusCode}`;
          reject(new Error(msg));
        },
        fail: (err) => reject(err)
      });
    });
  }

  async login() {
    return authService.loginWithScf();
  }

  async healthCheck() {
    return this.request('/health', 'GET');
  }

  async getDeviceData(options = {}) {
    const {
      withHistory = false,
      historyLimit = 50,
      logicalKey = ''
    } = options;

    const latestRes = await this.request('/device/latest', 'POST', {
      logicalKey
    });

    const result = {
      success: latestRes?.success !== false,
      deviceData: latestRes?.deviceData || latestRes?.data || []
    };

    if (!withHistory) {
      return result;
    }

    const historyRes = await this.request('/device/history', 'POST', {
      logicalKey,
      limit: historyLimit
    });

    result.success = result.success && historyRes?.success !== false;
    result.historyData = historyRes?.historyData || historyRes?.data || [];
    return result;
  }

  async bindDevice(payload = {}) {
    return this.request('/device/bind', 'POST', payload);
  }

  async unbindDevice(payload = {}) {
    return this.request('/device/unbind', 'POST', payload);
  }

  async updateBoundDeviceInfo(payload = {}) {
    return this.request('/device/profile', 'POST', payload);
  }

  async sendDeviceCmd(payload = {}) {
    return this.request('/device/cmd', 'POST', payload);
  }

  async getUserProfile() {
    return this.request('/user/profile', 'GET');
  }

  async saveUserProfile(payload = {}) {
    return this.request('/user/profile', 'POST', payload);
  }

  async getPlantLibrary() {
    return this.request('/plant/library', 'GET');
  }

  async togglePlantFavorite(plantId) {
    return this.request('/plant/favorite/toggle', 'POST', { plantId });
  }

  async getTodos(logicalKey = '') {
    return this.request('/todo/list', 'POST', {
      logicalKey
    });
  }

  async getGlobalTodos() {
    return this.request('/todo/global', 'POST', {});
  }

  async addTodo(payload = {}) {
    return this.request('/todo/add', 'POST', payload);
  }

  async completeTodo(payload = {}) {
    return this.request('/todo/complete', 'POST', payload);
  }

  async toggleTodoUrgency(payload = {}) {
    return this.request('/todo/toggle-urgent', 'POST', payload);
  }
}

module.exports = ScfApiAdapter;
