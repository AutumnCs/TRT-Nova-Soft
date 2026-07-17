// cloudfunctions/getDeviceData/index.js
const cloud = require('wx-server-sdk');

cloud.init({
    env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const DEVICE_ACL = 'device_acl';
const DEVICE_LATEST = 'device_latest';
const DEVICE_DATA = 'device_data';
const DEVICES = 'devices';

function getUserFacingDeviceName(deviceName) {
    const cleanName = typeof deviceName === 'string' ? deviceName.trim() : '';
    return cleanName.startsWith('Nova_') ? cleanName.slice(5) : cleanName;
}

exports.main = async (event, context) => {
    const wxContext = cloud.getWXContext();
    const {
        withHistory = false,
        historyLimit = 50,
        logicalKey = ''
    } = event || {};

    try {
        // 1) query ACL devices for current user
        const aclWhere = {
            openid: wxContext.OPENID,
            status: 'active'
        };
        if (logicalKey && typeof logicalKey === 'string') {
            aclWhere.logicalKey = logicalKey.trim();
        }
        const aclRes = await db.collection(DEVICE_ACL).where(aclWhere).get();

        if (aclRes.data.length === 0) {
            return {
                success: true,
                deviceData: []
            };
        }

        const logicalKeys = aclRes.data.map(item => item.logicalKey);
        const aclMap = aclRes.data.reduce((acc, item) => {
            acc[item.logicalKey] = item;
            return acc;
        }, {});

        // 2) latest snapshot for bound devices
        const latestRes = await db.collection(DEVICE_LATEST)
            .where({
                logicalKey: db.command.in(logicalKeys)
            })
            .orderBy('updatedAt', 'desc')
            .limit(100)
            .get();

        // 2.1) load registry data, so bound devices without telemetry can still be shown
        const devicesRes = await db.collection(DEVICES)
            .where({
                logicalKey: db.command.in(logicalKeys)
            })
            .limit(200)
            .get();

        const latestMap = latestRes.data.reduce((acc, item) => {
            acc[item.logicalKey] = item;
            return acc;
        }, {});
        const devicesMap = devicesRes.data.reduce((acc, item) => {
            acc[item.logicalKey] = item;
            return acc;
        }, {});

        const mergedDeviceList = logicalKeys.map(logicalKey => {
            const acl = aclMap[logicalKey] || {};
            const latest = latestMap[logicalKey] || {};
            const device = devicesMap[logicalKey] || {};
            return {
                _id: latest._id || device._id || logicalKey,
                logicalKey,
                productId: latest.productId || device.productId || '',
                deviceName: latest.deviceName || device.deviceName || '',
                alias: acl.alias || getUserFacingDeviceName(latest.deviceName || device.deviceName) || logicalKey,
                location: acl.location || '',
                plantType: acl.plantType || '',
                role: acl.role || '',
                aclStatus: acl.status || '',
                params: latest.params || {},
                updatedAt: latest.updatedAt || null,
                hasLatest: !!latestMap[logicalKey]
            };
        });

        if (!withHistory) {
            return {
                success: true,
                deviceData: mergedDeviceList
            };
        }

        // 3) optional history query by same ACL scope
        const historyRes = await db.collection(DEVICE_DATA)
            .where({
                logicalKey: db.command.in(logicalKeys)
            })
            .orderBy('time', 'desc')
            .limit(Math.max(1, Math.min(200, Number(historyLimit) || 50)))
            .get();

        return {
            success: true,
            deviceData: mergedDeviceList,
            historyData: historyRes.data
        };
    } catch (err) {
        console.error(err);
        return {
            success: false,
            error: err
        };
    }
};
