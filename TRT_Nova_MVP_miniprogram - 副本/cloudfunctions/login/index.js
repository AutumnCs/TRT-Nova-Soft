// login/index.js
// 云函数入口文件

/**
 * 登录云函数
 * 获取用户的openid
 */
exports.main = async (event, context) => {
  try {
    console.log('event:', event);
    console.log('context:', context);
    
    // 通过云函数上下文获取用户openid
    const wxContext = context.cloud.getWXContext();
    console.log('wxContext:', wxContext);
    
    const openid = wxContext.OPENID;
    console.log('获取openid成功:', openid);
    
    return {
      code: 0,
      message: 'success',
      result: {
        openid: openid
      }
    };
  } catch (error) {
    console.error('获取openid失败:', error);
    return {
      code: -1,
      message: '获取openid失败',
      error: error.message
    };
  }
};
