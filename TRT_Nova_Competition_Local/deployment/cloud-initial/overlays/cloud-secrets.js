'use strict';

// Only runtime role credentials are accepted. No key files, deploy-time secret dumps,
// or permanent Tencent credentials are needed in the candidate.
const SECRET_KEYS = new Set(['DB_USER', 'DB_PASSWORD', 'DB_SSL_CA', 'JWT_SECRET',
  'WECHAT_SECRET', 'LLM_API_KEY', 'QWEATHER_PRIVATE_KEY', 'ONE_NET_TOKEN',
  'ONE_NET_AES_KEY', 'EMQX_WEBHOOK_TOKEN']);
function roleCredentials(env = process.env) {
  const secretId = env.TENCENTCLOUD_SECRETID;
  const secretKey = env.TENCENTCLOUD_SECRETKEY;
  const token = env.TENCENTCLOUD_SESSIONTOKEN;
  if (!secretId || !secretKey || !token) throw new Error('CLOUD_ROLE_CREDENTIALS_MISSING');
  return { secretId, secretKey, token };
}
function parseReference(reference) {
  const match = /^secret:\/\/([a-z0-9._/-]+)(?:#([a-z0-9._-]+))?$/i.exec(String(reference));
  if (!match || match[1].includes('..')) throw new Error('CLOUD_SECRET_REFERENCE_INVALID');
  return { name: match[1], field: match[2] };
}
function createSecretLoader({ env = process.env, getSecret } = {}) {
  let ready;
  return async function initialize() {
    if (ready) return ready;
    ready = (async () => {
      if (env.NOVA_SECRET_STRATEGY !== 'runtime-ssm-sdk') throw new Error('CLOUD_SECRET_STRATEGY_REQUIRED');
      const refs = JSON.parse(env.NOVA_SECRET_REFS || '{}');
      if (!refs || Array.isArray(refs) || !Object.keys(refs).length) throw new Error('CLOUD_SECRET_REFERENCES_REQUIRED');
      for (const key of Object.keys(refs)) {
        if (!SECRET_KEYS.has(key)) throw new Error('CLOUD_SECRET_TARGET_INVALID');
        parseReference(refs[key]);
      }
      let retrieve = getSecret;
      if (!retrieve) {
        const Client = require('tencentcloud-sdk-nodejs-ssm').ssm.v20190923.Client;
        const client = new Client({ credential: roleCredentials(env), region: env.TENCENTCLOUD_REGION || env.NOVA_REGION,
          profile: { httpProfile: { endpoint: 'ssm.tencentcloudapi.com', reqTimeout: 8 } } });
        retrieve = (name) => client.GetSecretValue({ SecretName: name, VersionId: 'SSM_Current' });
      }
      const byName = new Map();
      const resolved = {};
      for (const reference of Object.values(refs)) {
        const { name } = parseReference(reference);
        if (!byName.has(name)) byName.set(name, Promise.resolve().then(() => retrieve(name)));
      }
      // Independent secrets fetch in parallel; duplicate fields share one request.
      await Promise.all(byName.values());
      for (const [key, reference] of Object.entries(refs)) {
        const { name, field } = parseReference(reference);
        const value = (await byName.get(name)).SecretString;
        resolved[key] = field ? JSON.parse(value)[field] : value;
        if (typeof resolved[key] !== 'string' || !resolved[key].trim()) throw new Error('CLOUD_SECRET_VALUE_MISSING');
      }
      // All-or-nothing injection; handlers create DB pools only after this completes.
      Object.assign(env, resolved);
    })().catch(() => { ready = undefined; throw new Error('CLOUD_SECRET_RESOLUTION_FAILED'); });
    return ready;
  };
}
module.exports = { roleCredentials, parseReference, createSecretLoader, initialize: createSecretLoader() };
