// cloudfunctions/oneNetPushReceiver/index.js
const cloud = require('wx-server-sdk');
const crypto = require('crypto');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const ONE_NET_TOKEN = process.env.ONE_NET_TOKEN || 'oneNetPush123';
const ONE_NET_AES_KEY = process.env.ONE_NET_AES_KEY || '';
const DEVICES = 'devices';
const DEVICE_LATEST = 'device_latest';
const DEVICE_DATA = 'device_data';

function buildLogicalKey(productId, deviceName) {
  return `${productId}::${deviceName}`;
}

/**
 * Verify signature
 * @param {string} msg - Message
 * @param {string} nonce - Random string
 * @param {string} signature - Signature
 * @param {string} token - Token configured in OneNET
 * @returns {boolean} - True if signature is valid
 */
function verifySignature(msg, nonce, signature, token) {
  if (!msg || !nonce || !signature || !token) {
    return false;
  }
  
  const strA = token + nonce + msg;
  const md5 = crypto.createHash('md5').update(strA).digest('hex');
  const calSignature = Buffer.from(md5, 'hex').toString('base64');
  
  return calSignature === signature;
}

/**
 * Decrypt message (for secure mode)
 * @param {string} cryptedMsg - Encrypted message
 * @param {string} aesKey - AES key
 * @returns {string} - Decrypted message
 */
function decryptMsg(cryptedMsg, aesKey) {
  if (!aesKey) {
    return cryptedMsg;
  }
  
  try {
    // Use base64 decoded Buffer for decryption
    const cryptedBuffer = Buffer.from(cryptedMsg, 'base64');
    // Initialization vector
    const iv = aesKey.substring(0, 16);
    // AES-128-CBC decryption
    const decipher = crypto.createDecipheriv('aes-128-cbc', aesKey, iv);
    let decodedMsg = decipher.update(cryptedBuffer, null, 'utf8');
    decodedMsg += decipher.final('utf8');
    return decodedMsg;
  } catch (e) {
    console.error('Decryption error:', e);
    return cryptedMsg; // Return original if decryption fails
  }
}

/**
 * Process device data and store to database
 * @param {Object} pushData - Push data from OneNET
 * @param {string} aesKey - AES key
 * @param {Object} db - Database instance
 * @returns {Promise<void>}
 */
async function processDeviceData(pushData, aesKey, db) {
  const pushId = pushData.id || '';
  const pushTime = pushData.time || Date.now();
  const nonce = pushData.nonce || '';
  const signature = pushData.signature || '';

  if (!pushData.msg || typeof pushData.msg !== 'string') {
    throw new Error('msg missing');
  }

  // 1) parse OneNET inner payload
  const decryptedMsg = decryptMsg(pushData.msg, aesKey);
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

  // strict pre-registration: unknown device data should not enter business tables
  const deviceRes = await db.collection(DEVICES).where({
    logicalKey
  }).limit(1).get();
  if (deviceRes.data.length === 0) {
    return {
      ignored: true,
      reason: 'Device not registered',
      productId,
      deviceName,
      logicalKey
    };
  }

  // 2) normalize latest snapshot
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

  // 3) normalize history rows
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

  // 4) upsert latest
  const latestRes = await db.collection(DEVICE_LATEST).where({
    logicalKey
  }).limit(1).get();

  if (latestRes.data.length > 0) {
    await db.collection(DEVICE_LATEST).doc(latestRes.data[0]._id).update({
      data: latestRecord
    });
  } else {
    await db.collection(DEVICE_LATEST).add({
      data: {
        ...latestRecord,
        createTime: db.serverDate()
      }
    });
  }

  // 5) append history
  for (const row of historyRecords) {
    // deduplicate webhook retries by deterministic record id
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

exports.main = async (event, context) => {
  const {
    httpMethod,
    queryStringParameters = {},
    body
  } = event;

  console.log('Event:', event);

  // 1. OneNET URL Verification (GET request)
  if (httpMethod === 'GET') {
    const {
      msg,
      nonce,
      signature
    } = queryStringParameters;
    
    console.log('Verification Request:', { msg, nonce, signature });

    if (!msg || !nonce || !signature) {
      return {
        statusCode: 400,
        body: 'Missing parameters'
      };
    }

    if (verifySignature(msg, nonce, signature, ONE_NET_TOKEN)) {
      console.log('URL verification successful');
      return {
        statusCode: 200,
        body: msg
      };
    } else {
      console.error('URL verification failed');
      return {
        statusCode: 403,
        body: 'Verification failed'
      };
    }
  }

  // 2. Data Push (POST request)
  if (httpMethod === 'POST') {
    try {
      // Body might be a JSON string or object depending on content-type
      let pushData = body;
      if (typeof body === 'string') {
        pushData = JSON.parse(body);
      }
      
      console.log('Received Push Data:', pushData);

      // Verify signature for security
      if (!pushData.msg || !pushData.nonce || !pushData.signature) {
        return {
          statusCode: 403,
          body: 'Missing signature parameters'
        };
      }

      if (!verifySignature(pushData.msg, pushData.nonce, pushData.signature, ONE_NET_TOKEN)) {
        console.warn('Signature verification failed for POST request');
        return {
          statusCode: 403,
          body: 'Signature verification failed'
        };
      }
      console.log('POST request signature verified successfully');

      // Process and store device data
      const result = await processDeviceData(pushData, ONE_NET_AES_KEY, db);

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
      // Return 200 to prevent OneNET from retrying indefinitely on logic errors
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
