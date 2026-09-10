import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

// Test-only network boundary. No production flag can enable these substitutes.
export function localProviders({ secrets, mysqlPort }) {
  const calls = { model: [], wechat: 0, token: 0, cloudbase: [], blockedNetwork: [] };
  const objects = new Map();
  const faults = { delete: false, corruptRead: false, model: false };
  const originals = { httpRequest: http.request, httpGet: http.get, httpsRequest: https.request,
    httpsGet: https.get, connect: net.Socket.prototype.connect, fetch: globalThis.fetch };
  function fail(destination) { calls.blockedNetwork.push(String(destination)); throw new Error('TEST_UNEXPECTED_EXTERNAL_NETWORK'); }
  function model(payload) {
    calls.model.push(payload);
    if (faults.model) { faults.model = false; throw new Error('TEST_MODEL_UNAVAILABLE'); }
    const messages = payload.messages || [];
    const systems = messages.filter(item => item.role === 'system').map(item => item.content).join('\n');
    const last = messages.filter(item => item.role === 'user').at(-1)?.content || '';
    let content;
    if (payload.model === 'rehearsal-vision') {
      content = JSON.stringify({ isPlant: true, uncertain: false, reply: '这张图是月季。这里只介绍，不安排任务。',
        candidates: [{ name: '月季', confidence: 0.95, reason: '测试模型固定输出' }],
        visibleSigns: ['花瓣展开'], possibleCauses: [], advice: [{ title: '保持通风', detail: '按现场条件判断', priority: 'observe' }], reshootQuestions: [] });
    } else if (systems.includes('从本轮用户原话提取')) {
      const data = JSON.parse(last);
      content = JSON.stringify(data.currentUserMessage === '以后叫我dola吧'
        ? { facts: [{ key: 'preferred_name', category: 'nickname', content: '你希望被称呼为dola', quote: '以后叫我dola吧' }], summary: '你希望我称呼你为dola。' }
        : { facts: [], summary: data.existingSummary || '' });
    } else if (systems.includes('把用户亲自编辑的记忆摘要')) {
      const data = JSON.parse(last);
      content = JSON.stringify({ facts: [{ key: 'preference_brief', category: 'preference', content: data.editedSummary, quote: data.editedSummary }] });
    } else if (systems.includes('整理当前会话的上下文')) {
      content = JSON.stringify({ summary: '用户称呼dola，已讨论种植和观察；旧原话仍保存。' });
    } else if (systems.includes('本轮附带一份用户主动选择的文档')) {
      content = '文档提到通风和观察盆土。这里只解释文档，不创建任务。';
    } else if (typeof last === 'string' && /安排.*任务|创建.*任务/.test(last)) {
      content = '观察任务候选已准备好，确认后才会保存为正式任务。';
    } else if (typeof last === 'string' && /我是谁|称呼|叫我/.test(last)) {
      content = 'dola，我会根据这段会话中的称呼与你交流。';
    } else content = '可以，我们继续聊植物；目前资料不足，这些只是建议，不会直接创建任务。';
    return { choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } };
  }
  function request(options, callback, finalCallback) {
    const target = typeof options === 'string' || options instanceof URL ? new URL(options) : options;
    const hostname = target.hostname || target.host;
    if (hostname === 'api.weixin.qq.com' && (target.pathname === '/cgi-bin/stable_token' || target.pathname.startsWith('/tcb/'))) {
      assert.equal(callback.method, 'POST');
      const req = new EventEmitter(); req.destroy = () => {};
      req.end = body => queueMicrotask(() => {
        try {
          const input = JSON.parse(body); let data;
          if (target.pathname === '/cgi-bin/stable_token') {
            assert.equal(input.secret, secrets.WECHAT_SECRET);
            assert.equal(input.appid, 'wx1234567890abcdef'); assert.equal(input.force_refresh, false);
            calls.token++; data = { access_token: 'rehearsal-server-only-token', expires_in: 7200 };
          } else {
            assert.equal(target.searchParams.get('access_token'), 'rehearsal-server-only-token');
            assert.equal(input.env, 'nova-images-rehearsal');
            if (target.pathname === '/tcb/uploadfile') {
              assert.match(input.path, /^nova-staging\/rehearsal\/media\/[a-f0-9-]{36}\.(png|jpg|webp|txt|md|csv|json|pdf|docx)$/);
              calls.cloudbase.push('prepare');
              data = { errcode: 0, file_id: cloudbaseId(input.path), token: 'never-send-to-client' };
            } else if (target.pathname === '/tcb/batchdownloadfile') {
              calls.cloudbase.push('read');
              const item = input.file_list[0]; const key = cloudbasePath(item.fileid);
              data = { errcode: 0, file_list: [{ fileid: item.fileid, status: objects.has(key) ? 0 : -501000,
                download_url: 'https://nova-images-1250000000.tcb.qcloud.la/' + key }] };
            } else if (target.pathname === '/tcb/batchdeletefile') {
              calls.cloudbase.push('delete'); const id = input.fileid_list[0];
              if (faults.delete) { faults.delete = false; data = { errcode: 0, delete_list: [{ fileid: id, status: -501007 }] }; }
              else { objects.delete(cloudbasePath(id)); data = { errcode: 0, delete_list: [{ fileid: id, status: 0 }] }; }
            } else throw new Error('TEST_CLOUDBASE_OPERATION_NOT_ALLOWED');
          }
          const response = new EventEmitter(); response.statusCode = 200; response.headers = {}; response.destroy = () => {};
          finalCallback(response); response.emit('data', Buffer.from(JSON.stringify(data))); response.emit('end');
        } catch (error) { req.emit('error', error); }
      });
      return req;
    }
    if (hostname === 'nova-images-1250000000.tcb.qcloud.la') {
      assert.equal(callback.headers.Range, 'bytes=0-2097152');
      const req = new EventEmitter(); req.destroy = () => {};
      req.end = () => queueMicrotask(() => {
        const body = objects.get(target.pathname.slice(1));
        const response = new EventEmitter(); response.statusCode = body ? 200 : 404;
        response.headers = {}; response.destroy = () => {};
        finalCallback(response);
        response.emit('data', faults.corruptRead ? Buffer.from('corrupt') : body || Buffer.alloc(0));
        response.emit('end');
      });
      return req;
    }
    if (!['api.weixin.qq.com', 'model.nova.invalid'].includes(hostname)) return fail(hostname);
    const req = new EventEmitter(); let body = '';
    req.write = value => { body += value; return true; };
    req.destroy = error => { if (error) queueMicrotask(() => req.emit('error', error)); };
    req.end = () => queueMicrotask(() => {
      try {
        let value;
        if (hostname === 'api.weixin.qq.com') {
          const url = typeof options === 'string' || options instanceof URL ? new URL(options) : new URL(target.path, 'https://api.weixin.qq.com');
          assert.equal(url.pathname, '/sns/jscode2session');
          assert.equal(url.searchParams.get('secret'), secrets.WECHAT_SECRET);
          const code = url.searchParams.get('js_code');
          assert.ok(['owner-a', 'owner-b'].includes(code)); calls.wechat++;
          value = { openid: `rehearsal_${code}`, session_key: 'test-only-session' };
        } else value = model(JSON.parse(body));
        const res = new EventEmitter(); res.statusCode = 200; res.setEncoding = () => {};
        callback(res);
        res.emit('data', Buffer.from(JSON.stringify(value))); res.emit('end');
      } catch (error) { req.emit('error', error); }
    });
    return req;
  }
  http.request = https.request = request;
  http.get = https.get = (options, callback) => { const req = request(options, callback); req.end(); return req; };
  globalThis.fetch = async () => fail('fetch');
  net.Socket.prototype.connect = function (...args) {
    // mysql2 uses one options object. No other socket can leave this test process.
    const options = Array.isArray(args[0]) ? args[0][0] : args[0];
    if (typeof options !== 'object' || options.host !== '127.0.0.1' || Number(options.port) !== mysqlPort) return fail('socket');
    return originals.connect.apply(this, args);
  };
  const cloudbaseId = cloudPath => 'cloud://nova-images-rehearsal.nova-images-1250000000/' + cloudPath;
  const cloudbasePath = fileId => {
    assert.ok(fileId.startsWith('cloud://nova-images-rehearsal.nova-images-1250000000/'));
    return fileId.split('/').slice(3).join('/');
  };
  function uploadCloudbase(upload, bytes) {
    assert.equal(upload.envId, 'nova-images-rehearsal');
    assert.equal(upload.fileId, cloudbaseId(upload.cloudPath));
    objects.set(upload.cloudPath, Buffer.from(bytes));
    calls.cloudbase.push('client-upload');
  }
  return { calls, objects, faults, uploadCloudbase, restore() {
    http.request = originals.httpRequest; http.get = originals.httpGet; https.request = originals.httpsRequest;
    https.get = originals.httpsGet; net.Socket.prototype.connect = originals.connect; globalThis.fetch = originals.fetch;
  } };
}

// Minimal, reproducible real documents generated in memory; no external fixtures.
export function documentFixtures() {
  const text = 'Rose care notes: provide ventilation. Check soil before watering.';
  const stream = `BT /F1 12 Tf 50 700 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const files = {
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`
  };
  const chunks = []; const directory = []; let offset = 0;
  for (const [name, value] of Object.entries(files)) {
    const filename = Buffer.from(name); const data = Buffer.from(value); let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42);
    chunks.push(local, filename, data); directory.push(central, filename); offset += local.length + filename.length + data.length;
  }
  const directoryBytes = Buffer.concat(directory); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(3, 8); end.writeUInt16LE(3, 10); end.writeUInt32LE(directoryBytes.length, 12); end.writeUInt32LE(offset, 16);
  return [{ name: 'notes.pdf', bytes: Buffer.from(pdf) }, { name: 'notes.docx', bytes: Buffer.concat([...chunks, directoryBytes, end]) }];
}
