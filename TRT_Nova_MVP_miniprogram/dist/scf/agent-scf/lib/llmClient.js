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
  return [
    {
      role: 'system',
      content: [
        '你是 TRT Nova 的植物养护助手。',
        '你可以做轻量普通对话，但回答要自然、简洁，尽量围绕植物养护、设备使用和用户当前问题。',
        '如果问题涉及具体设备状态、浇水、趋势或控制，不要编造数据；提醒用户选择设备或查看设备数据。',
        '不要声称已经执行设备控制。'
      ].join('\n')
    },
    ...(contextText ? [{ role: 'system', content: contextText }] : []),
    { role: 'user', content: message }
  ];
}

async function chatWithLlm({ message, contextText = '' }) {
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
  const timeoutMs = Math.max(1000, Number(process.env.LLM_TIMEOUT_MS) || 12000);
  const temperature = Number.isFinite(Number(process.env.LLM_TEMPERATURE))
    ? Number(process.env.LLM_TEMPERATURE)
    : 0.4;

  const data = await requestJson(apiUrl, {
    model: process.env.LLM_MODEL,
    messages: buildChatMessages({ message, contextText }),
    temperature,
    max_tokens: Math.max(64, Number(process.env.LLM_MAX_TOKENS) || 500)
  }, {
    authorization: `Bearer ${process.env.LLM_API_KEY}`
  }, timeoutMs);

  const content = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || '';
  return {
    enabled: true,
    content: String(content || '').trim(),
    rawUsage: data?.usage || null
  };
}

module.exports = {
  chatWithLlm,
  isLlmEnabled
};
