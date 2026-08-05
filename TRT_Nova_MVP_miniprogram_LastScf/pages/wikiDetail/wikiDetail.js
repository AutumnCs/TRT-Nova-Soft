const app = getApp();
const knowledgeService = require('../../services/modules/KnowledgeService');
const todoService = require('../../services/modules/TodoService');

const CATEGORY_LABELS = {
  'plant-care': '养护知识',
  'device-protocol': '字段解释',
  'system-rule': '系统规则',
  'usage-guide': '使用指南'
};

function getStatusBarHeight() {
  if (typeof wx.getWindowInfo === 'function') {
    return wx.getWindowInfo().statusBarHeight || 20;
  }
  return wx.getSystemInfoSync().statusBarHeight || 20;
}

function formatArticleContext(article = {}) {
  return {
    id: article.id,
    slug: article.slug,
    title: article.title,
    summary: article.summary,
    content: article.content,
    category: article.category,
    tags: article.tags || [],
    plantTypes: article.plantTypes || [],
    problemTypes: article.problemTypes || [],
    sourceRef: article.sourceRef || ''
  };
}

Page({
  data: {
    statusBarHeight: 20,
    loading: true,
    article: null
  },

  onLoad(options = {}) {
    this.setData({
      statusBarHeight: getStatusBarHeight()
    });
    if (!this.checkLoginStatus()) return;
    this.loadArticle(options.articleId || '');
  },

  checkLoginStatus() {
    app.checkLoginStatus();
    if (!app.globalData.hasLogin) {
      setTimeout(() => {
        wx.redirectTo({ url: '/pages/auth/auth' });
      }, 100);
      return false;
    }
    return true;
  },

  async loadArticle(articleId) {
    this.setData({ loading: true });
    try {
      const res = await knowledgeService.getArticle(articleId);
      if (!res?.article) {
        wx.showToast({ title: '文章不存在', icon: 'none' });
        setTimeout(() => wx.navigateBack({ delta: 1 }), 300);
        return;
      }

      this.setData({
        article: {
          ...res.article,
          displayCategory: CATEGORY_LABELS[res.article.category] || res.article.category || '知识文章',
          displaySourceType: res.article.sourceType === 'seed' ? '种子内容' : (res.article.sourceType || '来源')
        },
        loading: false
      });
    } catch (err) {
      console.error('[wikiDetail] loadArticle failed:', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  goBack() {
    wx.navigateBack({ delta: 1 });
  },

  openAssistant() {
    const article = this.data.article;
    if (!article) return;

    wx.setStorageSync('nvp_pending_assistant_context', formatArticleContext(article));
    wx.navigateTo({ url: '/pages/assistant/assistant' });
  },

  async addReminder() {
    const article = this.data.article;
    if (!article) return;

    try {
      wx.showLoading({ title: '添加中...' });
      await todoService.addTodo(`阅读并跟进：${article.title}`, 'global');
      wx.showToast({ title: '已加入提醒', icon: 'success' });
    } catch (err) {
      console.error('[wikiDetail] addReminder failed:', err);
      wx.showToast({ title: '添加失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  }
});
