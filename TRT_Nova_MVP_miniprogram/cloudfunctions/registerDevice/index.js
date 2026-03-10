// cloudfunctions/registerDevice/index.js
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const DEVICES = 'devices';

function buildLogicalKey(productId, deviceName) {
  return `${productId}::${deviceName}`;
}

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const {
    action = 'upsert',
    physicalCode,
    productId,
    deviceName,
    externalDeviceId = '',
    status = 'active',
    alias = '',
    adminKey = ''
  } = event || {};

  // Developer list API: return current device registry.
  if (action === 'list') {
    try {
      const listRes = await db.collection(DEVICES)
        .orderBy('updateTime', 'desc')
        .limit(200)
        .get();
      return {
        success: true,
        action: 'list',
        devices: listRes.data
      };
    } catch (err) {
      console.error('registerDevice list error:', err);
      return {
        success: false,
        msg: 'Database error',
        error: err.message
      };
    }
  }

  const cleanPhysicalCode = trimString(physicalCode);
  const cleanProductId = trimString(productId);
  const cleanDeviceName = trimString(deviceName);
  const cleanExternalDeviceId = trimString(externalDeviceId);
  const cleanAlias = trimString(alias);

  if (!cleanPhysicalCode || !cleanProductId || !cleanDeviceName) {
    return {
      success: false,
      msg: 'physicalCode, productId and deviceName are required'
    };
  }

  // Optional guard: set DEVICE_REG_ADMIN_KEY in function env to enforce admin registration.
  const requiredAdminKey = process.env.DEVICE_REG_ADMIN_KEY || '';
  if (requiredAdminKey && adminKey !== requiredAdminKey) {
    return {
      success: false,
      msg: 'adminKey invalid'
    };
  }

  const logicalKey = buildLogicalKey(cleanProductId, cleanDeviceName);

  try {
    // Enforce unique physical code -> logical device mapping.
    const byPhysicalRes = await db.collection(DEVICES).where({
      physicalCode: cleanPhysicalCode
    }).limit(1).get();

    const byLogicalRes = await db.collection(DEVICES).where({
      logicalKey
    }).limit(1).get();

    if (
      byPhysicalRes.data.length > 0 &&
      byLogicalRes.data.length > 0 &&
      byPhysicalRes.data[0]._id !== byLogicalRes.data[0]._id
    ) {
      return {
        success: false,
        msg: 'physicalCode or logicalKey conflicts with another device record'
      };
    }

    const payload = {
      physicalCode: cleanPhysicalCode,
      logicalKey,
      productId: cleanProductId,
      deviceName: cleanDeviceName,
      alias: cleanAlias || cleanDeviceName,
      externalDeviceId: cleanExternalDeviceId,
      status,
      source: 'manual_register_cloudfunction',
      updateTime: db.serverDate(),
      updateBy: wxContext.OPENID || ''
    };

    const existed = byPhysicalRes.data[0] || byLogicalRes.data[0];
    if (existed) {
      await db.collection(DEVICES).doc(existed._id).update({
        data: payload
      });
      return {
        success: true,
        action: 'updated',
        physicalCode: cleanPhysicalCode,
        logicalKey,
        deviceId: existed._id
      };
    }

    const addRes = await db.collection(DEVICES).add({
      data: {
        ...payload,
        createTime: db.serverDate(),
        createBy: wxContext.OPENID || ''
      }
    });

    return {
      success: true,
      action: 'created',
      physicalCode: cleanPhysicalCode,
      logicalKey,
      deviceId: addRes._id
    };
  } catch (err) {
    console.error('registerDevice error:', err);
    return {
      success: false,
      msg: 'Database error',
      error: err.message
    };
  }
};
