const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const DEVICE_ACL = 'device_acl';

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const logicalKey = typeof event?.logicalKey === 'string' ? event.logicalKey.trim() : '';
  const alias = typeof event?.alias === 'string' ? event.alias.trim() : '';
  const location = typeof event?.location === 'string' ? event.location.trim() : '';
  const plantType = typeof event?.plantType === 'string' ? event.plantType.trim() : '';

  if (!logicalKey) {
    return { success: false, msg: 'logicalKey is required' };
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
      return { success: false, msg: 'Binding record not found' };
    }

    const patch = {
      updateTime: db.serverDate()
    };
    if (alias) patch.alias = alias;
    if (location !== undefined) patch.location = location;
    if (plantType !== undefined) patch.plantType = plantType;

    await db.collection(DEVICE_ACL).doc(aclRes.data[0]._id).update({
      data: patch
    });

    return {
      success: true,
      logicalKey,
      alias: patch.alias || aclRes.data[0].alias || '',
      location: patch.location !== undefined ? patch.location : aclRes.data[0].location || '',
      plantType: patch.plantType !== undefined ? patch.plantType : aclRes.data[0].plantType || ''
    };
  } catch (err) {
    console.error(err);
    return { success: false, msg: 'Database error', error: err.message };
  }
};
