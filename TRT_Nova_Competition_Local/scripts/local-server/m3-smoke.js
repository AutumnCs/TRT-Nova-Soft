/**
 * M3 本地冒烟：永久媒体、成长时间线、替换/删除清理、归档保留与双账号隔离。
 * 使用专用本地测试账号；不输出 JWT，不访问线上环境。
 */

const http = require('http');

const host = '127.0.0.1';
const port = Number(process.env.LOCAL_PORT || 3000);
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

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

async function uploadImage(token, purpose, plantPetId, originalName = 'fixture.bin') {
  return request('POST', '/media/upload', {
    token,
    body: { purpose, plantPetId: plantPetId || undefined, originalName, dataBase64: PNG_BASE64 }
  });
}

async function createPlantPet(token, nickname, coverFileId = '') {
  return request('POST', '/plant/pet-create', {
    token,
    body: {
      nickname,
      speciesName: '月季',
      enteredAt: '2026-08-27',
      location: 'M3 本地测试区',
      careNotes: '仅用于 M3 冒烟，结束后清理',
      coverFileId
    }
  });
}

(async () => {
  const suffix = String(Date.now()).slice(-6);
  const accountA = 'm3_isolation_account_a';
  const accountB = 'm3_isolation_account_b';
  let tokenA = '';
  let tokenB = '';
  let petAId = 0;
  let petBId = 0;

  try {
    tokenA = await getDevToken(accountA);
    tokenB = await getDevToken(accountB);

    const invalid = await request('POST', '/media/upload', {
      token: tokenA,
      body: { purpose: 'profile_avatar', originalName: 'avatar.png', dataBase64: Buffer.from('not-an-image').toString('base64') }
    });
    check('不支持或损坏图片返回明确失败', invalid.json?.success === false && /JPEG、PNG 或 WebP/.test(invalid.json?.msg || ''), invalid.json);

    const firstCover = await uploadImage(tokenA, 'plant_cover', 0, 'cover.heic');
    const firstCoverId = firstCover.json?.media?.fileId || '';
    check('封面按实际 PNG 字节上传，不依赖错误后缀', firstCover.json?.media?.mimeType === 'image/png' && firstCoverId.startsWith('local://'), firstCover.json);

    const petA = await createPlantPet(tokenA, `M3 植宠 A ${suffix}`, firstCoverId);
    const petB = await createPlantPet(tokenB, `M3 植宠 B ${suffix}`);
    petAId = Number(petA.json?.pet?.id) || 0;
    petBId = Number(petB.json?.pet?.id) || 0;
    check('双账号分别建立植宠，A 封面已建立永久引用', petAId > 0 && petBId > 0 && petA.json?.pet?.coverFileId === firstCoverId, { petA: petA.json, petB: petB.json });

    const firstPhoto = await uploadImage(tokenA, 'journal_photo', petAId, 'growth.dat');
    const secondPhoto = await uploadImage(tokenA, 'journal_photo', petAId, 'growth-2.png');
    const firstPhotoId = firstPhoto.json?.media?.fileId || '';
    const secondPhotoId = secondPhoto.json?.media?.fileId || '';
    const created = await request('POST', '/journal/create', {
      token: tokenA,
      body: {
        plantPetId: petAId,
        eventDate: '2026-08-27',
        eventType: 'observation',
        title: '第一片新叶',
        content: '叶片展开，颜色正常',
        photoFileIds: [firstPhotoId]
      }
    });
    const journalId = Number(created.json?.record?.id) || 0;
    check('文字 + 1 张照片日记可创建并归属 PlantPet', created.json?.success === true && journalId > 0 && created.json?.record?.plantPetId === petAId, created.json);

    const forbiddenResolve = await request('POST', '/media/resolve', { token: tokenB, body: { fileIds: [firstPhotoId] } });
    const forbiddenJournal = await request('POST', '/journal/create', {
      token: tokenB,
      body: { plantPetId: petBId, eventDate: '2026-08-27', title: '越权图片', photoFileIds: [firstPhotoId] }
    });
    check('图片解析和日记引用都拒绝跨账号', forbiddenResolve.json?.media?.length === 0 && forbiddenResolve.json?.missingFileIds?.includes(firstPhotoId) && forbiddenJournal.json?.success === false, { forbiddenResolve: forbiddenResolve.json, forbiddenJournal: forbiddenJournal.json });

    const updated = await request('POST', '/journal/update', {
      token: tokenA,
      body: {
        journalId,
        eventDate: '2026-08-26',
        eventType: 'photo',
        title: '新叶记录·已编辑',
        content: '更换了成长照片',
        photoFileIds: [secondPhotoId]
      }
    });
    const resolvedAfterReplace = await request('POST', '/media/resolve', { token: tokenA, body: { fileIds: [firstPhotoId, secondPhotoId] } });
    check('编辑日记持久化新内容并清理被替换照片', updated.json?.record?.title.includes('已编辑') && updated.json?.record?.eventDate === '2026-08-26' && resolvedAfterReplace.json?.missingFileIds?.includes(firstPhotoId) && resolvedAfterReplace.json?.media?.some((item) => item.fileId === secondPhotoId), { updated: updated.json, resolvedAfterReplace: resolvedAfterReplace.json });

    const noPhoto = await request('POST', '/journal/create', {
      token: tokenA,
      body: { plantPetId: petAId, eventDate: '2026-08-25', eventType: 'watering', content: '检查盆土后少量浇水', photoFileIds: [] }
    });
    const threeUploads = await Promise.all([1, 2, 3].map((index) => uploadImage(tokenA, 'journal_photo', petAId, `three-${index}.png`)));
    const threeFileIds = threeUploads.map((item) => item.json?.media?.fileId || '');
    const threePhoto = await request('POST', '/journal/create', {
      token: tokenA,
      body: { plantPetId: petAId, eventDate: '2026-08-24', eventType: 'photo', title: '三张成长照', photoFileIds: threeFileIds }
    });
    const tooMany = await request('POST', '/journal/create', {
      token: tokenA,
      body: { plantPetId: petAId, eventDate: '2026-08-23', title: '超限应失败', photoFileIds: [...threeFileIds, secondPhotoId] }
    });
    check('0/3 张照片可保存，超过 3 张被拒绝', noPhoto.json?.success === true && threePhoto.json?.record?.photoFileIds?.length === 3 && tooMany.json?.success === false, { noPhoto: noPhoto.json, threePhoto: threePhoto.json, tooMany: tooMany.json });

    const summary = await request('GET', '/care/summary', { token: tokenA });
    check('首篇成长日记解锁 first_journal 徽章', summary.json?.badges?.some((badge) => badge.key === 'first_journal' && badge.earned), summary.json);

    const deletedJournal = await request('POST', '/journal/delete', { token: tokenA, body: { journalId: Number(threePhoto.json?.record?.id) || 0 } });
    const resolvedAfterJournalDelete = await request('POST', '/media/resolve', { token: tokenA, body: { fileIds: threeFileIds } });
    check('删除日记会同步删除其图片', deletedJournal.json?.success === true && resolvedAfterJournalDelete.json?.missingFileIds?.length === 3, { deletedJournal: deletedJournal.json, resolvedAfterJournalDelete: resolvedAfterJournalDelete.json });

    const replacementCover = await uploadImage(tokenA, 'plant_cover', petAId, 'replacement.webp');
    const replacementCoverId = replacementCover.json?.media?.fileId || '';
    const updatedPet = await request('POST', '/plant/pet-update', { token: tokenA, body: { plantPetId: petAId, coverFileId: replacementCoverId } });
    const coversAfterReplace = await request('POST', '/media/resolve', { token: tokenA, body: { fileIds: [firstCoverId, replacementCoverId] } });
    check('替换植宠封面后清理旧封面', updatedPet.json?.pet?.coverFileId === replacementCoverId && coversAfterReplace.json?.missingFileIds?.includes(firstCoverId), { updatedPet: updatedPet.json, coversAfterReplace: coversAfterReplace.json });

    const archived = await request('POST', '/plant/pet-archive', { token: tokenA, body: { plantPetId: petAId } });
    const archivedTimeline = await request('POST', '/journal/timeline', { token: tokenA, body: { plantPetId: petAId } });
    const archivedMedia = await request('POST', '/media/resolve', { token: tokenA, body: { fileIds: [replacementCoverId, secondPhotoId] } });
    const archivedEdit = await request('POST', '/journal/update', { token: tokenA, body: { journalId, title: '归档后不应更新' } });
    check('归档保留日记与媒体，但禁止继续编辑', archived.json?.pet?.status === 'archived' && archivedTimeline.json?.records?.some((item) => item.id === journalId) && archivedMedia.json?.media?.length === 2 && archivedEdit.json?.success === false, { archived: archived.json, archivedTimeline: archivedTimeline.json, archivedMedia: archivedMedia.json, archivedEdit: archivedEdit.json });

    const deletedPet = await request('POST', '/plant/pet-delete', { token: tokenA, body: { plantPetId: petAId } });
    const aggregateAfterDelete = await request('POST', '/journal/timeline', { token: tokenA, body: {} });
    const mediaAfterDelete = await request('POST', '/media/resolve', { token: tokenA, body: { fileIds: [replacementCoverId, secondPhotoId] } });
    check('永久删除植宠联动清理日记和全部媒体', deletedPet.json?.success === true && !aggregateAfterDelete.json?.records?.some((item) => item.plantPetId === petAId) && mediaAfterDelete.json?.missingFileIds?.length === 2, { deletedPet: deletedPet.json, aggregateAfterDelete: aggregateAfterDelete.json, mediaAfterDelete: mediaAfterDelete.json });
    petAId = 0;
  } finally {
    if (tokenA && petAId) await request('POST', '/plant/pet-delete', { token: tokenA, body: { plantPetId: petAId } }).catch(() => {});
    if (tokenB && petBId) await request('POST', '/plant/pet-delete', { token: tokenB, body: { plantPetId: petBId } }).catch(() => {});
  }

  console.log(failures ? `M3 冒烟失败 ${failures} 项` : 'M3 冒烟全部通过');
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error('[m3-smoke] 运行异常:', err.message);
  process.exit(1);
});
