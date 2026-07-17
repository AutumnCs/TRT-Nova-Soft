const DEVICE_NAME_PREFIX = 'Nova_';

function buildLogicalKey(productId, deviceName) {
  const p = typeof productId === 'string' ? productId.trim() : '';
  const d = typeof deviceName === 'string' ? deviceName.trim() : '';
  if (!p || !d) return '';
  return `${p}::${d}`;
}

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeDeviceName(deviceCode) {
  const raw = trimString(deviceCode);
  if (!raw) {
    return {
      deviceCode: '',
      fullDeviceName: ''
    };
  }

  if (raw.startsWith(DEVICE_NAME_PREFIX)) {
    return {
      deviceCode: raw.slice(DEVICE_NAME_PREFIX.length),
      fullDeviceName: raw
    };
  }

  return {
    deviceCode: raw,
    fullDeviceName: `${DEVICE_NAME_PREFIX}${raw}`
  };
}

function getUserFacingDeviceName(deviceDoc = {}, fallbackCode = '') {
  const fullName = trimString(deviceDoc.deviceName);
  if (fullName.startsWith(DEVICE_NAME_PREFIX)) {
    return fullName.slice(DEVICE_NAME_PREFIX.length) || fallbackCode;
  }
  return fullName || fallbackCode;
}

function normalizeBindInput(event = {}) {
  const normalized = normalizeDeviceName(event.deviceCode);
  const alias = trimString(event.alias);
  const location = trimString(event.location);
  const plantType = trimString(event.plantType);
  return {
    ...normalized,
    alias,
    location,
    plantType
  };
}

function buildRevivePatch({ alias, location, plantType, prev, deviceDoc, cleanDeviceCode, serverDate, removeValue }) {
  return {
    alias: alias || prev.alias || getUserFacingDeviceName(deviceDoc, cleanDeviceCode),
    location: location || prev.location || '',
    plantType: plantType || prev.plantType || '',
    role: prev.role || 'owner',
    status: 'active',
    bindTime: serverDate,
    unbindTime: removeValue,
    updateTime: serverDate
  };
}

function buildNewAclDoc({ openid, logicalKey, alias, location, plantType, deviceDoc, cleanDeviceCode, serverDate }) {
  return {
    openid,
    logicalKey,
    alias: alias || getUserFacingDeviceName(deviceDoc, cleanDeviceCode),
    location: location || '',
    plantType: plantType || '',
    role: 'owner',
    status: 'active',
    bindTime: serverDate,
    createTime: serverDate,
    updateTime: serverDate
  };
}

module.exports = {
  buildLogicalKey,
  normalizeBindInput,
  buildRevivePatch,
  buildNewAclDoc,
  getUserFacingDeviceName
};
