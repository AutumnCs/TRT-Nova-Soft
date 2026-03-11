const db = require('../DB');

const COLLECTION_NAME = 'todos';

class TodoService {
  async getCurrentOpenid() {
    const openid = await db.getOpenid();
    if (!openid) throw new Error('openid is empty');
    return openid;
  }

  async getTodos(logicalKey = '') {
    try {
      const openid = await this.getCurrentOpenid();
      const where = { openid };
      if (logicalKey) where.logicalKey = logicalKey;
      const todos = await db.query(COLLECTION_NAME, where);
      return todos;
    } catch (err) {
      console.error('getTodos failed:', err);
      return [];
    }
  }

  async addTodo(content, logicalKey = '') {
    try {
      const openid = await this.getCurrentOpenid();
      const newTodo = {
        openid,
        logicalKey: logicalKey || '',
        title: content,
        urgent: false,
        icon: '📘',
        iconColor: 'text-blue-500',
        iconBg: 'bg-blue-50',
        desc: '长按切换优先级',
        status: 'pending'
      };
      return await db.add(COLLECTION_NAME, newTodo);
    } catch (err) {
      console.error('addTodo failed:', err);
      throw new Error(`addTodo failed: ${err.message}`);
    }
  }

  async assertOwner(todoId, logicalKey = '') {
    const openid = await this.getCurrentOpenid();
    const doc = await db.get(COLLECTION_NAME, todoId);
    if (!doc || doc.openid !== openid) {
      throw new Error('permission denied');
    }
    if (logicalKey && doc.logicalKey && doc.logicalKey !== logicalKey) {
      throw new Error('device mismatch');
    }
    return doc;
  }

  async toggleUrgency(todo, logicalKey = '') {
    await this.assertOwner(todo._id, logicalKey);
    const newUrgent = !todo.urgent;
    const updates = {
      urgent: newUrgent,
      desc: newUrgent ? '高优先级' : '普通优先级',
      iconColor: newUrgent ? 'text-red-500' : 'text-blue-500',
      iconBg: newUrgent ? 'bg-red-50' : 'bg-blue-50'
    };
    return await db.update(COLLECTION_NAME, todo._id, updates);
  }

  async completeTodo(id, logicalKey = '') {
    await this.assertOwner(id, logicalKey);
    return await db.delete(COLLECTION_NAME, id);
  }
}

module.exports = new TodoService();
