const ScfApiAdapter = require('../core/ScfApiAdapter');

const scfApiAdapter = new ScfApiAdapter();

function normalizeRecord(row = {}) {
  return {
    id: row.id || '',
    logicalKey: row.logicalKey || row.logical_key || '',
    plantLibraryId: row.plantLibraryId || row.plant_library_id || null,
    eventDate: row.eventDate || row.event_date || '',
    eventType: row.eventType || row.event_type || 'note',
    title: row.title || '',
    content: row.content || row.content_text || '',
    photos: Array.isArray(row.photos) ? row.photos : [],
    relatedTodoId: row.relatedTodoId || row.related_todo_id || null,
    createdAt: row.createdAt || row.created_at || null,
    updatedAt: row.updatedAt || row.updated_at || null
  };
}

class PlantJournalService {
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
}

module.exports = new PlantJournalService();
