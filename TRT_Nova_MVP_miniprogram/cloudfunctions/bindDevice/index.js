// cloudfunctions/bindDevice/index.js
const cloud = require('wx-server-sdk');

cloud.init({
    env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const DEVICES = 'devices';
const DEVICE_ACL = 'device_acl';

function buildLogicalKey(productId, deviceName) {
    return `${productId}::${deviceName}`;
}

exports.main = async (event, context) => {
    const wxContext = cloud.getWXContext();
    const {
        deviceCode,
        alias
    } = event;

    const cleanDeviceCode = typeof deviceCode === 'string' ? deviceCode.trim() : '';

    if (!cleanDeviceCode) {
        return {
            success: false,
            msg: 'deviceCode is required'
        };
    }

    try {
        const tx = await db.startTransaction();

        try {
            // 1) Resolve pre-registered device by physical device code.
            const deviceRes = await tx.collection(DEVICES).where({
                physicalCode: cleanDeviceCode,
                status: 'active'
            }).limit(1).get();
            if (deviceRes.data.length === 0) {
                await tx.rollback();
                return {
                    success: false,
                    msg: 'Device code not found or inactive'
                };
            }
            const deviceDoc = deviceRes.data[0];
            const logicalKey = deviceDoc.logicalKey || buildLogicalKey(deviceDoc.productId, deviceDoc.deviceName);
            if (!logicalKey) {
                await tx.rollback();
                return {
                    success: false,
                    msg: 'Device mapping is incomplete'
                };
            }

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

            // 3) write minimal ACL fields + alias
            await tx.collection(DEVICE_ACL).add({
                data: {
                    openid: wxContext.OPENID,
                    logicalKey,
                    alias: alias || deviceDoc.alias || deviceDoc.deviceName || cleanDeviceCode,
                    role: 'owner',
                    status: 'active',
                    bindTime: db.serverDate(),
                    createTime: db.serverDate(),
                    updateTime: db.serverDate()
                }
            });

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
