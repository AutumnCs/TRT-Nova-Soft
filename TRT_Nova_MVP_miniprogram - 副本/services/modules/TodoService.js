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
    try {
      console.log('开始获取待办事项');
      // 直接查询，云开发会自动根据用户身份过滤
      const todos = await db.query(COLLECTION_NAME, {});
      console.log('获取到待办事项:', todos);
      return todos;
    } catch (err) {
      console.error('获取待办事项失败', err);
      // 错误时返回空数组，避免页面崩溃
      return [];
    }
  }

  /**
   * 添加待办事项
   * @param {string} content - 任务内容
   * @returns {Promise<Object>}
   */
  async addTodo(content) {
    try {
      console.log('开始添加待办事项:', content);
      
      // 移除手动添加的_openid字段，让系统自动管理
      const newTodo = {
        title: content,
        urgent: false,
        icon: "📝",
        iconColor: "text-blue-500",
        iconBg: "bg-blue-50",
        desc: "长按切换优先级",
        status: "pending"
      };
      
      console.log('准备添加的待办事项:', newTodo);
      const result = await db.add(COLLECTION_NAME, newTodo);
      console.log('添加待办事项成功:', result);
      return result;
    } catch (err) {
      console.error('添加待办事项失败', err);
      // 重新抛出错误，带上更详细的信息
      throw new Error(`添加待办事项失败: ${err.message}`);
    }
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
    try {
      console.log('开始删除待办事项:', id);
      const result = await db.delete(COLLECTION_NAME, id);
      console.log('删除待办事项成功:', result);
      return result;
    } catch (err) {
      console.error('删除待办事项失败:', err);
      // 权限错误处理
      if (err.message.includes('permission') || err.message.includes('Permission')) {
        console.error('删除失败：权限不足，请检查待办事项的创建者是否与当前用户一致');
        throw new Error('删除失败：权限不足，请检查待办事项的创建者是否与当前用户一致');
      }
      throw err;
    }
  }
}

module.exports = new TodoService();
