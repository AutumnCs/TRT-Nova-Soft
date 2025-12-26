const app = getApp()

Page({
  data: {
    statusBarHeight: 20, // 默认值，会被 onLoad 覆盖
    navBarHeight: 44,
    plantName: "Nova (办公室)",
    plantImage: "https://images.unsplash.com/photo-1485955900006-10f4d324d411?q=80&w=600&auto=format&fit=crop",
    userImage: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?q=80&w=100&auto=format&fit=crop",
    dialogue: "主人，我的土壤有点干了，可以给我喝点水吗？💧",
    todos: [
      {
        id: 1,
        title: "补充储水盒水量",
        urgent: true,
        icon: "💧",
        iconColor: "text-red-500",
        iconBg: "bg-red-50",
        desc: "建议立即执行",
        status: "pending"
      },
      {
        id: 2,
        title: "施肥 (氮肥)",
        urgent: false,
        icon: "🍃",
        iconColor: "text-blue-500",
        iconBg: "bg-blue-50",
        desc: "计划：3天后",
        status: "pending"
      }
    ],
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
  },

  onShow: function() {
    if (typeof this.getTabBar === 'function' &&
      this.getTabBar()) {
      this.getTabBar().setData({
        selected: 0
      })
    }
    this.startBubbleAnimation();
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
      success: (res) => {
        if (res.confirm && res.content) {
          const newTodo = {
            id: Date.now(),
            title: res.content,
            urgent: false,
            icon: "📝",
            iconColor: "text-blue-500",
            iconBg: "bg-blue-50",
            desc: "长按切换优先级",
            status: "pending"
          };
          this.setData({
            todos: [newTodo, ...this.data.todos]
          });
          wx.showToast({ title: '添加成功', icon: 'success' });
        }
      }
    });
  },

  toggleUrgency: function(e) {
    const id = e.currentTarget.dataset.id;
    wx.vibrateShort({ type: 'medium' });
    
    const updatedTodos = this.data.todos.map(todo => {
      if (todo.id === id) {
        return {
          ...todo,
          urgent: !todo.urgent,
          desc: !todo.urgent ? "高优先级" : "普通优先级",
          iconColor: !todo.urgent ? "text-red-500" : "text-blue-500",
          iconBg: !todo.urgent ? "bg-red-50" : "bg-blue-50"
        };
      }
      return todo;
    });

    // Sort: Urgent first
    updatedTodos.sort((a, b) => (a.urgent === b.urgent) ? 0 : a.urgent ? -1 : 1);

    this.setData({ todos: updatedTodos });
    wx.showToast({ title: '优先级已更新', icon: 'none' });
  },

  onTaskDone: function(e) {
    const id = e.currentTarget.dataset.id;
    wx.vibrateShort({ type: 'light' });
    
    // Filter out the completed task
    const newTodos = this.data.todos.filter(todo => todo.id !== id);
    
    this.setData({
      todos: newTodos
    });

    // Feedback
    wx.showToast({
      title: '任务已完成',
      icon: 'success'
    });
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
