// cloudfunctions/sendDeviceCmd/index.js
const cloud = require('wx-server-sdk');
const axios = require('axios');

cloud.init({
    env: cloud.DYNAMIC_CURRENT_ENV
});

// TODO: Replace with your actual OneNET Master API Key
const ONE_NET_API_KEY = 'YOUR_MASTER_API_KEY';

exports.main = async (event, context) => {
    const {
        deviceId,
        cmd
    } = event;

    if (!deviceId || !cmd) {
        return {
            success: false,
            msg: 'Missing deviceId or cmd'
        };
    }

    try {
        // Send command to OneNET
        // Note: URL might differ based on OneNET region/version (EDP/MQTT vs Studio)
        // This is for the Classic OneNET MQTT Command API
        const response = await axios.post(`https://api.heclouds.com/cmds?device_id=${deviceId}`, {
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
