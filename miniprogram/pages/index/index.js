const app = getApp()
const todoService = require('../../services/modules/TodoService');


Page({
  data: {
    statusBarHeight: 20, // 默认值，会被 onLoad 覆盖
    navBarHeight: 44,
    plantName: "Nova (办公室)",
    plantImage: "https://images.unsplash.com/photo-1485955900006-10f4d324d411?q=80&w=600&auto=format&fit=crop",
    userImage: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?q=80&w=100&auto=format&fit=crop",
    dialogue: "主人，我的土壤有点干了，可以给我喝点水吗？💧",
    todos: [],// 初始化为空，等待从数据库加载
    sensors: {
      temp: { value: "25.4", unit: "°C", label: "环境温度", status: "normal" },
      light: { value: "1200", unit: "lx", label: "环境光照", status: "normal" },
      humidity: { value: "47.7", unit: "%", label: "环境湿度", status: "normal" },
      soil: { value: "15.2", unit: "%", label: "土壤过干", status: "warning" }
    }
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
    this.setData({
      statusBarHeight: sysInfo.statusBarHeight
    });
    
    // 立即检查登录状态
    this.checkLoginStatus();
  },

  onShow: function() {
    // 设置导航栏和执行动画
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

addTodo: function() {
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
            console.error(err);
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
  }
});
