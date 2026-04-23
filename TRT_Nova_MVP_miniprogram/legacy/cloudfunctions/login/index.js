// login/index.js
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

exports.main = async (event, context) => {
  try {
    const wxContext = cloud.getWXContext();
    
    return {
      code: 0,
      message: 'success',
      openid: wxContext.OPENID,
      appid: wxContext.APPID,
      unionid: wxContext.UNIONID
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
