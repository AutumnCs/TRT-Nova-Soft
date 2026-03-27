const { resolveRuntimeConfig } = require('../config/runtime');

const TOKEN_STORAGE_KEY = 'apiAccessToken';
const TOKEN_META_STORAGE_KEY = 'apiAccessTokenMeta';

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
      throw new Error('accessToken is required');
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
      throw new Error('authScfBaseUrl is not configured');
    }

    const loginRes = await wx.login();
    if (!loginRes?.code) {
      throw new Error('wx.login failed');
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

          reject(new Error(body?.msg || body?.message || `HTTP ${res.statusCode}`));
        },
        fail: reject
      });
    });

    if (result?.success === false) {
      throw new Error(result.msg || 'auth login failed');
    }

    return this.saveToken(result);
  }
}

module.exports = new AuthService();
