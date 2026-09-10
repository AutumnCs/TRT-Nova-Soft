const { consumeQuota, recordTokenUsage } = require('../lib/quota');
const { analyzeImageWithVision, validateImageInput } = require('../lib/visionClient');
const {
  findCommittedExchangeByKey,
  getOrCreateConversation,
  saveExchange
} = require('../lib/agent-store');
const { loadOwnedPlantPet } = require('./petContext');
const { hasExplicitTaskIntent } = require('./intentRouter');
const { parseTaskDraft } = require('../runtime/capabilityPolicy');

function createHttpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizePlantName(value = '') {
  return String(value || '').toLowerCase().replace(/[\s·._-]+/g, '');
}

function imageMatchesSelectedPlantPet(analysis = {}, pet = null) {
  if (!pet || analysis.uncertain) return false;
  const candidate = (analysis.candidates || []).find((item) => Number(item.confidence) >= 0.7 && item.name);
  if (!candidate) return false;
  const candidateName = normalizePlantName(candidate.name);
  const petNames = [pet.speciesName, pet.nickname].map(normalizePlantName).filter(Boolean);
  return petNames.some((name) => name === candidateName || name.includes(candidateName) || candidateName.includes(name));
}

function buildVisionTaskSuggestions(analysis, plantPetId, message = '', pet = null) {
  if (!analysis?.isPlant || !Number(plantPetId) || !hasExplicitTaskIntent(message)) return [];
  if (!imageMatchesSelectedPlantPet(analysis, pet)) return [];
  const topAdvice = analysis.advice?.[0];
  if (!topAdvice) return [];
  const draft = parseTaskDraft(message);
  return [{
    plantPetId: Number(plantPetId),
    ...draft,
    title: draft.taskType === 'inspection'
      ? (topAdvice.title || draft.title || '复查植物可见状态')
      : draft.title,
    description: [draft.description, topAdvice.detail || '结合现场状态复查，AI 只提供建议。']
      .filter(Boolean)
      .join('\n'),
    source: 'diagnosis'
  }];
}

function buildVisionConversationText(analysis = {}) {
  const candidateNames = (analysis.candidates || []).map((item) => item.name).filter(Boolean).slice(0, 3);
  const visibleSigns = (analysis.visibleSigns || []).filter(Boolean).slice(0, 4);
  const advice = (analysis.advice || []).map((item) => item.title || item.detail).filter(Boolean).slice(0, 3);
  return [
    analysis.reply || '',
    candidateNames.length ? `品种候选：${candidateNames.join('、')}` : '',
    visibleSigns.length ? `图片中可见：${visibleSigns.join('；')}` : '',
    advice.length ? `建议动作：${advice.join('；')}` : '',
    analysis.disclaimer || ''
  ].filter(Boolean).join('\n');
}

function buildVisionConversationResponse(result = {}, taskSuggestions = [], mediaFileId = '') {
  return {
    kind: 'vision_analysis',
    scope: { status: 'in_scope', reason: 'vision_analysis', domain: 'plant_care' },
    summary: result.analysis?.reply || '这张图片已经完成观察。',
    diagnosis: '',
    analysis: result.analysis || {},
    model: result.model || '',
    taskSuggestions,
    sources: [],
    attachment: { type: 'image', originalPersisted: true, mediaFileId },
    disclaimer: result.analysis?.disclaimer || ''
  };
}

async function loadOwnedConversationMedia(db, openid, mediaFileId, plantPetId, lock = false) {
  const fileId = String(mediaFileId || '').trim();
  if (!fileId) throw createHttpError('图片尚未保存到会话，请重新发送', 400);
  const [rows] = await db.execute(
    `SELECT file_id, plant_pet_id, reference_type, reference_key
     FROM media_objects
     WHERE file_id = ? AND openid = ? AND purpose = 'conversation_image'
     LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [fileId, openid]
  );
  const media = rows[0];
  if (!media) throw createHttpError('会话图片不存在或无权访问', 404);
  if ((Number(media.plant_pet_id) || 0) !== (Number(plantPetId) || 0)) {
    throw createHttpError('会话图片与当前植宠不匹配', 400);
  }
  if (media.reference_type) throw createHttpError('这张会话图片已经使用，请重新选择', 409);
  return media;
}

async function saveVisionExchangeWithMedia(db, openid, conversation, payload = {}) {
  const execute = async (connection) => {
    await loadOwnedConversationMedia(connection, openid, payload.mediaFileId, payload.plantPetId, true);
    const exchange = await saveExchange(
      connection,
      openid,
      conversation.id,
      payload.historyText,
      payload.assistantText,
      payload.response,
      {
        userResponse: payload.userResponse,
        clientTurnKey: payload.clientTurnKey,
        plantPetId: payload.plantPetId,
        proposals: payload.proposals,
        mediaFileIds: [payload.mediaFileId],
        transactionManagedExternally: true
      }
    );
    const [claimed] = await connection.execute(
      `UPDATE media_objects
       SET reference_type = 'ai_message', reference_key = ?, updated_at = CURRENT_TIMESTAMP
       WHERE file_id = ? AND openid = ? AND purpose = 'conversation_image' AND reference_type IS NULL`,
      [String(exchange.userMessageId), payload.mediaFileId, openid]
    );
    if (Number(claimed?.affectedRows) !== 1) throw createHttpError('会话图片关联失败，请重试', 409);
    return exchange;
  };

  if (typeof db.getConnection !== 'function') return execute(db);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const result = await execute(connection);
    await connection.commit();
    return result;
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

async function handleVisionAnalyze(db, openid, body = {}) {
  const plantPetId = Number(body.plantPetId) || 0;
  let pet = null;
  if (plantPetId) {
    pet = await loadOwnedPlantPet(db, openid, plantPetId);
    if (!pet) throw createHttpError('植宠不存在或无权访问', 404);
  }
  const imageValidation = validateImageInput(body);
  if (!imageValidation.ok) throw createHttpError(imageValidation.msg, 400);
  const clientTurnKey = String(body.clientTurnKey || '').trim();
  const sessionId = body.sessionId || `assistant_${plantPetId || 'global'}`;
  const conversation = await getOrCreateConversation(db, openid, sessionId, plantPetId || null);
  if (clientTurnKey) {
    const replay = await findCommittedExchangeByKey(db, openid, clientTurnKey);
    if (replay) {
      if (replay.conversationId !== (Number(conversation.id) || 0)) {
        const error = createHttpError('clientTurnKey 已用于其他会话', 409);
        error.code = 'CLIENT_TURN_KEY_CONFLICT';
        throw error;
      }
      const response = replay.response || {};
      return {
        success: true,
        analysis: response.analysis || {},
        model: response.model || '',
        byteSize: Number(response.byteSize) || imageValidation.byteSize || 0,
        taskSuggestions: response.taskSuggestions || [],
        sessionId: conversation.session_key,
        conversationId: Number(conversation.id) || 0,
        userMessageId: replay.userMessageId,
        assistantMessageId: replay.assistantMessageId,
        mediaFileId: response.attachment?.mediaFileId || String(body.mediaFileId || '').trim(),
        quota: { unlimited: true, allowed: true },
        idempotent: true
      };
    }
  }
  const mediaFileId = String(body.mediaFileId || '').trim();
  await loadOwnedConversationMedia(db, openid, mediaFileId, plantPetId, false);
  const quota = await consumeQuota(db, openid, 'vision');
  let result;
  try {
    result = await analyzeImageWithVision({
      imageBase64: body.imageBase64,
      mimeType: body.mimeType,
      plantContext: pet ? `${pet.nickname}，${pet.speciesName}，${pet.location || '位置未记录'}` : '',
      userMessage: body.message
    });
  } catch (err) {
    if (err.statusCode) throw err;
    console.warn('[vision] provider request failed:', err.message);
    throw createHttpError(`图片分析暂时不可用：${err.message}。你仍可手动建档或记录症状`, 503);
  }
  const usage = await recordTokenUsage(db, openid, result.rawUsage);
  const taskSuggestions = buildVisionTaskSuggestions(result.analysis, plantPetId, body.message, pet);
  const conversationResponse = buildVisionConversationResponse(result, taskSuggestions, mediaFileId);
  conversationResponse.byteSize = result.byteSize;
  const userMessage = String(body.message || '').trim().slice(0, 300);
  const historyText = [
    userMessage,
    '[本轮包含一张已保存到会话的植物图片]'
  ].filter(Boolean).join('\n');
  const exchange = await saveVisionExchangeWithMedia(db, openid, conversation, {
    mediaFileId,
    plantPetId,
    clientTurnKey,
    proposals: taskSuggestions.map((task) => ({
      proposalType: 'care_task',
      plantPetId,
      payload: task
    })),
    historyText,
    assistantText: buildVisionConversationText(result.analysis),
    response: conversationResponse,
    userResponse: {
      kind: 'vision_input',
      message: userMessage,
      attachment: { type: 'image', originalPersisted: true, mediaFileId }
    }
  });
  return {
    success: true,
    analysis: result.analysis,
    model: result.model,
    byteSize: result.byteSize,
    taskSuggestions: exchange.response?.taskSuggestions || [],
    sessionId: conversation.session_key,
    conversationId: Number(conversation.id) || 0,
    userMessageId: exchange.userMessageId,
    assistantMessageId: exchange.assistantMessageId,
    mediaFileId,
    quota: usage,
    idempotent: Boolean(exchange.idempotent)
  };
}

module.exports = {
  createHttpError,
  buildVisionTaskSuggestions,
  buildVisionConversationText,
  buildVisionConversationResponse,
  imageMatchesSelectedPlantPet,
  loadOwnedConversationMedia,
  saveVisionExchangeWithMedia,
  handleVisionAnalyze
};
