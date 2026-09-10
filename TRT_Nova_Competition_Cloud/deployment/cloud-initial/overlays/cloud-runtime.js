'use strict';

const DEVICE_COMMAND_PATH = '/device/cmd';

const REQUIRED_BY_FUNCTION = Object.freeze({
  'auth-scf': [
    'DB_HOST',
    'DB_NAME',
    'DB_USER',
    'DB_PASSWORD',
    'WECHAT_APPID',
    'WECHAT_SECRET',
    'JWT_SECRET'
  ],
  'api-scf': [
    'DB_HOST',
    'DB_NAME',
    'DB_USER',
    'DB_PASSWORD',
    'JWT_SECRET'
  ],
  'ingest-scf': ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'],
  'agent-scf': ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'JWT_SECRET'],
  'history-cleanup-scf': ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']
});

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    },
    body: JSON.stringify(body)
  };
}

function getPath(event = {}) {
  return String(
    event.path ||
    event.requestContext?.path ||
    event.requestContext?.http?.path ||
    ''
  );
}

function getMethod(event = {}) {
  return String(
    event.httpMethod ||
    event.requestContext?.http?.method ||
    event.requestContext?.httpMethod ||
    ''
  ).toUpperCase();
}

function hasPlaceholder(value) {
  const text = String(value || '').trim();
  return !text || /(?:__FILL_|__REQUIRED_|replace-with|<[^>]+>)/i.test(text);
}

function isTrue(value) {
  return /^(?:1|true|yes|on)$/i.test(String(value || '').trim());
}

function validateRuntimeEnvironment(functionName, env = process.env) {
  if (!Object.prototype.hasOwnProperty.call(REQUIRED_BY_FUNCTION, functionName)) {
    return `NOVA_FUNCTION_NAME 无效：${functionName || '(empty)'}`;
  }

  for (const name of REQUIRED_BY_FUNCTION[functionName]) {
    if (hasPlaceholder(env[name])) return `缺少或未替换环境变量：${name}`;
  }

  if (/^(?:localhost\.?|0\.0\.0\.0|127\..*|\[?::1\]?|\[?::ffff:127\..*)$/i.test(String(env.DB_HOST || '').trim())) {
    return '云函数不得连接本机回环地址 DB_HOST';
  }
  if (env.DB_TLS_MODE && !['legacy-direct', 'private-network', 'required'].includes(env.DB_TLS_MODE)) return 'DB_TLS_MODE 必须为 legacy-direct、private-network 或 required';
  if (isTrue(env.LOCAL_DEV_AUTH_ENABLED) || String(env.LOCAL_DEV_OPENID || '').trim() || String(env.DEBUG_OPENID || '').trim()) return '云端禁止本地调试身份';
  for (const key of ['LLM_API_KEY_FILE', 'QWEATHER_PRIVATE_KEY_FILE']) {
    if (String(env[key] || '').trim()) return `云端禁止本地凭据文件：${key}`;
  }
  if (['auth-scf', 'api-scf', 'agent-scf'].includes(functionName) && String(env.JWT_SECRET || '').length < 32) {
    return 'JWT_SECRET 至少需要 32 个字符';
  }
  if (['api-scf', 'agent-scf'].includes(functionName) && isTrue(env.ALLOW_LEGACY_OPENID_FALLBACK)) {
    return '云端候选禁止 ALLOW_LEGACY_OPENID_FALLBACK';
  }
  if (isTrue(env.LOCAL_MEDIA_ENABLED)) return '云端候选禁止 LOCAL_MEDIA_ENABLED';
  if (['api-scf', 'agent-scf', 'history-cleanup-scf'].includes(functionName)) {
    try { require('./cloudbase-storage').storageConfig(env); }
    catch (_) { return '云开发附件必须显式配置本项目环境、地域和附件前缀'; }
    for (const name of ['WECHAT_APPID', 'WECHAT_SECRET']) {
      if (hasPlaceholder(env[name])) return `云开发服务端文件操作缺少环境变量：${name}`;
    }
  }
  if (functionName === 'agent-scf') {
    if (String(env.DEBUG_OPENID || '').trim()) return '云端候选禁止 DEBUG_OPENID';
    if (isTrue(env.AGENT_SHADOW_ENABLED)) return '云端候选禁止 shadow 旁路调用';
    if (isTrue(env.LLM_API_ENABLED)) {
      for (const name of ['LLM_API_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL', 'VISION_MODEL']) {
        if (hasPlaceholder(env[name])) return `启用 LLM 时缺少或未替换环境变量：${name}`;
      }
      if (!/^https:\/\//i.test(String(env.LLM_API_BASE_URL))) {
        return 'LLM_API_BASE_URL 必须使用 HTTPS';
      }
    }
  }
  if (functionName === 'ingest-scf') {
    if (!isTrue(env.NOVA_INGEST_ENABLED)) return 'ingest-scf 未显式启用';
    if (hasPlaceholder(env.ONE_NET_TOKEN) && hasPlaceholder(env.EMQX_WEBHOOK_TOKEN)) {
      return 'ingest-scf 至少需要 ONE_NET_TOKEN 或 EMQX_WEBHOOK_TOKEN';
    }
  }
  if (functionName === 'history-cleanup-scf' && !isTrue(env.NOVA_HISTORY_CLEANUP_ENABLED)) {
    return 'history-cleanup-scf 未显式启用';
  }
  return '';
}

function pathEndsWith(path, expected) {
  return path === expected || path.endsWith(expected);
}

// Called inside each original index.main_handler entry, never a deployment handler.
// Credentials already exist in SCF environment variables, exactly as in LastScf.
function validateInvocation(functionName, event = {}, env = process.env) {
  const configurationError = env.NOVA_FUNCTION_NAME && env.NOVA_FUNCTION_NAME !== functionName
    ? 'NOVA_FUNCTION_NAME 与上传的函数包不匹配' : validateRuntimeEnvironment(functionName, env);
  if (configurationError) {
    return json(503, {
      success: false,
      code: 'CLOUD_CONFIGURATION_BLOCKED',
      msg: configurationError
    });
  }

  const path = getPath(event);
  const method = getMethod(event);
  if (functionName === 'ingest-scf' && !pathEndsWith(path, '/ingest')) {
    return json(404, {
      success: false,
      code: 'CLOUD_INGEST_PATH_REJECTED',
      msg: '遥测接入只允许已审查的 /ingest 路径。'
    });
  }
  if (functionName === 'history-cleanup-scf' && method) {
    return json(403, {
      success: false,
      code: 'CLOUD_TIMER_ONLY_FUNCTION',
      msg: '历史清理函数只允许 SCF 定时触发器调用。'
    });
  }
  if (functionName === 'api-scf') {
    if (pathEndsWith(path, DEVICE_COMMAND_PATH) && !isTrue(env.NOVA_DEVICE_COMMANDS_ENABLED)) {
      return json(403, {
        success: false,
        code: 'CLOUD_DEVICE_COMMANDS_DISABLED',
        msg: '云端初版未启用设备写指令。'
      });
    }
  }

  return null;
}

exports.validateInvocation = validateInvocation;
exports._private = {
  getPath,
  getMethod,
  hasPlaceholder,
  isTrue,
  pathEndsWith,
  validateRuntimeEnvironment
};
