function normalizeLogicalKey(input) {
  return typeof input === 'string' ? input.trim() : '';
}

function normalizeAction(input) {
  return typeof input === 'string' ? input.trim().toLowerCase() : '';
}

function normalizePlainObject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }
  return { ...input };
}

function buildFanPayload(isOn) {
  return { test: Boolean(isOn) };
}

const COMMAND_DEFINITIONS = {
  'fan.on': {
    params: () => buildFanPayload(true)
  },
  'fan.off': {
    params: () => buildFanPayload(false)
  }
};

function resolveDeviceCommandRequest(input = {}, options = {}) {
  const logicalKey = normalizeLogicalKey(input.logicalKey);
  if (!logicalKey) {
    return { ok: false, msg: '设备标识缺失' };
  }

  const action = normalizeAction(input.action);
  if (!action) {
    return { ok: false, msg: 'Unsupported device action' };
  }

  const definition = COMMAND_DEFINITIONS[action];
  if (!definition) {
    return { ok: false, msg: 'Unsupported device action' };
  }

  const args = normalizePlainObject(input.args) || {};
  const params = definition.params(args, options);
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return { ok: false, msg: 'Unsupported device action' };
  }

  return {
    ok: true,
    logicalKey,
    action,
    params
  };
}

module.exports = {
  COMMAND_DEFINITIONS,
  resolveDeviceCommandRequest
};
