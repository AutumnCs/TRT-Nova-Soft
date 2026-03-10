// cloudfunctions/sendDeviceCmd/index.js
const cloud = require('wx-server-sdk');
const axios = require('axios');

cloud.init({
    env: cloud.DYNAMIC_CURRENT_ENV
});
const db = cloud.database();
const DEVICE_ACL = 'device_acl';
const DEVICES = 'devices';

// TODO: Replace with your actual OneNET Master API Key
const ONE_NET_API_KEY = 'YOUR_MASTER_API_KEY';

function buildLogicalKey(productId, deviceName) {
    return `${productId}::${deviceName}`;
}

exports.main = async (event, context) => {
    const {
        logicalKey,
        productId,
        deviceName,
        cmd
    } = event;
    const wxContext = cloud.getWXContext();

    if (!cmd) {
        return {
            success: false,
            msg: 'Missing cmd'
        };
    }

    try {
        const finalLogicalKey = logicalKey || (productId && deviceName ? buildLogicalKey(productId, deviceName) : '');
        if (!finalLogicalKey) {
            return {
                success: false,
                msg: 'Missing logicalKey or (productId + deviceName)'
            };
        }

        // 1) ACL permission check
        const aclRes = await db.collection(DEVICE_ACL).where({
            openid: wxContext.OPENID,
            logicalKey: finalLogicalKey,
            status: 'active'
        }).get();

        if (aclRes.data.length === 0) {
            return {
                success: false,
                msg: 'Permission denied for this device'
            };
        }

        // 2) resolve OneNET command target from device registry
        const deviceRes = await db.collection(DEVICES).where({
            logicalKey: finalLogicalKey
        }).limit(1).get();

        if (deviceRes.data.length === 0 || !deviceRes.data[0].externalDeviceId) {
            return {
                success: false,
                msg: 'Device command channel not configured'
            };
        }
        const externalDeviceId = deviceRes.data[0].externalDeviceId;

        // Send command to OneNET
        // Note: URL might differ based on OneNET region/version (EDP/MQTT vs Studio)
        // This is for the Classic OneNET MQTT Command API
        const response = await axios.post(`https://api.heclouds.com/cmds?device_id=${externalDeviceId}`, {
            cmd: typeof cmd === 'object' ? JSON.stringify(cmd) : cmd
        }, {
            headers: {
                'api-key': ONE_NET_API_KEY,
                'Content-Type': 'application/json'
            },
            timeout: 5000
        });

        console.log('OneNET Response:', response.data);

        if (response.data.errno === 0) {
            return {
                success: true,
                oneNetResp: response.data
            };
        } else {
            return {
                success: false,
                msg: 'OneNET Error',
                oneNetResp: response.data
            };
        }
    } catch (err) {
        console.error('Command Send Error:', err);
        return {
            success: false,
            msg: 'Request Failed',
            error: err.message
        };
    }
};
