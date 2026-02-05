const app = getApp()
const todoService = require('../../services/modules/TodoService');
const deviceService = require('../../services/modules/DeviceService');


Page({
  data: {
    statusBarHeight: 20, // 默认值，会被 onLoad 覆盖
    navBarHeight: 44,
    plantName: "Nova (办公室)",
    //plantImage: "https://images.unsplash.com/photo-1485955900006-10f4d324d411?q=80&w=600&auto=format&fit=crop",
    userImage: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?q=80&w=100&auto=format&fit=crop",
    dialogue: "主人，我的土壤有点干了，可以给我喝点水吗？💧",
    todos: [],// 初始化为空，等待从数据库加载
    sensors: {
      temp: { value: "25.4", unit: "°C", label: "环境温度", status: "normal" },
      light: { value: "1200", unit: "lx", label: "环境光照", status: "normal" },
      humidity: { value: "47.7", unit: "%", label: "环境湿度", status: "normal" },
      soil: { value: "15.2", unit: "%", label: "土壤过干", status: "warning" }
    },
    fan: { id: 'fan', name: '通风扇', icon: '🌪️', isOn: false, desc: '已关闭' },
    // 设备数据
    devices: [],
    // 历史数据模态框
    showHistoryModal: false,
    // 历史数据
    historyData: {
      temp: [25.4, 25.2, 25.5, 25.1, 25.3, 25.0],
      humidity: [47.7, 48.1, 47.5, 48.0, 47.8, 47.6],
      light: [1200, 1180, 1220, 1250, 1230, 1210],
      soil: [15.2, 15.5, 15.1, 14.8, 15.0, 15.3]
    },
    // 归一化后的历史数据高度（百分比）
    normalizedHistoryData: {},
    // 当前查看的历史数据类型
    currentHistoryType: 'temp'
  },

  refreshSensor: function(e) {
    const type = e.currentTarget.dataset.type;
    wx.vibrateShort({ type: 'light' });
    wx.showLoading({ title: '刷新中', mask: true });
    
    setTimeout(() => {
      wx.hideLoading();
      // Simulate value update
      let newVal;
      const oldVal = parseFloat(this.data.sensors[type].value);
      if (type === 'temp') newVal = (oldVal + (Math.random() - 0.5)).toFixed(1);
      else if (type === 'humidity') newVal = (oldVal + (Math.random() * 2 - 1)).toFixed(1);
      else if (type === 'soil') newVal = (oldVal + (Math.random() * 2 - 1)).toFixed(1);
      else newVal = Math.floor(oldVal + (Math.random() * 100 - 50));
      
      this.setData({
        [`sensors.${type}.value`]: newVal
      });
      wx.showToast({ title: '已更新', icon: 'success', duration: 800 });
    }, 500);
  },

  onLoad: function (options) {
    // 获取系统信息以适配状态栏
    const sysInfo = wx.getSystemInfoSync();
    
    // 计算归一化高度
    const normalizedData = this.calculateNormalizedHeight();
    
    this.setData({
      statusBarHeight: sysInfo.statusBarHeight,
      normalizedHistoryData: normalizedData
    });
    // 加载植物图片
    this.loadPlantImage();
    // 立即检查登录状态
    this.checkLoginStatus();
  },

  // 加载植物图片（适合免费版云开发）
  loadPlantImage: function() {
    // 免费版云开发无法设置图片为公开可读，使用网络图片替代
    const plantImages = [
      "https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=green%20plant%20in%20white%20pot%20minimal%20style&image_size=square",
      "https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=indoor%20plant%20succulent%20in%20pot&image_size=square",
      "https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=small%20bamboo%20plant%20in%20ceramic%20pot&image_size=square"
    ];
    
    // 随机选择一张图片，增加多样性
    const randomIndex = Math.floor(Math.random() * plantImages.length);
    const selectedImage = plantImages[randomIndex];
    
    wx.showLoading({ title: '加载图片中...' });
    
    // 验证图片是否可访问
    wx.getImageInfo({
      src: selectedImage,
      success: (res) => {
        console.log('网络图片加载成功');
        this.setData({ plantImage: selectedImage });
      },
      fail: (err) => {
        console.error('网络图片加载失败，使用默认图片', err);
        // 使用默认图片作为最终备用
        const defaultImage = "https://images.unsplash.com/photo-1485955900006-10f4d324d411?q=80&w=600&auto=format&fit=crop";
        this.setData({ plantImage: defaultImage });
      },
      complete: () => {
        wx.hideLoading();
      }
    });
  },

  onShow: function() {
    // 设置导航栏和执行动画 - 根据custom-tab-bar配置，首页是第1个tab，索引为0
    if (typeof this.getTabBar === 'function' &&
      this.getTabBar()) {
      this.getTabBar().setData({
        selected: 0
      })
    }
    this.startBubbleAnimation();
    
    // 每次显示页面都检查登录状态
    this.checkLoginStatus();
    this.loadTodos();
    this.loadDevices();
  },
  
  // 加载设备列表
  loadDevices: async function() {
    try {
      console.log('开始加载设备列表');
      const devices = await deviceService.getDevices();
      console.log('加载设备列表成功:', devices);
      this.setData({ devices });
    } catch (error) {
      console.error('加载设备列表失败:', error);
      this.setData({ devices: [] });
    }
  },
  
  // 检查登录状态
  checkLoginStatus: function() {
    // 先检查本地存储，确保状态最新
    app.checkLoginStatus();
    
    const { hasLogin } = app.globalData;
    console.log('Index checkLoginStatus:', hasLogin ? '已登录' : '未登录');
    
    if (!hasLogin) {
      // 使用app的统一跳转方法，避免重复跳转
      setTimeout(() => {
        app.gotoLoginPage();
      }, 100);
      return false;
    }
    return true;
  },
  /**
    * 加载待办事项
    */
  loadTodos: async function() {
     // 显示顶部导航栏的加载动画（比全屏 loading 更优雅）
     wx.showNavigationBarLoading();
     try {
       const todos = await todoService.getTodos();
       
       // 按照优先级排序
       todos.sort((a, b) => (a.urgent === b.urgent) ? 0 : a.urgent ? -1 : 1);
       
       this.setData({ todos });
       
       // 如果是第一次使用且为空，可以给个提示（可选）
       if (todos.length === 0) {
         console.log('暂无待办事项');
       }
     } catch (err) {
       console.error("加载待办失败", err);
       wx.showToast({
         title: '数据加载失败',
         icon: 'none'
       });
     } finally {
       // 无论成功失败，都要停止加载动画
       wx.hideNavigationBarLoading();
       // 停止下拉刷新动画（如果有的话）
       wx.stopPullDownRefresh();
     }
   },

  onHide: function() {
    // Clear animation interval if needed
  },

  startBubbleAnimation: function() {
    const animation = wx.createAnimation({
      duration: 2000,
      timingFunction: 'ease-in-out',
    });
    
    let up = true;
    setInterval(() => {
      if (up) {
        animation.translateY(-15).scale(1.1).step(); // Increased amplitude
      } else {
        animation.translateY(0).scale(1).step();
      }
      up = !up;
      this.setData({
        bubbleAnimation: animation.export()
      });
    }, 2000);
  },

addTodo: async function() {
    wx.vibrateShort({ type: 'light' });
    wx.showModal({
      title: '添加待办',
      placeholderText: '请输入任务内容',
      editable: true,
      success: async (res) => {
        if (res.confirm && res.content) {
          try {
            wx.showLoading({ title: '添加中...' });
            await todoService.addTodo(res.content);
            await this.loadTodos(); // 重新加载
            wx.hideLoading();
            wx.showToast({ title: '添加成功', icon: 'success' });
          } catch (err) {
            wx.hideLoading();
            wx.showToast({ title: '添加失败', icon: 'none' });
            console.error('添加待办失败:', err);
          }
        }
      }
    });
  },

  toggleUrgency: async function(e) {
    const id = e.currentTarget.dataset.id;
    const todo = this.data.todos.find(t => t._id === id || t.id === id); // 兼容旧数据和新数据（新数据用_id）
    
    if (!todo) return;

    wx.vibrateShort({ type: 'medium' });
    
    try {
      await todoService.toggleUrgency(todo);
      await this.loadTodos();
      wx.showToast({ title: '优先级已更新', icon: 'none' });
    } catch (err) {
      console.error("更新优先级失败", err);
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  onTaskDone: async function(e) {
    const id = e.currentTarget.dataset.id;
    const todo = this.data.todos.find(t => t._id === id || t.id === id);
    
    if (!todo) return;

    wx.vibrateShort({ type: 'light' });
    
    try {
      // 如果没有 _id（本地旧数据），直接在本地删除
      if (!todo._id) {
        const newTodos = this.data.todos.filter(t => t.id !== id);
        this.setData({ todos: newTodos });
      } else {
        await todoService.completeTodo(todo._id);
        await this.loadTodos();
      }
      
      wx.showToast({
        title: '任务已完成',
        icon: 'success'
      });
    } catch (err) {
      console.error("完成任务失败", err);
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  switchPlant: function() {
    wx.vibrateShort({ type: 'light' });
    wx.showActionSheet({
      itemList: ['Nova (办公室)', 'Luna (客厅)', '添加新植物'],
      success: (res) => {
        if (res.tapIndex === 0) {
          this.setData({ plantName: "Nova (办公室)" });
        } else if (res.tapIndex === 1) {
          this.setData({ plantName: "Luna (客厅)" });
        } else {
          wx.showToast({ title: '添加功能开发中', icon: 'none' });
        }
      }
    });
  },

  showPlantDetail: function() {
    wx.vibrateShort({ type: 'light' });
    wx.showModal({
      title: '芦荟 (Aloe Vera)',
      content: '多肉植物 · 独尾草科\n\n喜阴，耐旱，适宜温度 20-30℃。\n目前状态良好，光照适宜。',
      showCancel: false,
      confirmText: '我知道了',
      confirmColor: '#10B981'
    });
  },

  // Toggle ventilation fan
  toggleFan: function() {
    this.setData({
      'fan.isOn': !this.data.fan.isOn,
      'fan.desc': !this.data.fan.isOn ? '持续通风中' : '已关闭'
    });
    wx.vibrateShort(); // 触感反馈
  },

  // 显示历史数据模态框
  showHistory: function(e) {
    const type = e.currentTarget.dataset.type;
    wx.vibrateShort({ type: 'light' });
    
    // 计算归一化高度
    const normalizedData = this.calculateNormalizedHeight();
    
    this.setData({
      showHistoryModal: true,
      currentHistoryType: type,
      normalizedHistoryData: normalizedData
    });
  },

  // 关闭历史数据模态框
  closeHistoryModal: function() {
    wx.vibrateShort({ type: 'light' });
    this.setData({
      showHistoryModal: false
    });
  },

  // 停止事件冒泡
  stopPropagation: function() {},

  // 切换历史数据类型
  switchHistoryType: function(e) {
    const type = e.currentTarget.dataset.type;
    wx.vibrateShort({ type: 'light' });
    this.setData({
      currentHistoryType: type
    });
  },

  // 计算所有数据类型的归一化高度
  calculateNormalizedHeight: function() {
    const maxValues = {
      temp: 40,       // 温度最大值40°C
      humidity: 100,   // 湿度最大值100%
      light: 1500,     // 光照最大值1500lx
      soil: 100        // 土壤湿度最大值100%
    };
    
    const normalized = {};
    
    // 遍历所有数据类型
    for (const type in this.data.historyData) {
      normalized[type] = this.data.historyData[type].map(value => {
        const maxValue = maxValues[type] || 100;
        let height = (value / maxValue) * 100;
        // 限制在5-100%之间
        height = Math.max(5, Math.min(100, height));
        return height;
      });
    }
    
    return normalized;
  },

  // 切换设备
  switchDevice: async function(e) {
    const deviceIndex = e.currentTarget.dataset.index;
    const device = this.data.devices[deviceIndex];
    
    if (!device) return;
    
    wx.vibrateShort({ type: 'light' });
    
    try {
      // 调用设备服务激活设备
      await deviceService.activateDevice(device._id);
      
      // 更新本地设备状态
      const devices = [...this.data.devices];
      devices.forEach((d, index) => {
        d.active = index === deviceIndex;
      });
      
      this.setData({ devices });
      
      // 显示切换成功提示
      wx.showModal({
        title: '切换成功',
        content: `已切换到 ${device.name}`,
        showCancel: false,
        confirmText: '确定',
        confirmColor: '#10B981'
      });
    } catch (error) {
      console.error('切换设备失败:', error);
      wx.showToast({
        title: '切换设备失败',
        icon: 'none'
      });
    }
  },

  // 跳转到设备管理页面
  goToDeviceManagement: function() {
    wx.vibrateShort({ type: 'light' });
    wx.navigateTo({
      url: '/pages/device/device'
    });
  }
});
