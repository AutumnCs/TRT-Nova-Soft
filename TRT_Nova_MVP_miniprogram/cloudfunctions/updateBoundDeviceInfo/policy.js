function normalizeUpdateInput(event = {}) {
  return {
    logicalKey: typeof event.logicalKey === 'string' ? event.logicalKey.trim() : '',
    alias: typeof event.alias === 'string' ? event.alias.trim() : '',
    location: typeof event.location === 'string' ? event.location.trim() : '',
    plantType: typeof event.plantType === 'string' ? event.plantType.trim() : ''
  };
}

function buildPatch({ alias, location, plantType, serverDate }) {
  const patch = {
    updateTime: serverDate
  };
  if (alias) patch.alias = alias;
  patch.location = location;
  patch.plantType = plantType;
  return patch;
}

function buildResult({ logicalKey, patch, prev }) {
  return {
    success: true,
    logicalKey,
    alias: patch.alias || prev.alias || '',
    location: patch.location !== undefined ? patch.location : prev.location || '',
    plantType: patch.plantType !== undefined ? patch.plantType : prev.plantType || ''
  };
}

module.exports = {
  normalizeUpdateInput,
  buildPatch,
  buildResult
};
