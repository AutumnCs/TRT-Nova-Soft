/**
 * AlertService - 设备告警与离线通知框架
 *
 * 功能：
 *  1. checkDeviceOffline(devices) - 检查设备离线并生成告警
 *  2. checkSensorAlerts(sensors, thresholds) - 检查传感器超阈值
 *  3. requestSubscribePermission() - 申请微信订阅消息权限
 *  4. notifyOfflineViaBanner(device) - 小程序内横幅通知（无需订阅权限）
 *
 * 微信订阅消息配置说明：
 *  - 需在微信公众平台申请「订阅消息」模板（类目：智能设备/农业）
 *  - 常用模板：「设备状态变更提醒」「设备离线通知」
 *  - 在 app.js globalData.runtimeConfig 中配置：
 *      offlineTemplateId: 'YOUR_SUBSCRIBE_TEMPLATE_ID'
 *      sensorAlertTemplateId: 'YOUR_SENSOR_ALERT_TEMPLATE_ID'
 *
 * 离线判断规则：
 *  - 设备 updatedAt 超过 OFFLINE_THRESHOLD_MS 未上报 → 判定离线
 */

const { computeBubbles } = require('../config/thresholds');

// 超过此时间未上报视为离线（默认 10 分钟）
const OFFLINE_THRESHOLD_MS = 10 * 60 * 1000;

// 告警冷却时间，同一设备不重复告警（默认 30 分钟）
const ALERT_COOLDOWN_MS = 30 * 60 * 1000;

class AlertService {
  constructor() {
    // { logicalKey: lastAlertTimestamp }
    this._offlineAlertHistory = {};
    this._sensorAlertHistory = {};
  }

  /**
   * 检查设备列表，返回离线设备告警信息
   * @param {Array} deviceRows - DeviceService.getDeviceData() 返回的 deviceData 数组
   * @returns {Array<{ logicalKey, alias, offlineSince, message }>}
   */
  checkDeviceOffline(deviceRows) {
    if (!Array.isArray(deviceRows) || !deviceRows.length) return [];
    const now = Date.now();
    const alerts = [];

    for (const device of deviceRows) {
      const key = device.logicalKey;
      const updatedAt = Number(device.updatedAt || 0);
      const isOffline = !device.hasLatest || (updatedAt > 0 && now - updatedAt > OFFLINE_THRESHOLD_MS);

      if (!isOffline) continue;

      // 冷却期内不重复告警
      const lastAlerted = this._offlineAlertHistory[key] || 0;
      if (now - lastAlerted < ALERT_COOLDOWN_MS) continue;

      this._offlineAlertHistory[key] = now;
      alerts.push({
        logicalKey: key,
        alias: device.alias || device.deviceName || '未命名设备',
        offlineSince: updatedAt ? this._formatTs(updatedAt) : '未知',
        message: `设备「${device.alias || '未命名'}」已离线`
      });
    }

    return alerts;
  }

  /**
   * 检查传感器是否超阈值，返回需要展示的告警列表
   * @param {Object} sensors - index.js 的 sensors 对象
   * @returns {Array<{ icon, text, type }>}
   */
  checkSensorAlerts(sensors) {
    return computeBubbles(sensors);
  }

  /**
   * 申请微信订阅消息权限
   * 需在用户点击事件中调用（微信限制只能在 tap 事件触发）
   * @param {string[]} templateIds - 订阅消息模板 ID 数组
   * @returns {Promise<{ accepted: string[], denied: string[] }>}
   */
  requestSubscribePermission(templateIds = []) {
    return new Promise((resolve) => {
      if (!templateIds.length) {
        resolve({ accepted: [], denied: [] });
        return;
      }

      wx.requestSubscribeMessage({
        tmplIds: templateIds,
        success: (res) => {
          const accepted = templateIds.filter(id => res[id] === 'accept');
          const denied = templateIds.filter(id => res[id] !== 'accept');
          resolve({ accepted, denied });
        },
        fail: (err) => {
          console.warn('[AlertService] 订阅消息申请失败:', err);
          resolve({ accepted: [], denied: templateIds });
        }
      });
    });
  }

  /**
   * 小程序内横幅通知（不需要订阅权限，前台时生效）
   * @param {string} title - 通知标题
   * @param {string} content - 通知内容
   * @param {Object} options - { duration, icon }
   */
  notifyViaBanner(title, content, options = {}) {
    const { duration = 3000 } = options;
    // 简单 toast 实现；后续可改为自定义 toast 组件展示更长内容
    wx.showToast({
      title: `${title}: ${content}`,
      icon: 'none',
      duration
    });
  }

  /**
   * 展示设备离线告警 Banner
   * @param {Array} alerts - checkDeviceOffline 的返回值
   */
  showOfflineAlerts(alerts) {
    if (!alerts.length) return;
    // 多个离线设备只显示第一个
    const first = alerts[0];
    wx.showModal({
      title: '设备离线提醒',
      content: `${first.message}\n最后上报：${first.offlineSince}`,
      showCancel: false,
      confirmText: '知道了'
    });
  }

  // ── 内部工具 ────────────────────────────────────────────

  _formatTs(ts) {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '--';
    const p = x => String(x).padStart(2, '0');
    return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
}

module.exports = new AlertService();
