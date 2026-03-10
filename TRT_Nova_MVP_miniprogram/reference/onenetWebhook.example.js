/**
 * Reference implementation (SCF style): OneNET webhook receiver
 *
 * NOTE:
 * - This file is a reference implementation for deployed SCF webhook code.
 * - It is not executed by mini program runtime directly.
 * - Keep behavior aligned with cloudfunctions/oneNetPushReceiver/index.js.
 */

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

  // Strict pre-registration
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
  const {
    httpMethod,
    queryStringParameters = {},
    body
  } = event;

  if (httpMethod === 'GET') {
    const { msg, nonce, signature } = queryStringParameters;

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

  if (httpMethod === 'POST') {
    try {
      let pushData = body;
      if (typeof body === 'string') {
        pushData = JSON.parse(body);
      }

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
