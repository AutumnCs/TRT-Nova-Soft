const app = getApp();
const themeBehavior = require('../../services/modules/ThemeBehavior');

Page({
  behaviors: [themeBehavior],

  onShow() {
    this.syncTheme();
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
    }
  },

  data: {
    // ===== 静态 DEMO 数据（潮玩陈列展示） =====
    onSaleCount: 1,
    shelf: [
      { id: 'gold', badge: '新品', main: true, emoji: '🪴', hue: -100, name: '金边小绿 · 盛夏限定', sub: '08·30 上市 · 限量 500 体 · 附铭牌', price: '¥ 129' },
      { id: 'base', emoji: '🪴', name: '窗台小绿', sub: '常驻款 · 件件元气', price: '¥ 39' },
      { id: 'snow', emoji: '🪴', hue: 160, name: '霜绿小绿', sub: '雪夜限定 · 冬季上架', price: '¥ ??' },
      { id: 'soon', soon: true, name: '即将上架', sub: '敬请期待' }
    ],
    hero: {
      no: 'NOVA IP · NO.001',
      emoji: '🪴',
      name: '小绿',
      latin: 'Epipremnum aureum · 绿萝',
      quote: '「浇浇水，就长大！」',
      facts: [
        { k: '性格', v: '活泼 · 有点粘人 · 怕晒黑' },
        { k: '出道', v: '2026 · 7 · 15 窗台苗圃' }
      ],
      stats: [
        { green: true, text: '陪伴 42 天' },
        { text: '好感 86' }
      ]
    },
    belt: [
      { key: 'lit', tag: '持有', type: 'lit', emoji: '🪴', name: '窗台小绿', desc: '常驻 · 元气款' },
      { key: 'gold', tag: '限定', type: 'limited', emoji: '🪴', hue: -100, name: '金边小绿', desc: '盛夏 · 08·30' },
      { key: 'snow', tag: '限定', type: 'limited', emoji: '🪴', hue: 160, name: '霜绿小绿', desc: '雪夜 · 冬季' },
      { key: 'unknown', tag: '隐藏', type: 'unknown', emoji: '🪴', name: '？？？', desc: '集齐两限定' }
    ],
    drop: {
      kicker: 'MIDNIGHT DROP · 午夜首发',
      emoji: '🪴',
      hue: -100,
      name: '金边小绿',
      metas: [
        { gold: true, text: '08·30 · 00:00' },
        { gold: true, text: '限量 500 体' },
        { text: '距首发 2 天' }
      ]
    },
    star: {
      no: 'TRT NOVA · IP COLLECTION 001',
      emoji: '🪴',
      name: '小绿',
      latin: 'Epipremnum aureum · 绿萝',
      tag: '「白天晒太阳，夜里陪着守夜人——一盆会呼吸的夜巡同伴。」',
      metas: [
        { gold: true, text: '开心值 86' },
        { green: true, text: '陪伴 42 天' },
        { text: '夜行性 +1' }
      ]
    },
    archive: [
      { k: '出生', v: '2026 · 7 · 15，从窗台苗圃的一枝扦插开始' },
      { k: '性格', v: '活泼 · 有点粘人 · 怕晒黑' },
      { k: '口头禅', v: '「浇浇水，就长大！」' },
      { k: '喜欢', v: '湿润的早晨 · 被擦叶子 · 26℃ 散射光' },
      { k: '讨厌', v: '正午直射光 · 盆里积水 · 长途旅行' },
      { k: '现状', hl: '好感 86', v: ' · 陪伴 42 天 · 灵魂状态元气满满' }
    ],
    originOpen: false,
    originText: '小绿出生在植愈星球的一间窗台苗圃。某个清晨，一枝绿萝扦插在 26℃ 的散射光里发了芽，NOVA 给了它一颗会撒娇的心——从此它不再只是一盆绿植，而是这个家的小小成员。夜里它不睡，是为了替守夜的你，留一点绿色的呼吸声。',
    wins: [
      { key: 'lit', label: '已点亮', type: 'lit', emoji: '🪴', name: '窗台小绿', sub: '常驻 · 园丁的第一位伙伴' },
      { key: 'gold', label: '待点亮', type: 'limited', emoji: '🪴', hue: -100, name: '金边小绿', sub: '盛夏限定 · 集齐 3 个称号' },
      { key: 'snow', label: '待点亮', type: 'limited snow', emoji: '🪴', hue: 160, name: '霜绿小绿', sub: '雪夜限定 · 冬季窗台' },
      { key: 'unknown', label: '???', type: 'unknown', emoji: '🪴', name: '？？？', sub: '隐藏 · 集齐两件限定后开启' }
    ]
  },

  onLoad() {
    this.setData({ statusBarHeight: this.getHeaderTop(), theme: app.globalData.theme || 'light' });
  },

  onShelfTap(e) {
    const { id } = e.currentTarget.dataset;
    if (id === 'soon') {
      wx.showToast({ title: '敬请期待', icon: 'none' });
    }
  },

  onRemind() {
    wx.vibrateShort({ type: 'light' });
    wx.showToast({ title: '已设开售提醒（DEMO）', icon: 'none' });
  },

  toggleOrigin() {
    this.setData({ originOpen: !this.data.originOpen });
  }
});
