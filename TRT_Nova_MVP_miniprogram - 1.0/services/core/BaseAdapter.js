/**
 * Base adapter interface for data operations.
 * Concrete adapters should implement all methods below.
 */
class BaseAdapter {
  constructor() {
    if (new.target === BaseAdapter) {
      throw new Error('BaseAdapter cannot be instantiated directly');
    }
  }

  connect(config) {
    throw new Error('connect() must be implemented');
  }

  async query(collectionName, query) {
    throw new Error('query() must be implemented');
  }

  async get(collectionName, id) {
    throw new Error('get() must be implemented');
  }

  async add(collectionName, data) {
    throw new Error('add() must be implemented');
  }

  async update(collectionName, id, data) {
    throw new Error('update() must be implemented');
  }

  async delete(collectionName, id) {
    throw new Error('delete() must be implemented');
  }

  async getOpenid() {
    throw new Error('getOpenid() must be implemented');
  }
}

module.exports = BaseAdapter;
