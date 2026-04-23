const ScfApiAdapter = require('../core/ScfApiAdapter');

class PlantService {
  constructor() {
    this.scfApiAdapter = new ScfApiAdapter();
    this._cachedPlants = [];
  }

  async getPlants(options = {}) {
    const { useCache = true } = options;

    if (useCache && this._cachedPlants.length > 0) {
      return {
        success: true,
        plants: this._cachedPlants.slice()
      };
    }

    const res = await this.scfApiAdapter.getPlantLibrary();
    const plants = Array.isArray(res?.plants) ? res.plants : [];
    const sortedPlants = [
      ...plants.filter((item) => item.isFavorite),
      ...plants.filter((item) => !item.isFavorite)
    ];

    this._cachedPlants = sortedPlants.slice();

    return {
      success: true,
      plants: sortedPlants
    };
  }

  getCachedPlants() {
    return this._cachedPlants.slice();
  }

  async toggleFavorite(plantId) {
    const result = await this.scfApiAdapter.togglePlantFavorite(plantId);
    if (result?.success) {
      this._cachedPlants = this._cachedPlants.map((plant) =>
        plant.id === plantId ? { ...plant, isFavorite: result.isFavorite } : plant
      );
      this._cachedPlants = [
        ...this._cachedPlants.filter((item) => item.isFavorite),
        ...this._cachedPlants.filter((item) => !item.isFavorite)
      ];
    }
    return result;
  }
}

module.exports = new PlantService();
