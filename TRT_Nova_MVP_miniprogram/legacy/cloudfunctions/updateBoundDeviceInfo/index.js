const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const DEVICE_ACL = 'device_acl';
const { normalizeUpdateInput, buildPatch, buildResult } = require('./policy');

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const { logicalKey, alias, location, plantType } = normalizeUpdateInput(event);

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

    const patch = buildPatch({
      alias,
      location,
      plantType,
      serverDate: db.serverDate()
    });

    await db.collection(DEVICE_ACL).doc(aclRes.data[0]._id).update({
      data: patch
    });

    return buildResult({ logicalKey, patch, prev: aclRes.data[0] });
  } catch (err) {
    console.error(err);
    return { success: false, msg: 'Database error', error: err.message };
  }
};
