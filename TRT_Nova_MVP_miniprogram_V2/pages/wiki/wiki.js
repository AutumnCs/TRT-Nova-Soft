const app = getApp();
const knowledgeService = require('../../services/modules/KnowledgeService');
const plantService = require('../../services/modules/PlantService');
const themeBehavior = require('../../services/modules/ThemeBehavior');

const CATEGORY_LABELS = {
  all: '全部',
  'plant-care': '养护知识',
  'device-protocol': '字段解释',
  'system-rule': '系统规则',
  'usage-guide': '使用指南'
};

function countMap(items = []) {
  const map = new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const key = String(item || '').trim();
    if (!key) return;
    map.set(key, (map.get(key) || 0) + 1);
  });
  return map;
}

function containsKeyword(parts = [], keyword = '') {
  const text = String(keyword || '').trim().toLowerCase();
  if (!text) return true;
  return parts.some((item) => String(item || '').toLowerCase().includes(text));
}

Page({
  behaviors: [themeBehavior],

  data: {
    currentMode: 'articles',
    loading: false,
    plantLoading: false,
    hasLoaded: false,
    articles: [],
    filteredArticles: [],
    plants: [],
    filteredPlants: [],
    searchKeyword: '',
    countText: '0 篇文章',
    searchPlaceholder: '搜索养护、字段、规则、问题',
    activeCategory: 'all',
    categories: [{ value: 'all', label: '全部' }],
    stats: {
      articleCount: 0,
      categoryCount: 0,
      tagCount: 0
    },
    plantStats: {
      count: 0
    }
  },

  onLoad() {
    this.setData({ statusBarHeight: this.getHeaderTop(), theme: app.globalData.theme || 'light' });
    this.checkLoginStatus();
  },

  onShow() {
    this.syncTheme();
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 });
    }
    if (!this.checkLoginStatus()) return;
    this.data.currentMode === 'plants' ? this.loadPlants() : this.loadKnowledge();
  },

  checkLoginStatus() {
    app.checkLoginStatus();
    if (!app.globalData.hasLogin) {
      setTimeout(() => app.gotoLoginPage(), 80);
      return false;
    }
    return true;
  },

  decorateArticles(articles = []) {
    return (Array.isArray(articles) ? articles : []).map((item) => ({
      ...item,
      displayCategory: CATEGORY_LABELS[item.category] || item.category || '知识文章'
    }));
  },

  async loadKnowledge() {
    if (!this.data.hasLoaded) {
      this.setData({ loading: true });
    }

    try {
      const res = await knowledgeService.getArticles({ useCache: false });
      const articles = this.decorateArticles(Array.isArray(res?.articles) ? res.articles : []);
      this.setData({
        articles,
        hasLoaded: true,
        loading: false,
        countText: `${articles.length} 篇文章`
      });
      this.rebuildArticleMeta(articles);
      this.applyFilters();
    } catch (err) {
      console.error('[wiki] loadKnowledge failed:', err);
      this.setData({
        articles: [],
        hasLoaded: true,
        loading: false,
        countText: '0 篇文章'
      });
      this.rebuildArticleMeta([]);
      this.applyFilters();
    }
  },

  async loadPlants() {
    if (this.data.plants.length > 0) {
      this.applyFilters();
      return;
    }

    this.setData({ plantLoading: true });
    try {
      const res = await plantService.getPlants({ useCache: true });
      const plants = Array.isArray(res?.plants) ? res.plants : [];
      this.setData({
        plants,
        plantLoading: false,
        plantStats: { count: plants.length },
        countText: `${plants.length} 种植物`
      });
      this.applyFilters();
    } catch (err) {
      console.error('[wiki] loadPlants failed:', err);
      const plants = plantService.getFallbackPlants();
      this.setData({
        plants,
        plantLoading: false,
        plantStats: { count: plants.length },
        countText: `${plants.length} 种植物`
      });
      this.applyFilters();
    }
  },

  rebuildArticleMeta(articles = []) {
    const categoryCounts = countMap(articles.map((item) => item.category));
    const tagCounts = countMap(articles.flatMap((item) => item.tags || []));
    const categories = ['all'].concat(Array.from(categoryCounts.keys())).map((value) => ({
      value,
      label: CATEGORY_LABELS[value] || value
    }));

    this.setData({
      categories,
      stats: {
        articleCount: articles.length,
        categoryCount: Math.max(0, categories.length - 1),
        tagCount: tagCounts.size
      }
    });
  },

  onSearch(e) {
    this.setData({ searchKeyword: String(e.detail.value || '').trim() });
    this.applyFilters();
  },

  clearFilters() {
    this.setData({
      searchKeyword: '',
      activeCategory: 'all'
    });
    this.applyFilters();
  },

  switchToArticles() {
    this.setData({
      currentMode: 'articles',
      searchKeyword: '',
      activeCategory: 'all',
      searchPlaceholder: '搜索养护、字段、规则、问题',
      countText: `${this.data.articles.length} 篇文章`
    });
    this.loadKnowledge();
  },

  switchToPlants() {
    this.setData({
      currentMode: 'plants',
      searchKeyword: '',
      activeCategory: 'all',
      searchPlaceholder: '搜索植物名称、科属、特征',
      countText: `${this.data.plants.length} 种植物`
    });
    this.loadPlants();
  },

  setCategory(e) {
    this.setData({ activeCategory: e.currentTarget.dataset.category || 'all' });
    this.applyFilters();
  },

  applyFilters() {
    const keyword = this.data.searchKeyword;

    if (this.data.currentMode === 'plants') {
      const filteredPlants = (this.data.plants || []).filter((plant) =>
        containsKeyword([
          plant.name,
          plant.family,
          plant.scientificName,
          plant.featureText,
          plant.description,
          ...(Array.isArray(plant.tags) ? plant.tags : [])
        ], keyword)
      );
      this.setData({ filteredPlants });
      return;
    }

    const filteredArticles = (this.data.articles || []).filter((article) => {
      if (this.data.activeCategory !== 'all' && article.category !== this.data.activeCategory) {
        return false;
      }
      return containsKeyword([
        article.title,
        article.summary,
        article.content,
        article.category,
        ...(Array.isArray(article.tags) ? article.tags : []),
        ...(Array.isArray(article.aliases) ? article.aliases : []),
        ...(Array.isArray(article.plantTypes) ? article.plantTypes : []),
        ...(Array.isArray(article.problemTypes) ? article.problemTypes : [])
      ], keyword);
    });

    this.setData({ filteredArticles });
  },

  openArticle(e) {
    const articleId = e.currentTarget.dataset.id;
    if (!articleId) return;
    wx.navigateTo({
      url: `/pages/wikiDetail/wikiDetail?articleId=${encodeURIComponent(articleId)}`
    });
  }
});
