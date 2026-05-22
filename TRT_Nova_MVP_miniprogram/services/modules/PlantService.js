const ScfApiAdapter = require('../core/ScfApiAdapter');
const { PLANTS } = require('../../data/plants');

class PlantService {
  constructor() {
    this.scfApiAdapter = new ScfApiAdapter();
    this._cachedPlants = [];
  }

  countPlantCompleteness(plant = {}) {
    const care = plant.care && typeof plant.care === 'object' ? plant.care : {};
    return [
      plant.image,
      plant.description,
      plant.family,
      plant.scientificName,
      plant.featureText,
      plant.difficulty,
      care.light,
      care.water,
      care.temperature,
      care.humidity,
      care.soil,
      care.fertilizer,
      care.ventilation,
      Array.isArray(plant.tags) && plant.tags.length ? 'tags' : '',
      Array.isArray(plant.aliases) && plant.aliases.length ? 'aliases' : '',
      Array.isArray(plant.commonIssues) && plant.commonIssues.length ? 'issues' : '',
      Array.isArray(plant.faq) && plant.faq.length ? 'faq' : '',
      Array.isArray(plant.recommendQuestions) && plant.recommendQuestions.length ? 'recommend' : '',
      plant.agentNotes
    ].filter(Boolean).length;
  }

  normalizePlant(plant = {}) {
    const care = plant.care && typeof plant.care === 'object' ? plant.care : {};
    return {
      id: Number(plant.id) || 0,
      name: String(plant.name || '').trim(),
      aliases: Array.isArray(plant.aliases) ? plant.aliases.filter(Boolean) : [],
      family: String(plant.family || '').trim(),
      scientificName: String(plant.scientificName || '').trim(),
      feature: String(plant.feature || '').trim(),
      featureText: String(plant.featureText || '').trim(),
      category: String(plant.category || '').trim(),
      image: String(plant.image || '').trim(),
      tags: Array.isArray(plant.tags) ? plant.tags.filter(Boolean) : [],
      description: String(plant.description || '').trim(),
      difficulty: String(plant.difficulty || '').trim(),
      care: {
        light: String(care.light || '').trim(),
        water: String(care.water || '').trim(),
        temperature: String(care.temperature || '').trim(),
        humidity: String(care.humidity || '').trim(),
        soil: String(care.soil || '').trim(),
        fertilizer: String(care.fertilizer || '').trim(),
        ventilation: String(care.ventilation || '').trim()
      },
      commonIssues: Array.isArray(plant.commonIssues) ? plant.commonIssues : [],
      faq: Array.isArray(plant.faq) ? plant.faq : [],
      recommendQuestions: Array.isArray(plant.recommendQuestions) ? plant.recommendQuestions : [],
      deviceInterpretation: plant.deviceInterpretation && typeof plant.deviceInterpretation === 'object'
        ? plant.deviceInterpretation
        : {},
      agentNotes: String(plant.agentNotes || '').trim(),
      isFavorite: Boolean(plant.isFavorite)
    };
  }

  getFallbackPlants() {
    return (Array.isArray(PLANTS) ? PLANTS : []).map((item) => this.normalizePlant(item));
  }

  sortPlants(plants = []) {
    return [
      ...plants.filter((item) => item.isFavorite),
      ...plants.filter((item) => !item.isFavorite)
    ];
  }

  dedupePlants(plants = []) {
    const source = Array.isArray(plants) ? plants : [];
    const plantMap = new Map();

    source.forEach((plant) => {
      const normalized = this.normalizePlant(plant);
      const key = String(normalized.name || normalized.scientificName || normalized.id || '')
        .trim()
        .toLowerCase();

      if (!key) return;

      const existing = plantMap.get(key);
      if (!existing) {
        plantMap.set(key, normalized);
        return;
      }

      const currentScore = this.countPlantCompleteness(normalized);
      const existingScore = this.countPlantCompleteness(existing);

      if (
        currentScore > existingScore ||
        (currentScore === existingScore && normalized.isFavorite && !existing.isFavorite) ||
        (currentScore === existingScore && Number(normalized.id) < Number(existing.id))
      ) {
        plantMap.set(key, normalized);
      }
    });

    return Array.from(plantMap.values());
  }

  getPlantDisplayName(plant = {}) {
    return String(plant?.name || '').trim();
  }

  buildPlantOptions(plants = []) {
    const names = (Array.isArray(plants) ? plants : [])
      .map((item) => this.getPlantDisplayName(item))
      .filter(Boolean);

    const options = Array.from(new Set(names.concat('其他')));
    return options.length > 0 ? options : ['其他'];
  }

  findPlantByIdentity(plants = [], options = {}) {
    const source = Array.isArray(plants) ? plants : [];
    const plantId = Number(options.plantId) || 0;
    const plantName = String(options.plantName || '').trim();
    if (!source.length) return null;

    if (plantId) {
      const exactById = source.find((item) => Number(item.id) === plantId);
      if (exactById) return exactById;
    }

    if (!plantName) return null;
    const normalizedName = plantName.toLowerCase();

    return source.find((item) => {
      const names = [item.name].concat(Array.isArray(item.aliases) ? item.aliases : [])
        .filter(Boolean)
        .map((part) => String(part).toLowerCase());
      return names.some((part) => part === normalizedName || part.includes(normalizedName) || normalizedName.includes(part));
    }) || null;
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
    const remotePlants = Array.isArray(res?.plants) ? this.dedupePlants(res.plants) : [];
    const plants = remotePlants.length > 0 ? remotePlants : this.dedupePlants(this.getFallbackPlants());
    const sortedPlants = this.sortPlants(plants);

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
      this._cachedPlants = this.sortPlants(this._cachedPlants);
    }
    return result;
  }
}

module.exports = new PlantService();
