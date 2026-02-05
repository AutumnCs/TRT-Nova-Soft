const db = require('../DB');

const COLLECTION_NAME = 'devices';

/**
 * @class DeviceService
 * @description 设备业务逻辑层
 * 封装了具体的设备相关业务逻辑，调用底层 DB 实例进行数据操作
 */
class DeviceService {
  
  /**
   * 获取用户的所有设备
   * @returns {Promise<Array>}
   */
  async getDevices() {
    try {
      console.log('开始获取设备列表');
      // 直接查询，云开发会自动根据用户身份过滤
      const devices = await db.query(COLLECTION_NAME, {});
      console.log('获取到设备列表:', devices);
      return devices;
    } catch (err) {
      console.error('获取设备列表失败', err);
      // 错误时返回空数组，避免页面崩溃
      return [];
    }
  }

  /**
   * 添加设备
   * @param {Object} deviceData - 设备数据
   * @returns {Promise<Object>}
   */
  async addDevice(deviceData) {
    try {
      console.log('开始添加设备:', deviceData);
      
      // 准备设备数据
      const newDevice = {
        name: deviceData.name,
        code: deviceData.code,
        type: deviceData.type,
        typeLabel: deviceData.typeLabel,
        icon: this.getDeviceIcon(deviceData.type),
        status: '在线', // 默认在线
        active: false,
        bindTime: new Date().toISOString()
      };
      
      console.log('准备添加的设备:', newDevice);
      const result = await db.add(COLLECTION_NAME, newDevice);
      console.log('添加设备成功:', result);
      return result;
    } catch (err) {
      console.error('添加设备失败', err);
      // 重新抛出错误，带上更详细的信息
      throw new Error(`添加设备失败: ${err.message}`);
    }
  }

  /**
   * 更新设备
   * @param {string} deviceId - 设备ID
   * @param {Object} updates - 更新数据
   * @returns {Promise<boolean>}
   */
  async updateDevice(deviceId, updates) {
    try {
      console.log('开始更新设备:', deviceId, updates);
      const result = await db.update(COLLECTION_NAME, deviceId, updates);
      console.log('更新设备成功:', result);
      return result;
    } catch (err) {
      console.error('更新设备失败', err);
      throw new Error(`更新设备失败: ${err.message}`);
    }
  }

  /**
   * 删除设备
   * @param {string} deviceId - 设备ID
   * @returns {Promise<boolean>}
   */
  async deleteDevice(deviceId) {
    try {
      console.log('开始删除设备:', deviceId);
      const result = await db.delete(COLLECTION_NAME, deviceId);
      console.log('删除设备成功:', result);
      return result;
    } catch (err) {
      console.error('删除设备失败', err);
      throw new Error(`删除设备失败: ${err.message}`);
    }
  }

  /**
   * 根据设备类型获取图标
   * @param {string} type - 设备类型
   * @returns {string}
   */
  getDeviceIcon(type) {
    const iconMap = {
      'flower_pot': '🌱',
      'watering_system': '💧',
      'light_system': '💡',
      'other': '📱'
    };
    return iconMap[type] || '📱';
  }

  /**
   * 激活设备（设置为当前活动设备）
   * @param {string} deviceId - 要激活的设备ID
   * @returns {Promise<boolean>}
   */
  async activateDevice(deviceId) {
    try {
      console.log('开始激活设备:', deviceId);
      
      // 获取所有设备
      const devices = await this.getDevices();
      
      // 遍历更新所有设备的激活状态
      for (const device of devices) {
        await this.updateDevice(device._id, {
          active: device._id === deviceId
        });
      }
      
      console.log('激活设备成功');
      return true;
    } catch (err) {
      console.error('激活设备失败', err);
      throw new Error(`激活设备失败: ${err.message}`);
    }
  }
}

module.exports = new DeviceService();
