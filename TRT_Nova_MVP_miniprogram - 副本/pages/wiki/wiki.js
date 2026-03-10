const app = getApp()

Page({
  data: {
    statusBarHeight: 20,
    // 植物列表数据
    plants: [
      {
        id: 1,
        name: '龟背竹',
        family: '天南星科・龟背竹属',
        feature: 'partial-shade',
        featureText: '半阴',
        image: 'https://images.unsplash.com/photo-1509423355108-74d6920d986b?q=80&w=600&auto=format&fit=crop',
        isFavorite: false,
        category: 'foliage',
        scientificName: 'Monstera deliciosa',
        tags: ['常绿植物', '净化空气', '新手友好'],
        description: '原生生于热带雨林，具有独特的孔洞叶片，极具观赏性。',
        care: {
          light: '半阴或明亮散光',
          water: '干透浇透，避积水'
        }
      },
      {
        id: 2,
        name: '多肉・玉露',
        family: '独尾草科・瓦苇属',
        feature: 'avoid-sun',
        featureText: '忌暴晒',
        image: 'https://images.unsplash.com/photo-1518676590629-3dcbd9c5a5c9?q=80&w=600&auto=format&fit=crop',
        isFavorite: true,
        category: 'succulent',
        scientificName: 'Haworthia cooperi',
        tags: ['多肉植物', '耐旱', '小型盆栽'],
        description: '叶片晶莹剔透，形如露珠，是多肉植物中的珍品。',
        care: {
          light: '散射光，忌强光直射',
          water: '干透浇透，冬季少水'
        }
      },
      {
        id: 3,
        name: '天堂鸟',
        family: '旅人蕉科・鹤望兰属',
        feature: 'sun-loving',
        featureText: '喜阳光',
        image: 'https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?q=80&w=600&auto=format&fit=crop',
        isFavorite: false,
        category: 'foliage',
        scientificName: 'Strelitzia reginae',
        tags: ['观花植物', '大型盆栽', '喜温暖'],
        description: '花朵形如仙鹤，姿态优美，是室内外装饰的佳品。',
        care: {
          light: '充足阳光，每天至少4小时',
          water: '保持土壤湿润，避免积水'
        }
      },
      {
        id: 4,
        name: '银斑葛',
        family: '天南星科・麒麟叶属',
        feature: 'shade-tolerant',
        featureText: '耐阴',
        image: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?q=80&w=600&auto=format&fit=crop',
        isFavorite: false,
        category: 'foliage',
        scientificName: 'Scindapsus pictus',
        tags: ['藤蔓植物', '净化空气', '耐阴'],
        description: '叶片带有银色斑点，富有质感，适合悬挂栽培。',
        care: {
          light: '低光到中等光照，忌强光',
          water: '保持土壤微湿，避免干燥'
        }
      }
    ],
    // 状态管理
    filteredPlants: [],
    activeCategory: 'all',
    searchKeyword: '',
    showDetail: false,
    currentPlant: null,
    showMore: false
  },

  onLoad: function (options) {
    const sysInfo = wx.getSystemInfoSync();
    
    // 先设置statusBarHeight，确保页面正常渲染
    this.setData({
      statusBarHeight: sysInfo.statusBarHeight
    });
    
    // 延迟初始化数据，确保页面渲染完成
    setTimeout(() => {
      this.setData({
        filteredPlants: this.data.plants,
        showDetail: false,
        currentPlant: null,
        showMore: false
      });
    }, 100);
    
    // 检查登录状态 - 但不阻止页面渲染
    this.checkLoginStatus();
  },

  onShow: function() {
    // 设置导航栏 - 根据custom-tab-bar配置，社区页是第2个tab，索引为1
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 })
    }
    
    // 每次显示页面都检查登录状态
    this.checkLoginStatus();
  },
  
  // 检查登录状态
  checkLoginStatus: function() {
    // 先检查本地存储，确保状态最新
    app.checkLoginStatus();
    
    const { hasLogin } = app.globalData;
    if (!hasLogin) {
      // 如果未登录，跳转到登录页面
      // 使用setTimeout延迟跳转，避免渲染冲突
      setTimeout(() => {
        wx.redirectTo({
          url: '/pages/auth/auth'
        });
      }, 100);
      return false;
    }
    return true;
  },

  // 搜索功能
  onSearch: function(e) {
    const keyword = e.detail.value.toLowerCase();
    this.setData({ searchKeyword: keyword });
    this.filterPlants();
  },

  // 切换分类
  switchCategory: function(e) {
    const category = e.currentTarget.dataset.category;
    this.setData({ activeCategory: category });
    this.filterPlants();
  },

  // 筛选植物
  filterPlants: function() {
    let filtered = this.data.plants;
    
    // 按分类筛选
    if (this.data.activeCategory === 'favorites') {
      filtered = filtered.filter(plant => plant.isFavorite);
    } else if (this.data.activeCategory !== 'all') {
      filtered = filtered.filter(plant => plant.category === this.data.activeCategory);
    }
    
    // 按关键词搜索
    if (this.data.searchKeyword) {
      const keyword = this.data.searchKeyword;
      filtered = filtered.filter(plant => 
        plant.name.toLowerCase().includes(keyword) ||
        plant.family.toLowerCase().includes(keyword) ||
        plant.featureText.toLowerCase().includes(keyword)
      );
    }
    
    this.setData({ filteredPlants: filtered });
  },

  // 切换收藏状态
  toggleFavorite: function(e) {
    const id = e.currentTarget.dataset.id;
    e.stopPropagation(); // 阻止事件冒泡到卡片点击
    
    wx.vibrateShort({ type: 'light' });
    
    const plants = this.data.plants.map(plant => {
      if (plant.id === id) {
        return {
          ...plant,
          isFavorite: !plant.isFavorite
        };
      }
      return plant;
    });
    
    this.setData({ plants });
    this.filterPlants();
  },

  // 显示植物详情
  showPlantDetail: function(e) {
    const id = e.currentTarget.dataset.id;
    const plant = this.data.plants.find(p => p.id === id);
    
    wx.vibrateShort({ type: 'light' });
    
    this.setData({
      showDetail: true,
      currentPlant: plant,
      showMore: false
    });
  },

  // 关闭详情页
  closeDetail: function() {
    wx.vibrateShort({ type: 'light' });
    this.setData({
      showDetail: false,
      currentPlant: null,
      showMore: false
    });
  },

  // 切换更多资料显示
  toggleMore: function() {
    this.setData({
      showMore: !this.data.showMore
    });
  },

  // 加入养护提醒
  addReminder: function() {
    wx.vibrateShort({ type: 'medium' });
    wx.showToast({
      title: '已加入养护提醒',
      icon: 'success'
    });
  }
})