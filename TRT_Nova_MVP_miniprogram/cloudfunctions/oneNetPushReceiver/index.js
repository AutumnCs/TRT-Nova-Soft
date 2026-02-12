// cloudfunctions/oneNetPushReceiver/index.js
const cloud = require('wx-server-sdk');
const crypto = require('crypto');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
// TODO: Replace with your actual Token configured in OneNET
const ONE_NET_TOKEN = 'oneNetPush123';
// TODO: Replace with your actual AES Key if using secure mode
const ONE_NET_AES_KEY = ''; // Empty for plaintext mode, set for secure mode

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
  const calSignature = Buffer.from(md5).toString('base64');
  
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
  // Extract message ID for deduplication
  const msgId = pushData.id || Date.now().toString();
  
  // Parse device data from 'msg' field
  let deviceData = {};
  if (pushData.msg) {
    try {
      // Decrypt if secure mode is enabled
      const decryptedMsg = decryptMsg(pushData.msg, aesKey);
      // Parse the decrypted message
      deviceData = JSON.parse(decryptedMsg);
    } catch (e) {
      console.warn('Could not parse msg field, using raw', e);
      deviceData = { raw: pushData.msg };
    }
  }
  
  // Store in Cloud Database
  await db.collection('device_data').add({
    data: {
      _id: msgId, // Use message ID as document ID for deduplication
      deviceId: deviceData.device_id || 'unknown',
      datapoints: deviceData.datapoints || {},
      rawPush: pushData,
      timestamp: pushData.time || Date.now(),
      createTime: db.serverDate()
    }
  });
}

exports.main = async (event, context) => {
  const {
    httpMethod,
    queryStringParameters,
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
      if (pushData.msg && pushData.nonce && pushData.signature) {
        if (!verifySignature(pushData.msg, pushData.nonce, pushData.signature, ONE_NET_TOKEN)) {
          console.warn('Signature verification failed for POST request');
          return {
            statusCode: 403,
            body: 'Signature verification failed'
          };
        }
        console.log('POST request signature verified successfully');
      } else {
        console.warn('Missing signature parameters in POST request');
      }

      // Process and store device data
      await processDeviceData(pushData, ONE_NET_AES_KEY, db);

      return {
        statusCode: 200,
        body: 'success'
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
        body: 'success (error caught)'
      };
    }
  }

  return {
    statusCode: 405,
    body: 'Method Not Allowed'
  };
};
