let clientPromise = null;

function getRuntimeCacheConfig() {
  const enabled = String(process.env.REDIS_ENABLED || '').trim().toLowerCase();
  const redisUrl = String(process.env.REDIS_URL || '').trim();
  const redisHost = String(process.env.REDIS_HOST || '').trim();
  const redisPort = Number(process.env.REDIS_PORT) || 6379;
  const redisPassword = String(process.env.REDIS_PASSWORD || '').trim();
  const keyPrefix = String(process.env.REDIS_KEY_PREFIX || 'trt:nova').trim() || 'trt:nova';

  return {
    enabled: enabled === '1' || enabled === 'true' || !!redisUrl || !!redisHost,
    redisUrl,
    redisHost,
    redisPort,
    redisPassword,
    keyPrefix,
    latestTtlSec: Math.max(30, Number(process.env.REDIS_DEVICE_LATEST_TTL_SEC) || 3600),
    onlineTtlSec: Math.max(30, Number(process.env.REDIS_DEVICE_ONLINE_TTL_SEC) || 1800),
    commandTtlSec: Math.max(30, Number(process.env.REDIS_COMMAND_STATE_TTL_SEC) || 3600)
  };
}

function buildRedisClientOptions(config) {
  if (config.redisUrl) {
    return { url: config.redisUrl };
  }

  return {
    socket: {
      host: config.redisHost || '127.0.0.1',
      port: config.redisPort
    },
    password: config.redisPassword || undefined
  };
}

async function getRedisClient(config = getRuntimeCacheConfig()) {
  if (!config.enabled) return null;
  if (!clientPromise) {
    clientPromise = (async () => {
      try {
        const { createClient } = require('redis');
        const client = createClient(buildRedisClientOptions(config));
        client.on('error', () => {});
        if (!client.isOpen) {
          await client.connect();
        }
        return client;
      } catch (err) {
        return null;
      }
    })();
  }
  return clientPromise;
}

function createRuntimeCache(serviceName = 'api-scf') {
  const config = getRuntimeCacheConfig();

  function keyOf(...parts) {
    return [config.keyPrefix, ...parts].join(':');
  }

  async function safeSetJson(key, value, ttlSec) {
    try {
      const client = await getRedisClient(config);
      if (!client) return false;
      await client.set(key, JSON.stringify(value || {}), { EX: ttlSec });
      return true;
    } catch (err) {
      return false;
    }
  }

  async function safeDelete(key) {
    try {
      const client = await getRedisClient(config);
      if (!client) return false;
      await client.del(key);
      return true;
    } catch (err) {
      return false;
    }
  }

  async function safeGetJson(key) {
    try {
      const client = await getRedisClient(config);
      if (!client) return null;
      const raw = await client.get(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  }

  return {
    config,
    keyOf,
    async setLatestDeviceState(payload = {}) {
      if (!payload.logicalKey) return false;
      return safeSetJson(
        keyOf('device', 'latest', payload.logicalKey),
        {
          service: serviceName,
          updatedAt: Date.now(),
          ...payload
        },
        config.latestTtlSec
      );
    },
    async getLatestDeviceState(logicalKey) {
      if (!logicalKey) return null;
      return safeGetJson(keyOf('device', 'latest', logicalKey));
    },
    async setDeviceOnlineState(payload = {}) {
      if (!payload.logicalKey) return false;
      return safeSetJson(
        keyOf('device', 'online', payload.logicalKey),
        {
          service: serviceName,
          updatedAt: Date.now(),
          ...payload
        },
        config.onlineTtlSec
      );
    },
    async getDeviceOnlineState(logicalKey) {
      if (!logicalKey) return null;
      return safeGetJson(keyOf('device', 'online', logicalKey));
    },
    async setCommandState(payload = {}) {
      if (!payload.commandId) return false;
      const body = {
        service: serviceName,
        updatedAt: Date.now(),
        ...payload
      };
      await safeSetJson(keyOf('command', 'state', payload.commandId), body, config.commandTtlSec);
      if (payload.logicalKey) {
        await safeSetJson(
          keyOf('device', 'command', 'latest', payload.logicalKey),
          body,
          config.commandTtlSec
        );
      }
      return true;
    },
    async getCommandState(commandId) {
      if (!commandId) return null;
      return safeGetJson(keyOf('command', 'state', commandId));
    },
    async getLatestDeviceCommandState(logicalKey) {
      if (!logicalKey) return null;
      return safeGetJson(keyOf('device', 'command', 'latest', logicalKey));
    },
    async clearCommandProcessing(commandId) {
      if (!commandId) return false;
      return safeDelete(keyOf('command', 'processing', commandId));
    },
    async setCommandProcessing(payload = {}) {
      if (!payload.commandId) return false;
      return safeSetJson(
        keyOf('command', 'processing', payload.commandId),
        {
          service: serviceName,
          updatedAt: Date.now(),
          ...payload
        },
        config.commandTtlSec
      );
    }
  };
}

module.exports = {
  createRuntimeCache,
  getRuntimeCacheConfig
};
