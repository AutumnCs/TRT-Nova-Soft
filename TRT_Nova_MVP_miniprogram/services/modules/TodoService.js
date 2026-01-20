const db = require('../DB');

const COLLECTION_NAME = 'todos';

/**
 * @class TodoService
 * @description 待办事项业务逻辑层
 * 封装了具体的业务逻辑，调用底层 DB 实例进行数据操作
 */
class TodoService {
  
  /**
   * 获取所有待办事项
   * @returns {Promise<Array>}
   */
  async getTodos() {
    // 这里可以添加特定的查询条件，例如 status: 'pending'
    return await db.query(COLLECTION_NAME, {});
  }

  /**
   * 添加待办事项
   * @param {string} content - 任务内容
   * @returns {Promise<Object>}
   */
  async addTodo(content) {
    const newTodo = {
      title: content,
      urgent: false,
      icon: "📝",
      iconColor: "text-blue-500",
      iconBg: "bg-blue-50",
      desc: "长按切换优先级",
      status: "pending"
    };
    return await db.add(COLLECTION_NAME, newTodo);
  }

  /**
   * 切换优先级
   * @param {Object} todo - 待办事项对象
   * @returns {Promise<boolean>}
   */
  async toggleUrgency(todo) {
    const newUrgent = !todo.urgent;
    const updates = {
      urgent: newUrgent,
      desc: newUrgent ? "高优先级" : "普通优先级",
      iconColor: newUrgent ? "text-red-500" : "text-blue-500",
      iconBg: newUrgent ? "bg-red-50" : "bg-blue-50"
    };
    return await db.update(COLLECTION_NAME, todo._id, updates);
  }

  /**
   * 完成任务（删除或标记为完成）
   * @param {string} id - 待办事项 ID
   * @returns {Promise<boolean>}
   */
  async completeTodo(id) {
    // 物理删除，如果需要逻辑删除改为 update status: 'completed'
    return await db.delete(COLLECTION_NAME, id);
  }
}

module.exports = new TodoService();
