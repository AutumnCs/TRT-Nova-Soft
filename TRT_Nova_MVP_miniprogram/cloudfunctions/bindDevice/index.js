// cloudfunctions/bindDevice/index.js
const cloud = require('wx-server-sdk');

cloud.init({
    env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const DEVICES = 'devices';
const DEVICE_ACL = 'device_acl';
const {
    buildLogicalKey,
    normalizeBindInput,
    buildRevivePatch,
    buildNewAclDoc
} = require('./policy');

exports.main = async (event, context) => {
    const wxContext = cloud.getWXContext();
    const {
        deviceCode: cleanDeviceCode,
        fullDeviceName,
        alias,
        location,
        plantType
    } = normalizeBindInput(event);

    if (!cleanDeviceCode || !fullDeviceName) {
        return {
            success: false,
            msg: 'deviceCode is required'
        };
    }

    let resolvedLogicalKey = '';
    try {
        const tx = await db.startTransaction();

        try {
            // 1) Resolve device by normalized OneNET deviceName.
            const deviceRes = await tx.collection(DEVICES).where({
                deviceName: fullDeviceName
            }).limit(1).get();
            if (deviceRes.data.length === 0) {
                await tx.rollback();
                return {
                    success: false,
                    msg: 'Device code not found or inactive'
                };
            }
            const deviceDoc = deviceRes.data[0];
            if (deviceDoc.status && deviceDoc.status !== 'active') {
                await tx.rollback();
                return {
                    success: false,
                    msg: 'Device code not found or inactive'
                };
            }
            const logicalKey = deviceDoc.logicalKey || buildLogicalKey(deviceDoc.productId, deviceDoc.deviceName);
            if (!logicalKey) {
                await tx.rollback();
                return {
                    success: false,
                    msg: 'Device mapping is incomplete'
                };
            }
            resolvedLogicalKey = logicalKey;

            // 2) one-device-one-user (check by logicalKey only)
            const aclRes = await tx.collection(DEVICE_ACL).where({
                logicalKey,
                status: 'active'
            }).limit(1).get();

            if (aclRes.data.length > 0) {
                const bound = aclRes.data[0];

                // 5) idempotent success for repeated bind by same user
                if (bound.openid === wxContext.OPENID) {
                    await tx.commit();
                    return {
                        success: true,
                        msg: 'Already bound',
                        logicalKey
                    };
                }

                await tx.rollback();
                return {
                    success: false,
                    msg: 'Device already bound by another user'
                };
            }

            // 3) try revive existing inactive ACL for same user + same device
            const inactiveRes = await tx.collection(DEVICE_ACL).where({
                openid: wxContext.OPENID,
                logicalKey,
                status: 'inactive'
            }).orderBy('updateTime', 'desc').limit(1).get();

            if (inactiveRes.data.length > 0) {
                const prev = inactiveRes.data[0];
                await tx.collection(DEVICE_ACL).doc(prev._id).update({
                    data: buildRevivePatch({
                        alias,
                        location,
                        plantType,
                        prev,
                        deviceDoc,
                        cleanDeviceCode,
                        serverDate: db.serverDate(),
                        removeValue: db.command.remove()
                    })
                });
            } else {
                // 4) first bind: create new ACL
                await tx.collection(DEVICE_ACL).add({
                    data: buildNewAclDoc({
                        openid: wxContext.OPENID,
                        logicalKey,
                        alias,
                        location,
                        plantType,
                        deviceDoc,
                        cleanDeviceCode,
                        serverDate: db.serverDate()
                    })
                });
            }

            await tx.commit();
        } catch (err) {
            try {
                await tx.rollback();
            } catch (rollbackErr) {
                console.error(rollbackErr);
            }
            throw err;
        }

        return {
            success: true,
            msg: 'Binding successful',
            deviceCode: cleanDeviceCode,
            deviceName: fullDeviceName,
            logicalKey: resolvedLogicalKey
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
