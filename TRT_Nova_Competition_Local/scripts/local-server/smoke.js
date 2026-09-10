/**
 * M0 本地冒烟：数据库健康、鉴权拒绝、开发 token、用户资料和植物库。
 * 只验证正式基线已有能力，不提前依赖 PlantPet/M1 功能。
 */

const http = require('http');

const host = '127.0.0.1';
const port = Number(process.env.LOCAL_PORT || 3000);

function request(method, path, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const req = http.request({
      host,
      port,
      path,
      method,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        ...(token ? { 'x-access-token': token } : {})
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch (err) { /* 由断言报告 */ }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
}

let failures = 0;
function check(name, condition, detail) {
  console.log(`[${condition ? 'PASS' : 'FAIL'}] ${name}`);
  if (!condition) {
    failures += 1;
    console.log(JSON.stringify(detail));
  }
}

(async () => {
  const health = await request('GET', '/health');
  check('数据库健康检查', health.status === 200 && health.json?.success === true && health.json?.ok === true, health);

  const denied = await request('GET', '/user/profile');
  check('无 token 请求被拒绝', denied.status === 401, denied);

  const tokenResponse = await request('GET', '/dev/token?openid=dev_local_user');
  const token = tokenResponse.json?.token;
  check('本地开发 token 签发', tokenResponse.status === 200 && Boolean(token), tokenResponse);

  const profile = await request('GET', '/user/profile', { token });
  check(
    'JWT 可读取隔离测试用户',
    profile.status === 200 && profile.json?.success === true && profile.json?.profile?.openid === 'dev_local_user',
    profile
  );

  const library = await request('GET', '/plant/library', { token });
  check(
    '现有植物库可读取',
    library.status === 200 && library.json?.success === true && Array.isArray(library.json?.plants) && library.json.plants.length >= 4,
    library
  );

  console.log(failures ? `M0 冒烟失败 ${failures} 项` : 'M0 冒烟全部通过');
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error('[local-smoke] 运行异常:', err.message);
  process.exit(1);
});
