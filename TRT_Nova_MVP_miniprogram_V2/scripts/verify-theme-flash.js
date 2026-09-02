/* 主题切换闪烁验证（原生 WS）
 * 场景：切主题 → reLaunch 同页（= 切主题后第一次进入该页的冷路径）→ 首帧 data.theme 必须已是新主题
 */
const WebSocket = require('ws');

const id2res = {};
let nextId = 1;
let ws;

function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    id2res[id] = { resolve, reject };
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function currentPage() {
  for (let i = 0; i < 10; i++) {
    const r = await call('App.getPageStack');
    const top = r.pageStack[r.pageStack.length - 1];
    if (top) {
      // 确认页面存活（getData 成功才算就绪）
      try {
        const d = await call('Page.getData', { pageId: top.pageId });
        if (d && d.data) return top;
      } catch (e) { /* 还没就绪，重试 */ }
    }
    await sleep(150);
  }
  throw new Error('page not ready');
}

const pages = [
  '/pages/index/index',
  '/pages/toysClub/toysClub',
  '/pages/assistant/assistant',
  '/pages/wiki/wiki',
  '/pages/profile/profile'
];

(async () => {
  ws = new WebSocket('ws://127.0.0.1:9420');
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && id2res[msg.id]) {
      if (msg.error) id2res[msg.id].reject(new Error(msg.error.message || 'unknown'));
      else id2res[msg.id].resolve(msg.result);
      delete id2res[msg.id];
    }
  });
  console.log('connected\n');

  const results = [];
  for (const route of pages) {
    try {
      await call('App.callWxMethod', { method: 'reLaunch', args: [{ url: route }] });
      await sleep(800);
      let cur = await currentPage();
      const d1 = await call('Page.getData', { pageId: cur.pageId });
      const before = d1.data.theme;

      await call('Page.callMethod', { pageId: cur.pageId, method: 'toggleTheme' });
      await sleep(400);
      const d2 = await call('Page.getData', { pageId: cur.pageId });
      const after = d2.data.theme;

      // 冷路径：reLaunch 后立即查首帧主题
      await call('App.callWxMethod', { method: 'reLaunch', args: [{ url: route }] });
      await sleep(80);
      cur = await currentPage();
      const dFirst = await call('Page.getData', { pageId: cur.pageId });
      const first = dFirst.data.theme;
      const ready = dFirst.data.ready;

      results.push({ route, before, after, first, ready, ok: first === after });
      // 切回原主题保持环境
      await call('Page.callMethod', { pageId: cur.pageId, method: 'toggleTheme' });
      await sleep(300);
    } catch (e) {
      results.push({ route, error: e.message });
    }
  }

  console.log('===== RESULT =====');
  let pass = 0;
  for (const r of results) {
    if (r.error) { console.log(`${r.route}  ERROR ${r.error}`); continue; }
    const mark = r.first === r.after ? 'PASS' : '*** FLASH ***';
    console.log(`${r.route}  ${r.before} -> ${r.after}  firstFrame=${r.first} ready=${r.ready}  ${mark}`);
    if (r.first === r.after) pass++;
  }
  console.log(`\n${pass}/${results.length} passed`);
  ws.close();
  process.exit(pass === results.length && results.every(r => !r.error) ? 0 : 1);
})().catch((e) => { console.error('FATAL', e.message); process.exit(2); });
