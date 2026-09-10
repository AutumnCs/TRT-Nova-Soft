const {
  isLlmEnabled,
  joinUrl,
  requestJson
} = require('../lib/llmClient');

function normalizeToolCalls(message = {}) {
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  return calls.map((call, index) => ({
    id: String(call.id || `shadow-tool-${index + 1}`),
    type: 'function',
    function: {
      name: String(call.function?.name || ''),
      arguments: typeof call.function?.arguments === 'string'
        ? call.function.arguments
        : JSON.stringify(call.function?.arguments || {})
    }
  }));
}

function createOpenAiCompatibleAgentModel(options = {}) {
  const enabled = options.enabled === undefined ? isLlmEnabled() : options.enabled === true;
  return {
    isEnabled() {
      return enabled;
    },
    async next(input = {}) {
      if (!enabled) return { enabled: false, content: '', toolCalls: [], rawUsage: null };
      const apiUrl = joinUrl(
        options.baseUrl || process.env.LLM_API_BASE_URL,
        options.path || process.env.LLM_API_PATH || '/v1/chat/completions'
      );
      const model = String(options.model || process.env.LLM_MODEL || '').trim();
      const tools = Array.isArray(input.tools) ? input.tools : [];
      const timeoutMs = Math.max(
        1000,
        Number(options.timeoutMs || process.env.AGENT_SHADOW_TIMEOUT_MS || process.env.LLM_TIMEOUT_MS) || 12000
      );
      const payload = {
        model,
        messages: Array.isArray(input.messages) ? input.messages : [],
        temperature: 0,
        max_tokens: Math.max(
          64,
          Number(options.maxTokens || process.env.AGENT_SHADOW_MAX_TOKENS) || 320
        )
      };
      // 空工具集合应表现为普通 completion；部分兼容服务会把
      // `tools: [] + tool_choice: auto` 解释成不完整的工具轮并返回空正文。
      if (tools.length) {
        payload.tools = tools;
        payload.tool_choice = 'auto';
      }
      // DeepSeek thinking 模式可能在受控短预算内只消耗 reasoning tokens，
      // 留下空的用户可见 content。受控运行时需要可展示答案，因此与
      // Vision 链一致，对明确的 DeepSeek 模型关闭额外思考。
      if (/^deepseek-/i.test(model)) payload.thinking = { type: 'disabled' };

      const data = await requestJson(apiUrl, payload, {
        authorization: `Bearer ${options.apiKey || process.env.LLM_API_KEY}`
      }, timeoutMs);

      const message = data?.choices?.[0]?.message || {};
      return {
        enabled: true,
        content: String(message.content || '').trim(),
        reasoningContent: String(message.reasoning_content || ''),
        toolCalls: normalizeToolCalls(message),
        rawUsage: data?.usage || null
      };
    }
  };
}

const createOpenAiCompatibleShadowModel = createOpenAiCompatibleAgentModel;

module.exports = {
  normalizeToolCalls,
  createOpenAiCompatibleAgentModel,
  createOpenAiCompatibleShadowModel
};
