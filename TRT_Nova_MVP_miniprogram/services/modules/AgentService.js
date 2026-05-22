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

    return this.scfApiAdapter.chatWithAgent({
      sessionId: payload.sessionId || '',
      message,
      logicalKey: payload.logicalKey || '',
      context: payload.context || {},
      options: payload.options || {},
      __baseUrl: agentBaseUrl
    });
  }
}

module.exports = new AgentService();
