const { resolveRuntimeConfig } = require('../config/runtime');

const TOKEN_STORAGE_KEY = 'apiAccessToken';
const TOKEN_META_STORAGE_KEY = 'apiAccessTokenMeta';

function normalizeUserMessage(message) {
  const text = typeof message === 'string' ? message.trim() : '';
  const map = {
    'authScfBaseUrl is not configured': '服务地址未配置',
    'wx.login failed': '微信登录失败，请重试',
    'auth login failed': '登录失败，请重试',
    'Route not found': '接口不存在',
    'code is required': '登录参数缺失',
    'HTTP 404': '请求地址不存在',
    'HTTP 500': '服务器开小差了，请稍后重试'
  };
  return map[text] || text;
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

class AuthService {
  getToken() {
    return wx.getStorageSync(TOKEN_STORAGE_KEY) || '';
  }

  getTokenMeta() {
    return wx.getStorageSync(TOKEN_META_STORAGE_KEY) || {};
  }

  saveToken(payload = {}) {
    const accessToken = payload.accessToken || payload.token || '';
    if (!accessToken) {
      throw new Error('登录凭证缺失');
    }

    const meta = {
      accessToken,
      expiresIn: payload.expiresIn || '',
      expiresAt: payload.expiresAt || '',
      openid: payload.openid || '',
      loginTime: Date.now()
    };

    wx.setStorageSync(TOKEN_STORAGE_KEY, accessToken);
    wx.setStorageSync(TOKEN_META_STORAGE_KEY, meta);
    return meta;
  }

  clearToken() {
    wx.removeStorageSync(TOKEN_STORAGE_KEY);
    wx.removeStorageSync(TOKEN_META_STORAGE_KEY);
  }

  async loginWithScf() {
    const config = resolveRuntimeConfig();
    const baseUrl = (config.authScfBaseUrl || config.scfApiBaseUrl || '')
      .trim()
      .replace(/\/+$/, '');

    if (!baseUrl) {
      throw new Error('服务地址未配置');
    }

    const loginRes = await wx.login();
    if (!loginRes?.code) {
      throw new Error('微信登录失败，请重试');
    }

    const url = `${baseUrl}/auth/login`;
    const result = await new Promise((resolve, reject) => {
      wx.request({
        url,
        method: 'POST',
        timeout: Number(config.scfRequestTimeoutMs) || 8000,
        header: {
          'content-type': 'application/json'
        },
        data: {
          code: loginRes.code
        },
        success: (res) => {
          const body = normalizeResponseBody(res.data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(body);
            return;
          }

          reject(new Error(normalizeUserMessage(body?.msg || body?.message || `HTTP ${res.statusCode}`)));
        },
        fail: reject
      });
    });

    if (result?.success === false) {
      throw new Error(normalizeUserMessage(result.msg || 'auth login failed'));
    }

    return this.saveToken(result);
  }
}

module.exports = new AuthService();
