const { resolveRuntimeConfig } = require('../config/runtime');
const authService = require('../modules/AuthService');

const MESSAGE_MAP = {
  'deviceCode is required': '请输入设备码',
  'logicalKey is required': '设备标识缺失',
  'Device code not found or inactive': '设备码不存在或设备未激活',
  'Already bound': '该设备已绑定到当前账号',
  'Device already bound by another user': '该设备已被其他账号绑定',
  'Binding successful': '绑定成功',
  'Binding record not found': '未找到绑定记录',
  'Unbind failed: record may have already been modified': '解绑失败，请稍后重试',
  'Unbind successful': '解绑成功',
  'Profile updated': '保存成功',
  'Permission denied for this device': '你没有该设备的操作权限',
  'Device not found': '未找到设备',
  'Device missing productId or deviceName': '设备信息不完整',
  'cmd JSON must be an object, e.g. {"run_state": true}': '指令格式不正确，请输入 JSON 对象',
  'Use params object or cmd JSON string, e.g. {"run_state": true}': '请输入正确的控制参数',
  'params must be an object, e.g. { "run_state": true }': '控制参数格式不正确',
  'Missing openid or bearer token': '登录状态已失效，请重新登录',
  'Invalid token format': '登录状态异常，请重新登录',
  'Invalid token signature': '登录状态异常，请重新登录',
  'Token expired': '登录已过期，请重新登录',
  'Route not found': '接口不存在',
  'code is required': '登录参数缺失',
  'auth login failed': '登录失败，请重试',
  'scfApiBaseUrl is not configured': '服务地址未配置',
  'HTTP 404': '请求地址不存在',
  'HTTP 500': '服务器开小差了，请稍后重试'
};

function normalizeUserMessage(message) {
  const text = typeof message === 'string' ? message.trim() : '';
  if (!text) return '';
  return MESSAGE_MAP[text] || text;
}

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

function normalizeResponsePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }

  return {
    ...payload,
    ...(typeof payload.msg === 'string' ? { msg: normalizeUserMessage(payload.msg) } : {}),
    ...(typeof payload.message === 'string' ? { message: normalizeUserMessage(payload.message) } : {})
  };
}

function isNetworkError(err) {
  const message = String(err?.errMsg || err?.message || '').toLowerCase();
  if (!message) return false;
  return (
    message.includes('request:fail') ||
    message.includes('timeout') ||
    message.includes('failed to fetch') ||
    message.includes('network') ||
    message.includes('internetdisconnected')
  );
}

function isAuthErrorMessage(message) {
  const text = typeof message === 'string' ? message.trim() : '';
  return (
    text === '登录已过期，请重新登录' ||
    text === '登录状态已失效，请重新登录' ||
    text === '登录状态异常，请重新登录'
  );
}

class ScfApiAdapter {
  async request(path, method = 'POST', data = {}) {
    const config = resolveRuntimeConfig();
    const requestData =
      data && typeof data === 'object' && !Array.isArray(data)
        ? { ...data }
        : data;
    const overrideBaseUrl =
      requestData && typeof requestData === 'object'
        ? String(requestData.__baseUrl || '').trim()
        : '';
    if (requestData && typeof requestData === 'object' && Object.prototype.hasOwnProperty.call(requestData, '__baseUrl')) {
      delete requestData.__baseUrl;
    }

    const baseUrl = (overrideBaseUrl || config.scfApiBaseUrl || '').trim().replace(/\/+$/, '');

    if (!baseUrl) {
      throw new Error('scfApiBaseUrl is not configured');
    }

    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const url = `${baseUrl}${cleanPath}`;

    const accessToken = authService.getToken();

    const doRequest = (retryCount = 0) => new Promise((resolve, reject) => {
      wx.request({
        url,
        method,
        data: requestData,
        timeout: Math.max(Number(config.scfRequestTimeoutMs) || 0, 15000),
        header: {
          'content-type': 'application/json',
          ...(accessToken ? { 'x-access-token': accessToken } : {})
        },
        success: (res) => {
          const body = normalizeResponsePayload(normalizeResponseBody(res.data));
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(body);
            return;
          }

          const msg = normalizeUserMessage(body?.message || body?.msg || `HTTP ${res.statusCode}`);
          if (isAuthErrorMessage(msg)) {
            getApp()?.handleAuthExpired?.();
          }
          reject(new Error(msg));
        },
        fail: (err) => {
          if (retryCount < 1 && isNetworkError(err)) {
            resolve(doRequest(retryCount + 1));
            return;
          }
          reject(err);
        }
      });
    });

    return doRequest();
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
      logicalKey = '',
      historyGranularity = '5m',
      historyRange = '24h',
      historyParamKey = ''
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
      limit: historyLimit,
      granularity: historyGranularity,
      range: historyRange,
      paramKey: historyParamKey
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

  async getJournalMonth(payload = {}) {
    return this.request('/journal/month', 'POST', payload);
  }

  async getJournalDay(payload = {}) {
    return this.request('/journal/day', 'POST', payload);
  }

  async addJournalRecord(payload = {}) {
    return this.request('/journal/add', 'POST', payload);
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

  async chatWithAgent(payload = {}) {
    return this.request('/agent/chat', 'POST', payload);
  }
}

module.exports = ScfApiAdapter;
