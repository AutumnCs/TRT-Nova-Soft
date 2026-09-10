const IMAGE_MIME_TYPES = Object.freeze({
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp'
});

const VISION_NOTICE_BUTTONS = Object.freeze({
  confirmText: '同意发送',
  cancelText: '暂不发送'
});

const MESSAGE_ACTION_DEFINITIONS = Object.freeze({
  copy: Object.freeze({ key: 'copy', label: '复制', icon: '/images/icons/message/copy.svg' }),
  rewrite: Object.freeze({ key: 'rewrite', label: '重新编辑', icon: '/images/icons/message/pencil.svg' }),
  withdraw: Object.freeze({ key: 'withdraw', label: '撤回本轮', icon: '/images/icons/message/undo-2.svg', destructive: true })
});

function cleanBase64(input = '') {
  return String(input || '')
    .trim()
    .replace(/^data:[^;]+;base64,/i, '')
    .replace(/\s+/g, '');
}

function decodeBase64(input = '') {
  const base64 = cleanBase64(input);
  if (!base64) return new Uint8Array(0);

  if (typeof wx !== 'undefined' && typeof wx.base64ToArrayBuffer === 'function') {
    return new Uint8Array(wx.base64ToArrayBuffer(base64));
  }
  if (typeof Buffer !== 'undefined') return Uint8Array.from(Buffer.from(base64, 'base64'));
  if (typeof atob === 'function') {
    const binary = atob(base64);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  }
  return new Uint8Array(0);
}

function detectImageMimeFromBase64(input = '') {
  const bytes = decodeBase64(input);
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return IMAGE_MIME_TYPES.jpeg;
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return IMAGE_MIME_TYPES.png;
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) {
    return IMAGE_MIME_TYPES.webp;
  }
  return '';
}

function getBase64ByteSize(input = '') {
  const base64 = cleanBase64(input);
  if (!base64) return 0;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(base64.length * 3 / 4) - padding);
}

function getVisionErrorMessage(err) {
  const raw = String(err?.message || err?.errMsg || '').trim();
  if (!raw) return '图片读取失败，请重新选择一张 JPG、PNG 或 WebP 图片';
  return raw
    .replace(/^(?:chooseMedia|chooseImage|readFile|getFileInfo|compressImage|request):fail\s*/i, '')
    .replace(/^general failure\s*/i, '')
    .trim() || '图片读取失败，请重新选择';
}

function isVisionCancellation(err) {
  return /(?:cancel|取消)/i.test(String(err?.message || err?.errMsg || ''));
}

function shouldSendOnConfirm(event = {}) {
  return !(event.shiftKey === true || event?.detail?.shiftKey === true);
}

function canSendDraft(input = '', pendingImage = null, pendingDocument = null, selectedFunction = null) {
  return Boolean(String(input || '').trim() || pendingImage?.tempFilePath || pendingDocument?.tempFilePath || selectedFunction?.key);
}

function createAssistantAsyncScope(plantPetId = 0, sessionId = '', epoch = 0) {
  return {
    plantPetId: Number(plantPetId) || 0,
    sessionId: String(sessionId || ''),
    epoch: Number(epoch) || 0
  };
}

function isAssistantAsyncScopeCurrent(expected = {}, current = {}) {
  const normalizedExpected = createAssistantAsyncScope(
    expected.plantPetId,
    expected.sessionId,
    expected.epoch
  );
  const normalizedCurrent = createAssistantAsyncScope(
    current.plantPetId,
    current.sessionId,
    current.epoch
  );
  return normalizedExpected.plantPetId === normalizedCurrent.plantPetId
    && normalizedExpected.sessionId === normalizedCurrent.sessionId
    && normalizedExpected.epoch === normalizedCurrent.epoch;
}

function isAssistantInteractionLocked(state = {}) {
  return state.sending === true
    || state.loadingSession === true
    || state.visionBusy === true
    || state.documentBusy === true
    || state.savingDiagnosis === true
    || state.rewriteBusy === true
    || Boolean(state.proposalBusyKey);
}

function canApplySessionSnapshot(preserveView, expectedMutationVersion, currentMutationVersion) {
  return preserveView !== true || Number(expectedMutationVersion) === Number(currentMutationVersion);
}

function canPreserveAssistantView(state = {}, loadedOpenid = '', currentOpenid = '') {
  const expectedOpenid = String(currentOpenid || '').trim();
  return Boolean(
    expectedOpenid &&
    String(loadedOpenid || '').trim() === expectedOpenid &&
    state.activeSessionId &&
    Array.isArray(state.messages) &&
    state.messages.length
  );
}

function runSingleFlight(owner, key, task) {
  if (owner[key]) return owner[key];
  const pending = Promise.resolve().then(task);
  owner[key] = pending;
  return pending.finally(() => {
    if (owner[key] === pending) owner[key] = null;
  });
}

function canRewriteMessage(message = {}) {
  if (message.role !== 'user' || !Number(message.backendId)) return false;
  if (message.visionInput) {
    return !message.imageOriginalUnavailable && Boolean(message.visionMediaFileId || message.imagePreview);
  }
  if (message.documentInput) {
    return Boolean(message.documentAttachment?.originalPersisted && message.documentAttachment?.mediaFileId);
  }
  return true;
}

function buildMessageActionMenu(message = {}, point = {}, viewport = {}) {
  const backendId = Number(message.backendId) || 0;
  if (message.role !== 'user' || !backendId) return null;
  const actions = [];
  if (String(message.text || '').trim()) actions.push(MESSAGE_ACTION_DEFINITIONS.copy);
  if (message.canRewrite) actions.push(MESSAGE_ACTION_DEFINITIONS.rewrite);
  if (message.canWithdraw) actions.push(MESSAGE_ACTION_DEFINITIONS.withdraw);
  if (!actions.length) return null;

  const windowWidth = Math.max(240, Number(viewport.windowWidth) || 375);
  const windowHeight = Math.max(400, Number(viewport.windowHeight) || 667);
  const menuWidth = Math.min(180, windowWidth - 24);
  const menuHeight = actions.length * 48 + 16;
  const clientX = Number(point.clientX ?? point.x) || windowWidth - 24;
  const clientY = Number(point.clientY ?? point.y) || Math.round(windowHeight / 2);
  const minLeft = 12;
  const maxLeft = Math.max(minLeft, windowWidth - menuWidth - 12);
  const left = Math.min(maxLeft, Math.max(minLeft, clientX - menuWidth + 24));
  const belowTop = clientY + 12;
  const top = belowTop + menuHeight <= windowHeight - 12
    ? belowTop
    : Math.max(12, clientY - menuHeight - 12);

  return {
    backendId,
    actions: actions.map((item) => ({ ...item })),
    left: Math.round(left),
    top: Math.round(top)
  };
}

module.exports = {
  IMAGE_MIME_TYPES,
  VISION_NOTICE_BUTTONS,
  cleanBase64,
  detectImageMimeFromBase64,
  getBase64ByteSize,
  getVisionErrorMessage,
  isVisionCancellation,
  shouldSendOnConfirm,
  canSendDraft,
  createAssistantAsyncScope,
  isAssistantAsyncScopeCurrent,
  isAssistantInteractionLocked,
  canApplySessionSnapshot,
  canPreserveAssistantView,
  runSingleFlight,
  canRewriteMessage,
  buildMessageActionMenu
};
