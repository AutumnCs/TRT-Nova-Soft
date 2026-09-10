const MAX_SHADOW_MESSAGE_LENGTH = 300;

function normalizeText(input, maxLength) {
  return typeof input === 'string' ? input.trim().slice(0, maxLength) : '';
}

function createTurnEnvelope(body = {}) {
  const rawMessage = typeof body.message === 'string' ? body.message.trim() : '';
  if (rawMessage.length > MAX_SHADOW_MESSAGE_LENGTH) {
    const error = new Error('shadow message exceeds length limit');
    error.code = 'SHADOW_INVALID_INPUT';
    throw error;
  }
  const message = normalizeText(rawMessage, MAX_SHADOW_MESSAGE_LENGTH);
  if (!message) {
    const error = new Error('shadow message is required');
    error.code = 'SHADOW_INVALID_INPUT';
    throw error;
  }

  const context = body.context && typeof body.context === 'object' ? body.context : {};
  return {
    message,
    sessionKey: normalizeText(body.sessionId, 128) || `assistant_${Number(body.plantPetId) || 'global'}`,
    clientTurnKey: normalizeText(body.clientTurnKey, 128),
    selectedPlantPetId: Number(body.plantPetId) || 0,
    plantType: normalizeText(context.plantType, 80)
  };
}

module.exports = {
  MAX_SHADOW_MESSAGE_LENGTH,
  createTurnEnvelope
};
