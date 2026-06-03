const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const DEVICE_ACL = 'device_acl';

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const logicalKey = typeof event?.logicalKey === 'string' ? event.logicalKey.trim() : '';

  if (!logicalKey) {
    return {
      success: false,
      msg: 'logicalKey is required'
    };
  }

  try {
    const aclRes = await db
      .collection(DEVICE_ACL)
      .where({
        openid: wxContext.OPENID,
        logicalKey,
        status: 'active'
      })
      .limit(1)
      .get();

    if (!aclRes.data.length) {
      return {
        success: false,
        msg: 'Binding record not found'
      };
    }

    await db.collection(DEVICE_ACL).doc(aclRes.data[0]._id).update({
      data: {
        status: 'inactive',
        unbindTime: db.serverDate(),
        updateTime: db.serverDate()
      }
    });

    return {
      success: true,
      msg: 'Unbind successful',
      logicalKey
    };
  } catch (err) {
    console.error(err);
    return {
      success: false,
      msg: 'Database error',
      error: err
    };
  }
};
