const ScfApiAdapter = require('../core/ScfApiAdapter');

const scfApiAdapter = new ScfApiAdapter();

function normalizeTodoRow(row = {}) {
  return {
    _id: row._id || row.id || '',
    id: row.id || row._id || '',
    openid: row.openid || '',
    logicalKey: row.logicalKey || row.logical_key || '',
    title: row.title || row.content || '',
    urgent: Boolean(row.urgent),
    icon: row.icon || '📝',
    iconColor: row.iconColor || row.icon_color || 'text-blue-500',
    iconBg: row.iconBg || row.icon_bg || 'bg-blue-50',
    desc: row.desc || row.descriptionText || row.description_text || '',
    status: row.status || 'pending',
    createdAt: row.createdAt || row.created_at || null,
    updatedAt: row.updatedAt || row.updated_at || null
  };
}

class TodoService {
  async getTodos(logicalKey = '') {
    try {
      const res = await scfApiAdapter.getTodos(logicalKey);
      const todos = res?.todos || res?.data || [];
      return Array.isArray(todos) ? todos.map(normalizeTodoRow) : [];
    } catch (err) {
      console.error('getTodos failed:', err);
      return [];
    }
  }

  async getGlobalTodos() {
    try {
      const res = await scfApiAdapter.getGlobalTodos();
      const todos = res?.todos || res?.data || [];
      return Array.isArray(todos) ? todos.map(normalizeTodoRow) : [];
    } catch (err) {
      console.error('getGlobalTodos failed:', err);
      return [];
    }
  }

  async addTodo(content, logicalKey = '') {
    try {
      const payload = {
        content: typeof content === 'string' ? content.trim() : '',
        logicalKey: logicalKey || ''
      };
      const res = await scfApiAdapter.addTodo(payload);
      return normalizeTodoRow(res?.todo || res?.data || res);
    } catch (err) {
      console.error('addTodo failed:', err);
      throw new Error(`addTodo failed: ${err.message}`);
    }
  }

  async toggleUrgency(todo, logicalKey = '') {
    try {
      const todoId = todo?._id || todo?.id || '';
      if (!todoId) throw new Error('todoId is required');
      const res = await scfApiAdapter.toggleTodoUrgency({
        todoId,
        logicalKey: logicalKey || todo?.logicalKey || ''
      });
      return normalizeTodoRow(res?.todo || res?.data || res);
    } catch (err) {
      console.error('toggleUrgency failed:', err);
      throw new Error(`toggleUrgency failed: ${err.message}`);
    }
  }

  async completeTodo(id, logicalKey = '') {
    try {
      const todoId = typeof id === 'string' ? id.trim() : String(id || '').trim();
      if (!todoId) throw new Error('todoId is required');
      const res = await scfApiAdapter.completeTodo({
        todoId,
        logicalKey: logicalKey || ''
      });
      return normalizeTodoRow(res?.todo || res?.data || res);
    } catch (err) {
      console.error('completeTodo failed:', err);
      throw new Error(`completeTodo failed: ${err.message}`);
    }
  }
}

module.exports = new TodoService();
