const ScfApiAdapter = require('../core/ScfApiAdapter');
const { resolveRuntimeConfig } = require('../config/runtime');

class AgentService {
  constructor() {
    this.scfApiAdapter = new ScfApiAdapter();
  }

  async chat(payload = {}) {
    const message = typeof payload.message === 'string' ? payload.message.trim() : '';
    if (!message) {
      return {
        success: false,
        msg: '请输入想咨询的问题'
      };
    }

    const config = resolveRuntimeConfig();
    const agentBaseUrl = (config.agentScfBaseUrl || config.scfApiBaseUrl || '').trim();

    return this.assertSuccess(await this.scfApiAdapter.chatWithAgent({
      sessionId: payload.sessionId || '',
      clientTurnKey: payload.clientTurnKey || '',
      message,
      plantPetId: Number(payload.plantPetId) || undefined,
      logicalKey: payload.logicalKey || '',
      context: payload.context || {},
      options: payload.options || {},
      __baseUrl: agentBaseUrl
    }), 'NOVA 暂时没有回复');
  }

  assertSuccess(result, fallbackMessage) {
    if (result?.success === false) throw new Error(result.msg || fallbackMessage);
    return result || {};
  }

  getAgentBaseUrl() {
    const config = resolveRuntimeConfig();
    return (config.agentScfBaseUrl || config.scfApiBaseUrl || '').trim();
  }

  async getSession(payload = {}) {
    return this.assertSuccess(await this.scfApiAdapter.getAgentSession({
      sessionId: payload.sessionId || '',
      plantPetId: Number(payload.plantPetId) || undefined,
      beforeMessageId: Number(payload.beforeMessageId) || undefined,
      __baseUrl: this.getAgentBaseUrl()
    }), '会话加载失败');
  }

  async contextMemory(payload = {}) {
    return this.assertSuccess(await this.scfApiAdapter.contextMemory({
      ...payload, __baseUrl: this.getAgentBaseUrl()
    }), '记忆摘要加载失败');
  }

  async listConversations(payload = {}) {
    return this.assertSuccess(await this.scfApiAdapter.listAgentConversations({
      plantPetId: Number(payload.plantPetId) || undefined,
      __baseUrl: this.getAgentBaseUrl()
    }), '会话列表加载失败');
  }

  async createConversation(payload = {}) {
    return this.assertSuccess(await this.scfApiAdapter.createAgentConversation({
      plantPetId: Number(payload.plantPetId) || undefined,
      title: payload.title || '新对话',
      __baseUrl: this.getAgentBaseUrl()
    }), '新会话创建失败');
  }

  async forkConversation(payload = {}) {
    return this.assertSuccess(await this.scfApiAdapter.forkAgentConversation({
      sourceMessageId: Number(payload.sourceMessageId) || 0,
      __baseUrl: this.getAgentBaseUrl()
    }), '会话分支创建失败');
  }

  async withdrawLatestExchange(payload = {}) {
    return this.assertSuccess(await this.scfApiAdapter.withdrawAgentExchange({
      sessionId: payload.sessionId || '',
      userMessageId: Number(payload.userMessageId) || 0,
      __baseUrl: this.getAgentBaseUrl()
    }), '撤回失败');
  }

  async analyzeImage(payload = {}) {
    return this.assertSuccess(await this.scfApiAdapter.analyzePlantImage({
      sessionId: payload.sessionId || '',
      clientTurnKey: payload.clientTurnKey || '',
      imageBase64: payload.imageBase64 || '',
      mimeType: payload.mimeType || '',
      mediaFileId: payload.mediaFileId || '',
      plantPetId: Number(payload.plantPetId) || undefined,
      message: typeof payload.message === 'string' ? payload.message.trim() : '',
      __baseUrl: this.getAgentBaseUrl()
    }), '图片分析失败');
  }

  async analyzeDocument(payload = {}) {
    return this.assertSuccess(await this.scfApiAdapter.analyzePlantDocument({
      sessionId: payload.sessionId || '',
      clientTurnKey: payload.clientTurnKey || '',
      mediaFileId: payload.mediaFileId || '',
      plantPetId: Number(payload.plantPetId) || undefined,
      message: typeof payload.message === 'string' ? payload.message.trim() : '',
      __baseUrl: this.getAgentBaseUrl()
    }), '文档分析失败');
  }

  async markVisionSaved(payload = {}) {
    return this.assertSuccess(await this.scfApiAdapter.markVisionSaved({
      assistantMessageId: Number(payload.assistantMessageId) || 0,
      diagnosisId: Number(payload.diagnosisId) || 0,
      __baseUrl: this.getAgentBaseUrl()
    }), '图片会话状态更新失败');
  }

  async listDiagnoses(payload = {}) {
    return this.assertSuccess(await this.scfApiAdapter.listDiagnoses(payload), '观察记录加载失败');
  }

  async saveDiagnosis(payload = {}) {
    return this.assertSuccess(await this.scfApiAdapter.saveDiagnosis(payload), '观察记录保存失败');
  }

  async correctDiagnosis(payload = {}) {
    return this.assertSuccess(await this.scfApiAdapter.correctDiagnosis(payload), '观察记录修正失败');
  }

  async deleteDiagnosis(diagnosisId) {
    return this.assertSuccess(await this.scfApiAdapter.deleteDiagnosis(diagnosisId), '观察记录删除失败');
  }

  async listMemories(payload = {}) {
    return this.assertSuccess(await this.scfApiAdapter.listAiMemories(payload), 'AI 记忆加载失败');
  }

  async createMemory(payload = {}) {
    return this.assertSuccess(await this.scfApiAdapter.createAiMemory({ ...payload, confirmed: true }), 'AI 记忆保存失败');
  }

  async updateMemory(payload = {}) {
    return this.assertSuccess(await this.scfApiAdapter.updateAiMemory(payload), 'AI 记忆修改失败');
  }

  async deleteMemory(memoryId) {
    return this.assertSuccess(await this.scfApiAdapter.deleteAiMemory(memoryId), 'AI 记忆删除失败');
  }

  async clearMemories(payload = {}) {
    return this.assertSuccess(await this.scfApiAdapter.clearAiMemories(payload), 'AI 记忆清除失败');
  }

  async confirmMemoryProposal(proposalKey) {
    return this.assertSuccess(
      await this.scfApiAdapter.confirmMemoryProposal({ proposalKey }),
      '称呼记忆确认失败'
    );
  }

  async dismissMemoryProposal(proposalKey) {
    return this.assertSuccess(
      await this.scfApiAdapter.dismissMemoryProposal({ proposalKey }),
      '称呼记忆取消失败'
    );
  }
}

module.exports = new AgentService();
