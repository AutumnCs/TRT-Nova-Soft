const cloud = require('wx-server-sdk');
const crypto = require('crypto');

// Set default environment variables
process.env.ONE_NET_TOKEN = process.env.ONE_NET_TOKEN || 'trtnova123';
process.env.TCB_ENV = process.env.TCB_ENV || 'cloud1-6gfrptied648aa39';
process.env.TCB_SECRETID = process.env.TCB_SECRETID || 'AKIDtdDconZ9ZmmbEeroY8Wq7FMSSJAqLdlD';
process.env.TCB_SECRETKEY = process.env.TCB_SECRETKEY || 'PbcR3TkqlV4ThQD0ky2xiIMI3c0BD5l4';

const resolvedEnv =
  process.env.TCB_ENV ||
  process.env.WX_CLOUD_ENV ||
  process.env.CLOUDBASE_ENV ||
  process.env.SCF_NAMESPACE ||
  cloud.DYNAMIC_CURRENT_ENV;

const initConfig = {
  env: resolvedEnv
};

// In generic SCF runtime, wx-server-sdk may not auto-inject auth key.
// Use explicit credentials from environment as a fallback.
if (process.env.TCB_SECRETID && process.env.TCB_SECRETKEY) {
  initConfig.secretId = process.env.TCB_SECRETID;
  initConfig.secretKey = process.env.TCB_SECRETKEY;
  if (process.env.TCB_SESSIONTOKEN) {
    initConfig.sessionToken = process.env.TCB_SESSIONTOKEN;
  }
} else if (process.env.TENCENTCLOUD_SECRETID && process.env.TENCENTCLOUD_SECRETKEY) {
  initConfig.secretId = process.env.TENCENTCLOUD_SECRETID;
  initConfig.secretKey = process.env.TENCENTCLOUD_SECRETKEY;
  if (process.env.TENCENTCLOUD_SESSIONTOKEN) {
    initConfig.sessionToken = process.env.TENCENTCLOUD_SESSIONTOKEN;
  }
}

cloud.init(initConfig);

const db = cloud.database();
const ONE_NET_TOKEN = process.env.ONE_NET_TOKEN || '';
const ONE_NET_AES_KEY = process.env.ONE_NET_AES_KEY || '';
const DEVICES = 'devices';
const DEVICE_LATEST = 'device_latest';
const DEVICE_DATA = 'device_data';

function buildLogicalKey(productId, deviceName) {
  return `${productId}::${deviceName}`;
}

function verifySignature(msg, nonce, signature, token) {
  if (!msg || !nonce || !signature || !token) {
    return false;
  }

  const strA = token + nonce + msg;
  const md5 = crypto.createHash('md5').update(strA).digest('hex');
  const calSignature = Buffer.from(md5, 'hex').toString('base64');

  return calSignature === signature;
}

function decryptMsg(cryptedMsg, aesKey) {
  if (!aesKey) {
    return cryptedMsg;
  }

  try {
    const cryptedBuffer = Buffer.from(cryptedMsg, 'base64');
    const iv = aesKey.substring(0, 16);
    const decipher = crypto.createDecipheriv('aes-128-cbc', aesKey, iv);
    let decodedMsg = decipher.update(cryptedBuffer, null, 'utf8');
    decodedMsg += decipher.final('utf8');
    return decodedMsg;
  } catch (e) {
    console.error('Decryption error:', e);
    return cryptedMsg;
  }
}

function getHttpMethod(event) {
  return (
    event?.httpMethod ||
    event?.requestContext?.http?.method ||
    event?.requestContext?.httpMethod ||
    ''
  ).toUpperCase();
}

function getQuery(event) {
  if (event?.queryStringParameters && Object.keys(event.queryStringParameters).length > 0) {
    return event.queryStringParameters;
  }
  if (event?.queryString && typeof event.queryString === 'object') {
    return event.queryString;
  }
  const multi = event?.multiValueQueryStringParameters || {};
  const q = {};
  Object.keys(multi).forEach((k) => {
    const v = multi[k];
    q[k] = Array.isArray(v) ? v[0] : v;
  });
  return q;
}

function getBody(event) {
  if (event?.body === undefined || event?.body === null) return {};
  if (typeof event.body === 'string') {
    try {
      return JSON.parse(event.body);
    } catch (e) {
      return {};
    }
  }
  if (typeof event.body === 'object') return event.body;
  return {};
}

async function processDeviceData(pushData) {
  const pushId = pushData.id || '';
  const pushTime = pushData.time || Date.now();
  const nonce = pushData.nonce || '';
  const signature = pushData.signature || '';

  if (!pushData.msg || typeof pushData.msg !== 'string') {
    throw new Error('msg missing');
  }

  const decryptedMsg = decryptMsg(pushData.msg, ONE_NET_AES_KEY);
  const innerMsg = JSON.parse(decryptedMsg);

  const notifyType = innerMsg.notifyType || '';
  const messageType = innerMsg.messageType || '';
  const productId = innerMsg.productId || '';
  const deviceName = innerMsg.deviceName || '';
  const dataId = innerMsg?.data?.id || '';
  const params = innerMsg?.data?.params || {};

  if (!productId || !deviceName) {
    throw new Error('productId/deviceName missing');
  }

  const logicalKey = buildLogicalKey(productId, deviceName);

  const deviceRes = await db.collection(DEVICES).where({ logicalKey }).limit(1).get();
  if (deviceRes.data.length === 0) {
    return {
      ignored: true,
      reason: 'Device not registered',
      productId,
      deviceName,
      logicalKey
    };
  }

  const latestRecord = {
    logicalKey,
    productId,
    deviceName,
    notifyType,
    messageType,
    dataId,
    updatedAt: pushTime,
    params: {},
    pushMeta: {
      pushId,
      pushTime,
      nonce,
      signature
    },
    updateTime: db.serverDate()
  };

  const historyRecords = [];
  for (const [paramKey, item] of Object.entries(params)) {
    const value = item?.value;
    const time = item?.time || pushTime;

    latestRecord.params[paramKey] = { value, time };
    historyRecords.push({
      logicalKey,
      productId,
      deviceName,
      paramKey,
      value,
      time,
      dataId,
      pushId,
      receivedAt: pushTime,
      createTime: db.serverDate()
    });
  }

  const latestRes = await db.collection(DEVICE_LATEST).where({ logicalKey }).limit(1).get();
  if (latestRes.data.length > 0) {
    await db.collection(DEVICE_LATEST).doc(latestRes.data[0]._id).update({ data: latestRecord });
  } else {
    await db.collection(DEVICE_LATEST).add({
      data: {
        ...latestRecord,
        createTime: db.serverDate()
      }
    });
  }

  for (const row of historyRecords) {
    const dedupId = crypto
      .createHash('md5')
      .update(`${row.logicalKey}|${row.pushId}|${row.paramKey}|${row.time}`)
      .digest('hex');

    await db.collection(DEVICE_DATA).doc(dedupId).set({
      data: {
        ...row
      }
    });
  }

  return {
    productId,
    deviceName,
    logicalKey,
    recordCount: historyRecords.length
  };
}

exports.main = async (event) => {
  const method = getHttpMethod(event);
  const query = getQuery(event);
  const body = getBody(event);

  console.log('method=', method, 'query=', query);
  console.log('env=', resolvedEnv, 'hasSecret=', !!initConfig.secretId);

  if (!ONE_NET_TOKEN) {
    return {
      statusCode: 500,
      body: 'ONE_NET_TOKEN is required'
    };
  }

  if (method === 'GET') {
    const { msg, nonce, signature } = query;

    if (!msg || !nonce || !signature) {
      return {
        statusCode: 400,
        body: 'Missing parameters'
      };
    }

    if (verifySignature(msg, nonce, signature, ONE_NET_TOKEN)) {
      return {
        statusCode: 200,
        body: msg
      };
    }

    return {
      statusCode: 403,
      body: 'Verification failed'
    };
  }

  if (method === 'POST') {
    try {
      const pushData = body;

      if (!pushData.msg || !pushData.nonce || !pushData.signature) {
        return {
          statusCode: 403,
          body: 'Missing signature parameters'
        };
      }

      if (!verifySignature(pushData.msg, pushData.nonce, pushData.signature, ONE_NET_TOKEN)) {
        return {
          statusCode: 403,
          body: 'Signature verification failed'
        };
      }

      const result = await processDeviceData(pushData);
      return {
        statusCode: 200,
        body: JSON.stringify({
          code: 0,
          message: 'success',
          ...result
        })
      };
    } catch (err) {
      console.error('Error processing push:', {
        error: err.message,
        stack: err.stack,
        pushData: body
      });

      return {
        statusCode: 200,
        body: JSON.stringify({
          code: 1,
          message: 'success (error caught)',
          error: err.message
        })
      };
    }
  }

  return {
    statusCode: 405,
    body: 'Method Not Allowed'
  };
};


// Handler alias for SCF console misconfig (app.main_handler) 
exports.main_handler = exports.main;
