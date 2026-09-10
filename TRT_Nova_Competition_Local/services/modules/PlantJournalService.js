const ScfApiAdapter = require('../core/ScfApiAdapter');
const mediaStorageService = require('./MediaStorageService');

const scfApiAdapter = new ScfApiAdapter();

function normalizeRecord(row = {}) {
  return {
    id: row.id || '',
    ownerOpenid: row.ownerOpenid || row.openid || '',
    logicalKey: row.logicalKey || row.logical_key || '',
    plantPetId: Number(row.plantPetId || row.plant_pet_id) || 0,
    plantPetName: row.plantPetName || row.plant_pet_name || '',
    plantPetStatus: row.plantPetStatus || row.plant_pet_status || 'active',
    plantLibraryId: row.plantLibraryId || row.plant_library_id || null,
    eventDate: row.eventDate || row.event_date || '',
    eventType: row.eventType || row.event_type || 'note',
    title: row.title || '',
    content: row.content || row.content_text || '',
    photoFileIds: Array.isArray(row.photoFileIds)
      ? row.photoFileIds
      : Array.isArray(row.photos)
        ? row.photos
        : [],
    photos: Array.isArray(row.photos) ? row.photos : [],
    relatedTodoId: row.relatedTodoId || row.related_todo_id || null,
    createdAt: row.createdAt || row.created_at || null,
    updatedAt: row.updatedAt || row.updated_at || null
  };
}

class PlantJournalService {
  async hydrateRecords(records = []) {
    const source = Array.isArray(records) ? records : [];
    const fileIds = source.flatMap((item) => normalizeRecord(item).photoFileIds).filter(Boolean);
    const displayMap = fileIds.length ? await mediaStorageService.resolveFileIds(fileIds) : {};
    return source.map((item) => {
      const record = normalizeRecord(item);
      return {
        ...record,
        photos: record.photoFileIds.map((fileId) => displayMap[fileId]).filter(Boolean)
      };
    });
  }

  async getMonth(logicalKey, month) {
    const res = await scfApiAdapter.getJournalMonth({ logicalKey, month });
    return {
      success: res?.success !== false,
      records: Array.isArray(res?.records) ? res.records.map(normalizeRecord) : [],
      days: Array.isArray(res?.days) ? res.days : []
    };
  }

  async getDay(logicalKey, date) {
    const res = await scfApiAdapter.getJournalDay({ logicalKey, date });
    return {
      success: res?.success !== false,
      records: Array.isArray(res?.records) ? res.records.map(normalizeRecord) : []
    };
  }

  async addRecord(payload = {}) {
    const res = await scfApiAdapter.addJournalRecord(payload);
    return {
      success: res?.success !== false,
      record: res?.record ? normalizeRecord(res.record) : null
    };
  }

  async listTimeline(options = {}) {
    const payload = { limit: Number(options.limit) || 50 };
    if (Number(options.plantPetId)) payload.plantPetId = Number(options.plantPetId);
    const res = await scfApiAdapter.listJournalTimeline(payload);
    return {
      success: res?.success !== false,
      records: await this.hydrateRecords(res?.records),
      msg: res?.msg || ''
    };
  }

  async getRecord(journalId) {
    const res = await scfApiAdapter.getJournalRecord(journalId);
    const records = res?.record ? await this.hydrateRecords([res.record]) : [];
    return { ...res, record: records[0] || null };
  }

  async createRecord(payload = {}) {
    const res = await scfApiAdapter.createJournalRecord(payload);
    const records = res?.record ? await this.hydrateRecords([res.record]) : [];
    return { ...res, record: records[0] || null };
  }

  async updateRecord(payload = {}) {
    const res = await scfApiAdapter.updateJournalRecord(payload);
    const records = res?.record ? await this.hydrateRecords([res.record]) : [];
    return { ...res, record: records[0] || null };
  }

  async deleteRecord(journalId) {
    return scfApiAdapter.deleteJournalRecord(journalId);
  }
}

module.exports = new PlantJournalService();
