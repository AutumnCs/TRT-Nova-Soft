// cloudfunctions/getDeviceData/index.js
const cloud = require('wx-server-sdk');

cloud.init({
    env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
    const wxContext = cloud.getWXContext();

    try {
        // 1. Get user's bound devices
        const deviceRes = await db.collection('device_list')
            .where({
                ownerOpenId: wxContext.OPENID
            })
            .get();

        if (deviceRes.data.length === 0) {
            return {
                deviceData: []
            };
        }

        const deviceIds = deviceRes.data.map(item => item.deviceId);

        // 2. Query latest data for these devices
        // Note: Cloud DB 'in' query has a limit (usually 20 or so), assume small scale for now
        const dataRes = await db.collection('device_data')
            .where({
                deviceId: db.command.in(deviceIds)
            })
            .orderBy('timestamp', 'desc')
            .limit(20)
            .get();

        return {
            success: true,
            deviceData: dataRes.data
        };
    } catch (err) {
        console.error(err);
        return {
            success: false,
            error: err
        };
    }
};
