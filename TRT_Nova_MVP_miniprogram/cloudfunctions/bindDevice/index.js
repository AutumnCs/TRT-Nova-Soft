// cloudfunctions/bindDevice/index.js
const cloud = require('wx-server-sdk');

cloud.init({
    env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
    const wxContext = cloud.getWXContext();
    const {
        deviceId,
        deviceName
    } = event;

    if (!deviceId) {
        return {
            success: false,
            msg: 'Device ID is required'
        };
    }

    try {
        // Check if already bound
        const checkRes = await db.collection('device_list').where({
            deviceId: deviceId,
            ownerOpenId: wxContext.OPENID
        }).get();

        if (checkRes.data.length > 0) {
            return {
                success: false,
                msg: 'Device already bound'
            };
        }

        // Bind device
        await db.collection('device_list').add({
            data: {
                deviceId,
                deviceName: deviceName || 'Unnamed Device',
                ownerOpenId: wxContext.OPENID,
                bindTime: db.serverDate()
            }
        });

        return {
            success: true,
            msg: 'Binding successful'
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
