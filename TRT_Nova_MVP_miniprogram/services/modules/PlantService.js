const ScfApiAdapter = require('../core/ScfApiAdapter');

/**
 * PlantService
 * 植物库 + 用户收藏，数据源为服务端 plant_library / user_plant_favorites 表。
 * 本地 data/plants.js 仅作离线兜底。
 */
class PlantService {
  constructor() {
    this.scfApiAdapter = new ScfApiAdapter();
  }

  /**
   * 拉取植物库（含当前用户收藏标记，收藏在前）
   * @returns {Promise<{ plants: Array }>}
   */
  async getPlants() {
    const res = await this.scfApiAdapter.getPlantLibrary();
    const plants = res?.plants || [];
    // 收藏在前，其余按 sort_order（服务端已排好序）
    return {
      success: true,
      plants: [
        ...plants.filter(p => p.isFavorite),
        ...plants.filter(p => !p.isFavorite)
      ]
    };
  }

  /**
   * 切换收藏状态
   * @param {number} plantId
   * @returns {Promise<{ success: boolean, plantId: number, isFavorite: boolean }>}
   */
  async toggleFavorite(plantId) {
    return this.scfApiAdapter.togglePlantFavorite(plantId);
  }
}

module.exports = new PlantService();
