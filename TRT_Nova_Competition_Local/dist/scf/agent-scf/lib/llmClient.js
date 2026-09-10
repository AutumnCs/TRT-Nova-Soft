const http = require('http');
const https = require('https');

function isLlmEnabled() {
  return String(process.env.LLM_API_ENABLED || '').toLowerCase() === 'true' &&
    !!process.env.LLM_API_BASE_URL &&
    !!process.env.LLM_API_KEY &&
    !!process.env.LLM_MODEL;
}

function joinUrl(baseUrl, path) {
  const base = String(baseUrl || '').replace(/\/+$/g, '');
  const suffix = String(path || '').replace(/^\/+/g, '');
  return `${base}/${suffix}`;
}

function requestJson(url, payload, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    const endpoint = new URL(url);
    const body = JSON.stringify(payload);
    const client = endpoint.protocol === 'http:' ? http : https;

    const req = client.request({
      protocol: endpoint.protocol,
      hostname: endpoint.hostname,
      port: endpoint.port,
      path: `${endpoint.pathname}${endpoint.search}`,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        ...headers
      },
      timeout: timeoutMs
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data = {};
        try {
          data = text ? JSON.parse(text) : {};
        } catch (err) {
          return reject(new Error(`LLM response is not valid JSON: ${text.slice(0, 120)}`));
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          const message = data?.error?.message || data?.message || `LLM request failed with ${res.statusCode}`;
          return reject(new Error(message));
        }

        resolve(data);
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('LLM request timeout'));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function buildChatMessages({ message, contextText = '' }) {
  const context = require('./conversation-context').getTurnContext();
  return [
    {
      role: 'system',
      content: [
        '你是 NOVA，一位温和、耐心、诚实，也有陪伴感的植物养护伙伴。',
        '像熟悉用户和植宠的伙伴一样自然说话：先直接回应用户真正关心的问题，再给出少量可执行建议。',
        '回答以简洁自然的中文段落为主，不照抄资料卡，不堆砌学名、字段或模板标题，也不制造养植焦虑。',
        '不要向用户暴露“知识库、RAG、已复核发布、模型配置、任务绑定”等内部实现或治理措辞；需要说明边界时，用日常语言解释。',
        '如果一条消息同时包含植物养护问题和明显无关的请求，只回答植物养护部分，并用一句自然的话说明其余部分不属于你的职责。',
        '提供了参考资料时，只使用其中与当前问题直接相关的事实，并把资料转述成 NOVA 自己的自然回答。',
        '只能把图片或记录中的迹象称为“可见现象”和“可能原因”，不能作确定性病害结论。',
        '事实不足时明确说“不确定”或“不知道”，不要补写为确定事实。',
        '不要提供危险的农药混配、医疗或食用安全保证；高风险情况建议咨询当地专业人员。',
        '你只能提出建议，不能声称已经创建任务、修改档案或控制设备。'
      ].join('\n')
    },
    ...(contextText ? [{ role: 'system', content: contextText }] : []),
    ...(context ? [{ role: 'system', content: context.text }] : []),
    { role: 'user', content: message }
  ];
}

function normalizeHistoryMessages(history = []) {
  const context = require('./conversation-context').getTurnContext();
  if (context) return context.history.map(({ role, content }) => ({ role, content }));
  return (Array.isArray(history) ? history : [])
    .filter((item) => item && ['user', 'assistant'].includes(item.role) && item.content)
    .slice(-12)
    .map((item) => ({ role: item.role, content: String(item.content).slice(0, 1600) }));
}

async function chatWithLlm({ message, contextText = '', history = [], maxTokens, requestTimeoutMs }) {
  if (!isLlmEnabled()) {
    return {
      enabled: false,
      content: ''
    };
  }

  const apiUrl = joinUrl(
    process.env.LLM_API_BASE_URL,
    process.env.LLM_API_PATH || '/v1/chat/completions'
  );
  const timeoutMs = Math.max(1000, Number(requestTimeoutMs) || Number(process.env.LLM_TIMEOUT_MS) || 12000);
  const temperature = Number.isFinite(Number(process.env.LLM_TEMPERATURE))
    ? Number(process.env.LLM_TEMPERATURE)
    : 0.4;

  const data = await requestJson(apiUrl, {
    model: process.env.LLM_MODEL,
    ...(/^deepseek-/i.test(process.env.LLM_MODEL || '') ? { thinking: { type: 'disabled' } } : {}),
    messages: buildChatMessages({ message, contextText }).slice(0, -1)
      .concat(normalizeHistoryMessages(history), [{ role: 'user', content: message }]),
    temperature,
    max_tokens: Math.max(64, Number(maxTokens) || Number(process.env.LLM_MAX_TOKENS) || 500)
  }, {
    authorization: `Bearer ${process.env.LLM_API_KEY}`
  }, timeoutMs);

  const content = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || '';
  return {
    enabled: true,
    content: String(content || '').trim(),
    finishReason: data?.choices?.[0]?.finish_reason || '',
    rawUsage: data?.usage || null
  };
}

module.exports = {
  chatWithLlm,
  isLlmEnabled,
  joinUrl,
  requestJson,
  buildChatMessages,
  normalizeHistoryMessages
};
