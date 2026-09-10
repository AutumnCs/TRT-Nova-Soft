const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

function shanghaiDate(nowMs = Date.now()) {
  return new Date(Number(nowMs) + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

function getQuotaConfig() {
  return {
    unlimited: true,
    chat: null,
    vision: null
  };
}

function mapUsage(row = {}, limits = getQuotaConfig()) {
  const chatUsed = Number(row.chat_count) || 0;
  const visionUsed = Number(row.vision_count) || 0;
  return {
    date: row.usage_date || shanghaiDate(),
    unlimited: limits.unlimited === true,
    chat: { used: chatUsed, limit: null, remaining: null, unlimited: true },
    vision: { used: visionUsed, limit: null, remaining: null, unlimited: true },
    tokens: {
      prompt: Number(row.prompt_tokens) || 0,
      completion: Number(row.completion_tokens) || 0,
      total: Number(row.total_tokens) || 0
    }
  };
}

async function getDailyUsage(db, openid, date = shanghaiDate()) {
  const limits = getQuotaConfig();
  const [rows] = await db.execute(
    `SELECT DATE_FORMAT(usage_date, '%Y-%m-%d') AS usage_date, chat_count, vision_count,
            prompt_tokens, completion_tokens, total_tokens
     FROM ai_usage_daily WHERE openid = ? AND usage_date = ? LIMIT 1`,
    [openid, date]
  );
  return mapUsage(rows[0] || { usage_date: date }, limits);
}

async function consumeQuota(db, openid, kind, nowMs = Date.now()) {
  if (!['chat', 'vision'].includes(kind)) throw new Error('Unsupported AI quota kind');
  const date = shanghaiDate(nowMs);
  const column = kind === 'chat' ? 'chat_count' : 'vision_count';
  await db.execute(
    `INSERT INTO ai_usage_daily (openid, usage_date, ${column}, updated_at)
     VALUES (?, ?, 1, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE
       updated_at = CURRENT_TIMESTAMP,
       ${column} = ${column} + 1`,
    [openid, date]
  );
  const usage = await getDailyUsage(db, openid, date);
  return {
    allowed: true,
    kind,
    usage
  };
}

async function recordTokenUsage(db, openid, rawUsage = {}, nowMs = Date.now()) {
  const date = shanghaiDate(nowMs);
  const prompt = Math.max(0, Number(rawUsage.prompt_tokens) || 0);
  const completion = Math.max(0, Number(rawUsage.completion_tokens) || 0);
  const total = Math.max(0, Number(rawUsage.total_tokens) || prompt + completion);
  if (!prompt && !completion && !total) return getDailyUsage(db, openid, date);
  await db.execute(
    `INSERT INTO ai_usage_daily
      (openid, usage_date, prompt_tokens, completion_tokens, total_tokens, updated_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE
       prompt_tokens = prompt_tokens + VALUES(prompt_tokens),
       completion_tokens = completion_tokens + VALUES(completion_tokens),
       total_tokens = total_tokens + VALUES(total_tokens),
       updated_at = CURRENT_TIMESTAMP`,
    [openid, date, prompt, completion, total]
  );
  return getDailyUsage(db, openid, date);
}

module.exports = {
  shanghaiDate,
  getQuotaConfig,
  mapUsage,
  getDailyUsage,
  consumeQuota,
  recordTokenUsage
};
