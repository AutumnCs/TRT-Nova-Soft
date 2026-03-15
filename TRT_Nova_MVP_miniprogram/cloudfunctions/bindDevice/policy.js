function buildLogicalKey(productId, deviceName) {
  const p = typeof productId === 'string' ? productId.trim() : '';
  const d = typeof deviceName === 'string' ? deviceName.trim() : '';
  if (!p || !d) return '';
  return `${p}::${d}`;
}

function normalizeBindInput(event = {}) {
  const deviceCode = typeof event.deviceCode === 'string' ? event.deviceCode.trim() : '';
  const alias = typeof event.alias === 'string' ? event.alias.trim() : '';
  const location = typeof event.location === 'string' ? event.location.trim() : '';
  const plantType = typeof event.plantType === 'string' ? event.plantType.trim() : '';
  return { deviceCode, alias, location, plantType };
}

function buildRevivePatch({ alias, location, plantType, prev, deviceDoc, cleanDeviceCode, serverDate, removeValue }) {
  return {
    alias: alias || prev.alias || deviceDoc.deviceName || cleanDeviceCode,
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
    alias: alias || deviceDoc.deviceName || cleanDeviceCode,
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
  buildNewAclDoc
};
