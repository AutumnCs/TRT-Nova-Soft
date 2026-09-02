/**
 * 主题 Behavior · 双主题（浅色元气日光 / 深色萤火温室）
 * 页面用法：
 *   const themeBehavior = require('../../services/modules/ThemeBehavior');
 *   Page({ behaviors: [themeBehavior], ... })
 * 根节点： <view class="container {{theme === 'dark' ? 'theme-dark' : ''}}">
 *
 * 主题同步机制：switchTab 会替换页面栈，跨页广播无效，
 * 因此各页面在自己的 onShow 里调用 syncTheme()（本 Behavior 提供）。
 */
/**
 * 计算页面内容安全顶部：胶囊（···/退出）底边 + 8px 间距。
 * 自定义导航页用此值做 padding-top，避免顶栏按钮与胶囊重叠。
 */
function getHeaderTop() {
  try {
    const rect = wx.getMenuButtonBoundingClientRect();
    if (rect && rect.bottom) {
      return rect.bottom + 8;
    }
  } catch (err) { /* 部分环境无胶囊信息，走估算 */ }
  let statusBarHeight = 20;
  try {
    if (typeof wx.getWindowInfo === 'function') {
      statusBarHeight = wx.getWindowInfo().statusBarHeight || 20;
    } else {
      statusBarHeight = wx.getSystemInfoSync().statusBarHeight || 20;
    }
  } catch (err) { /* 保底 20 */ }
  return statusBarHeight + 44;
}

function applyNavBar(theme) {
  const dark = theme === 'dark';
  try {
    wx.setNavigationBarColor({
      frontColor: dark ? '#ffffff' : '#000000',
      backgroundColor: dark ? '#0C1410' : '#F7F5EE',
      animation: { duration: 200 }
    });
  } catch (err) { /* 自定义导航页会失败，忽略 */ }
  // 窗口背景（下拉刷新/页面切换时露出）跟随主题，避免深色下拉闪出一截浅色
  try {
    wx.setBackgroundColor({
      backgroundColor: dark ? '#0C1410' : '#F7F5EE',
      // iOS 顶部/底部窗口区域（自定义导航页转场时也会露出）一并同步
      backgroundColorTop: dark ? '#0C1410' : '#F7F5EE',
      backgroundColorBottom: dark ? '#0C1410' : '#F7F5EE'
    });
  } catch (err) { /* 部分环境不支持，忽略 */ }
}

/**
 * 在内存中的页面注册表：切主题时把驻留后台的 tab 页一并换肤，
 * 避免 switchTab 切过去时先闪一帧旧主题（“闪光弹”感）。
 */
const livePages = [];

/**
 * 页面 JS 模块首次执行时（即该页面首次创建前）读取全局主题。
 * 这样 data.theme 的初始值在首帧渲染前就是正确主题，
 * 彻底消除真机上“首帧浅色 → 第二帧深色”的闪烁
 * （attached 里的 setData 在真机上可能与首帧竞争，不够稳）。
 */
function initialTheme() {
  try {
    const app = typeof getApp === 'function' ? getApp() : null;
    return (app && app.globalData && app.globalData.theme) || 'light';
  } catch (err) {
    return 'light';
  }
}

/**
 * 模块加载时求一次安全顶部高度（设备级常量）。
 * 提供给页面初始 data，使「初始渲染缓存」的原生首帧与真实渲染一致，
 * 避免缓存帧 padding 20px → 真实 ~88px 的顶部跳变。
 */
const initialStatusBarHeight = getHeaderTop();

const themeBehavior = Behavior({
  data: {
    theme: initialTheme(),
    statusBarHeight: initialStatusBarHeight,
    // ready 门控：根容器 wx:if="{{ready}}" 初始不渲染，
    // 等 onShow 的 syncTheme 确认主题后放行整树（首帧不出现旧主题画面）
    ready: false
  },

  lifetimes: {
    // 兜底：模块缓存复用（页面销毁后重开）时 data 初始值可能是旧主题快照，在此修正；
    // 同时提前设置本页窗口底为新主题色（ready 门控期间首帧露出的是窗口底）
    attached() {
      const theme = (getApp().globalData && getApp().globalData.theme) || 'light';
      if (theme !== this.data.theme) {
        this.setData({ theme });
      }
      applyNavBar(theme);
      livePages.push(this);
    },
    detached() {
      const i = livePages.indexOf(this);
      if (i > -1) livePages.splice(i, 1);
    }
  },

  methods: {
    // 胶囊（···/退出）底边 + 8px：自定义导航页的安全顶部
    getHeaderTop() {
      return getHeaderTop();
    },

    // 页面 onShow 中调用：从全局读取最新主题并同步（含 tab 栏配色）
    syncTheme() {
      // 注册到在册页面表：onShow 必然触发（不依赖 Behavior lifetimes，那在 Page 上不可靠），
      // 保证被访问过的页面都能收到 toggleTheme 的换肤广播
      if (livePages.indexOf(this) === -1) livePages.push(this);
      const theme = (getApp().globalData && getApp().globalData.theme) || 'light';
      if (this.data.theme !== theme || !this.data.ready) {
        // theme 与 ready 同帧放行：根容器从“不渲染”直接进入正确主题，
        // 任何时序下都不会出现旧主题画面
        this.setData({ theme, ready: true });
      }
      if (typeof this.getTabBar === 'function') {
        const bar = this.getTabBar();
        if (bar) {
          // 前台时缓存 tab 栏引用：后台页的 getTabBar() 不可靠，
          // 切主题广播需用缓存引用直接更新后台页的 tab 栏数据
          this._tabBar = bar;
          if (bar.data.theme !== theme) {
            bar.setData({ theme });
          }
        }
      }
      applyNavBar(theme);
    },

    toggleTheme() {
      const next = this.data.theme === 'dark' ? 'light' : 'dark';
      const app = getApp();
      app.globalData.theme = next;
      try {
        wx.setStorageSync('theme', next);
      } catch (err) {
        console.warn('[theme] storage error:', err);
      }
      // 先把当前页窗口底切到新主题色（reLaunch 转场露出的即为新色，非旧色）
      applyNavBar(next);
      // 完全清缓存：销毁整个页面栈按新主题重建。
      // 真机后台页 WebView 渲染挂起，广播 setData 无法让挂起页提前重绘，
      // 切回时先绘制挂起前的旧主题帧再应用更新（“先旧后新”闪一次）。
      // reLaunch 清栈重建后，所有页面首帧即新主题（attached 窗口底 + ready 门控保证）。
      const pages = getCurrentPages();
      const current = pages[pages.length - 1];
      if (!current) return;
      const route = current.route || current.__route__;
      if (!route) return;
      let url = '/' + route;
      const options = current.options || {};
      const qs = Object.keys(options)
        .filter((k) => options[k] !== undefined && options[k] !== null && options[k] !== '')
        .map((k) => k + '=' + options[k])
        .join('&');
      if (qs) url += '?' + qs;
      wx.reLaunch({ url });
    }
  }
});

module.exports = themeBehavior;
