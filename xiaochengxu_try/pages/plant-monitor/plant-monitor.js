// pages/plant-monitor/plant-monitor.js
Page({
  /**
   * 页面的初始数据
   */
  data: {
    // 设备信息
    deviceInfo: {
      deviceName: '智能花盆001',
      deviceId: 'PH-20251216-0001'
    },
    // 传感器数据
    sensors: {
      temperature: 25.5,
      temperatureStatus: '正常',
      humidity: 65,
      humidityStatus: '正常',
      light: 1200,
      lightStatus: '充足',
      moisture: 70,
      moistureStatus: '良好',
      ph: 6.5,
      phStatus: '适宜',
      fertility: 450,
      fertilityStatus: '充足'
    },
    // 更新时间
    updateTime: ''
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    // 初始化数据
    this.updateSensorData();
    // 设置定时更新，每5秒更新一次数据
    this.setDataTimer = setInterval(() => {
      this.updateSensorData();
    }, 5000);
  },

  /**
   * 生命周期函数--监听页面卸载
   */
  onUnload() {
    // 清除定时器
    if (this.setDataTimer) {
      clearInterval(this.setDataTimer);
    }
  },

  /**
   * 更新传感器数据
   */
  updateSensorData() {
    // 模拟传感器数据变化
    const newSensors = {
      // 温度：20-30°C之间随机变化
      temperature: (20 + Math.random() * 10).toFixed(1),
      // 湿度：40-80%之间随机变化
      humidity: Math.floor(40 + Math.random() * 40),
      // 光照：500-2000 lux之间随机变化
      light: Math.floor(500 + Math.random() * 1500),
      // 水分含量：50-90%之间随机变化
      moisture: Math.floor(50 + Math.random() * 40),
      // pH值：5.5-7.5之间随机变化
      ph: (5.5 + Math.random() * 2).toFixed(1),
      // 养分浓度：300-600 mg/L之间随机变化
      fertility: Math.floor(300 + Math.random() * 300)
    };

    // 更新传感器状态
    newSensors.temperatureStatus = this.getTemperatureStatus(newSensors.temperature);
    newSensors.humidityStatus = this.getHumidityStatus(newSensors.humidity);
    newSensors.lightStatus = this.getLightStatus(newSensors.light);
    newSensors.moistureStatus = this.getMoistureStatus(newSensors.moisture);
    newSensors.phStatus = this.getPhStatus(newSensors.ph);
    newSensors.fertilityStatus = this.getFertilityStatus(newSensors.fertility);

    // 获取当前时间
    const now = new Date();
    const updateTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;

    // 更新数据
    this.setData({
      sensors: newSensors,
      updateTime: updateTime
    });
  },

  /**
   * 获取温度状态
   */
  getTemperatureStatus(temperature) {
    temperature = parseFloat(temperature);
    if (temperature < 20) return '偏低';
    if (temperature > 30) return '偏高';
    return '正常';
  },

  /**
   * 获取湿度状态
   */
  getHumidityStatus(humidity) {
    humidity = parseInt(humidity);
    if (humidity < 50) return '干燥';
    if (humidity > 70) return '潮湿';
    return '正常';
  },

  /**
   * 获取光照状态
   */
  getLightStatus(light) {
    light = parseInt(light);
    if (light < 800) return '不足';
    if (light > 1500) return '充足';
    return '正常';
  },

  /**
   * 获取水分状态
   */
  getMoistureStatus(moisture) {
    moisture = parseInt(moisture);
    if (moisture < 60) return '缺水';
    if (moisture > 80) return '水分充足';
    return '良好';
  },

  /**
   * 获取pH值状态
   */
  getPhStatus(ph) {
    ph = parseFloat(ph);
    if (ph < 6.0) return '偏酸';
    if (ph > 7.0) return '偏碱';
    return '适宜';
  },

  /**
   * 获取养分状态
   */
  getFertilityStatus(fertility) {
    fertility = parseInt(fertility);
    if (fertility < 400) return '不足';
    if (fertility > 500) return '充足';
    return '正常';
  }
})