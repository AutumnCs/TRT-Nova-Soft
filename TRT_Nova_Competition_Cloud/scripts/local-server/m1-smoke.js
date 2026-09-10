/**
 * M1 本地冒烟：双账号资料隔离与 PlantPet 完整 CRUD。
 * 使用固定本地测试 openid，不输出 JWT，不访问线上环境。
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

async function getDevToken(openid) {
  const response = await request('GET', `/dev/token?openid=${encodeURIComponent(openid)}`);
  check(`${openid} 本地 token 签发`, response.status === 200 && Boolean(response.json?.token), {
    status: response.status,
    success: response.json?.success
  });
  return response.json?.token || '';
}

(async () => {
  const accountA = 'm1_isolation_account_a';
  const accountB = 'm1_isolation_account_b';
  const tokenA = await getDevToken(accountA);
  const tokenB = await getDevToken(accountB);

  await request('POST', '/user/profile', {
    token: tokenA,
    body: { nickName: '隔离账号 A', avatarUrl: 'https://example.invalid/a.png' }
  });
  await request('POST', '/user/profile', {
    token: tokenB,
    body: { nickName: '隔离账号 B', avatarUrl: 'https://example.invalid/b.png' }
  });
  const spoofedProfile = await request('POST', '/user/profile', {
    token: tokenA,
    body: {
      openid: accountB,
      nickName: '隔离账号 A 更新',
      avatarUrl: 'https://example.invalid/a2.png'
    }
  });
  const profileB = await request('GET', '/user/profile', { token: tokenB });
  check(
    '个人资料只按 JWT owner 写入',
    spoofedProfile.json?.profile?.openid === accountA &&
      profileB.json?.profile?.openid === accountB &&
      profileB.json?.profile?.nickName === '隔离账号 B',
    { spoofedProfile: spoofedProfile.json, profileB: profileB.json }
  );

  const created = await request('POST', '/plant/pet-create', {
    token: tokenA,
    body: {
      nickname: '窗边的未知小苗',
      speciesName: '',
      enteredAt: '2026-08-26',
      location: '客厅窗边',
      careNotes: '先观察叶片变化',
      coverUrl: 'https://example.invalid/unknown-plant.png',
      ownerOpenid: accountB
    }
  });
  const plantPetId = Number(created.json?.pet?.id) || 0;
  check(
    '未知品种可创建且 owner 来自 JWT',
    created.status === 200 && created.json?.success === true &&
      created.json?.pet?.ownerOpenid === accountA &&
      created.json?.pet?.speciesName === '未知品种' && plantPetId > 0,
    created
  );

  const listA = await request('POST', '/plant/pets', { token: tokenA, body: { includeArchived: true } });
  const listB = await request('POST', '/plant/pets', { token: tokenB, body: { includeArchived: true } });
  const forbiddenB = await request('POST', '/plant/pet', { token: tokenB, body: { plantPetId } });
  check(
    'PlantPet 列表和详情跨账号隔离',
    listA.json?.pets?.some((pet) => pet.id === plantPetId) &&
      !listB.json?.pets?.some((pet) => pet.id === plantPetId) &&
      forbiddenB.json?.success === false,
    { listA: listA.json, listB: listB.json, forbiddenB: forbiddenB.json }
  );

  const forbiddenUpdateB = await request('POST', '/plant/pet-update', {
    token: tokenB,
    body: { plantPetId, nickname: '不应写入的 B 账号名称' }
  });
  const forbiddenArchiveB = await request('POST', '/plant/pet-archive', {
    token: tokenB,
    body: { plantPetId }
  });
  const forbiddenDeleteB = await request('POST', '/plant/pet-delete', {
    token: tokenB,
    body: { plantPetId }
  });
  check(
    'PlantPet 编辑、归档和删除均拒绝跨账号写入',
    forbiddenUpdateB.json?.success === false &&
      forbiddenArchiveB.json?.success === false &&
      forbiddenDeleteB.json?.success === false,
    {
      forbiddenUpdateB: forbiddenUpdateB.json,
      forbiddenArchiveB: forbiddenArchiveB.json,
      forbiddenDeleteB: forbiddenDeleteB.json
    }
  );

  const updated = await request('POST', '/plant/pet-update', {
    token: tokenA,
    body: {
      plantPetId,
      nickname: '窗边的小苗',
      speciesName: '待确认的观叶植物',
      enteredAt: '2026-08-25',
      location: '书房窗台',
      careNotes: '保持散射光，暂不生成任务'
    }
  });
  check(
    'PlantPet 编辑持久化',
    updated.json?.success === true &&
      updated.json?.pet?.nickname === '窗边的小苗' &&
      updated.json?.pet?.speciesName === '待确认的观叶植物' &&
      updated.json?.pet?.location === '书房窗台',
    updated
  );

  const archived = await request('POST', '/plant/pet-archive', {
    token: tokenA,
    body: { plantPetId }
  });
  const activeAfterArchive = await request('POST', '/plant/pets', { token: tokenA, body: {} });
  const allAfterArchive = await request('POST', '/plant/pets', {
    token: tokenA,
    body: { includeArchived: true }
  });
  check(
    '归档从在养列表移除但保留档案',
    archived.json?.pet?.status === 'archived' &&
      !activeAfterArchive.json?.pets?.some((pet) => pet.id === plantPetId) &&
      allAfterArchive.json?.pets?.some((pet) => pet.id === plantPetId && pet.status === 'archived'),
    { archived: archived.json, activeAfterArchive: activeAfterArchive.json, allAfterArchive: allAfterArchive.json }
  );

  const deleted = await request('POST', '/plant/pet-delete', {
    token: tokenA,
    body: { plantPetId }
  });
  const afterDelete = await request('POST', '/plant/pet', { token: tokenA, body: { plantPetId } });
  check(
    '永久删除后档案不可读取',
    deleted.json?.success === true && afterDelete.json?.success === false,
    { deleted: deleted.json, afterDelete: afterDelete.json }
  );

  console.log(failures ? `M1 冒烟失败 ${failures} 项` : 'M1 冒烟全部通过');
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error('[m1-smoke] 运行异常:', err.message);
  process.exit(1);
});
