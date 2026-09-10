const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_IMAGE_BYTES,
  isLocalFileId,
  normalizePersistentFileId,
  detectImageMime,
  decodeBase64Image,
  validateImageUploadInput,
  validateDocumentUploadInput
} = require('../lib/media-storage');

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d
]);

test('媒体根据实际字节识别 PNG，不依赖文件名后缀', () => {
  assert.equal(detectImageMime(PNG_BYTES), 'image/png');
  const result = validateImageUploadInput({
    purpose: 'profile_avatar',
    originalName: 'avatar.wrong-extension',
    dataBase64: PNG_BYTES.toString('base64')
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.mimeType, 'image/png');
});

test('媒体明确拒绝不支持格式和超限图片', () => {
  assert.match(decodeBase64Image(Buffer.from('not-an-image').toString('base64')).msg, /JPEG、PNG 或 WebP/);
  const oversized = Buffer.alloc(MAX_IMAGE_BYTES + 1, 0xff).toString('base64');
  assert.match(decodeBase64Image(oversized).msg, /2 MB/);
});

test('日记图片上传必须指定植宠', () => {
  const result = validateImageUploadInput({
    purpose: 'journal_photo',
    dataBase64: PNG_BYTES.toString('base64')
  });
  assert.equal(result.ok, false);
  assert.match(result.msg, /关联植宠/);
});

test('对话图片是合法独立用途，不会冒充诊断图片', () => {
  const result = validateImageUploadInput({
    purpose: 'conversation_image',
    plantPetId: 7,
    dataBase64: PNG_BYTES.toString('base64')
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.purpose, 'conversation_image');
  assert.equal(result.value.plantPetId, 7);
});

test('会话文档按真实内容与扩展名接受常用文本、PDF 和 DOCX', () => {
  const text = validateDocumentUploadInput({
    purpose: 'conversation_document',
    originalName: '月季记录.md',
    dataBase64: Buffer.from('# 月季\n浇水前先看盆土', 'utf8').toString('base64')
  });
  assert.equal(text.ok, true);
  assert.equal(text.value.mimeType, 'text/markdown');

  const pdf = validateDocumentUploadInput({
    purpose: 'conversation_document',
    originalName: 'care.pdf',
    dataBase64: Buffer.from('%PDF-1.4\nmock', 'ascii').toString('base64')
  });
  assert.equal(pdf.ok, true);
  assert.equal(pdf.value.mimeType, 'application/pdf');

  const docx = validateDocumentUploadInput({
    purpose: 'conversation_document',
    originalName: 'care.docx',
    dataBase64: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]).toString('base64')
  });
  assert.equal(docx.ok, true);

  const renamedZip = validateDocumentUploadInput({
    purpose: 'conversation_document',
    originalName: 'care.zip',
    dataBase64: Buffer.from([0x50, 0x4b, 0x03, 0x04]).toString('base64')
  });
  assert.equal(renamedZip.ok, false);
});

test('永久媒体标识接受 local、托管COS、旧cloud与HTTPS，拒绝临时路径', () => {
  assert.equal(normalizePersistentFileId('cos://12345678-1234-1234-1234-123456789abc'), 'cos://12345678-1234-1234-1234-123456789abc');
  assert.equal(isLocalFileId('local://12345678-1234-1234-1234-123456789abc'), true);
  assert.equal(normalizePersistentFileId('wxfile://tmp/avatar.png'), '');
  assert.equal(normalizePersistentFileId('http://example.invalid/a.png'), '');
  assert.equal(normalizePersistentFileId('cloud://env/path/a.png'), 'cloud://env/path/a.png');
});

test('云端认领允许没有附件，不允许外部URL绕过附件归属校验', async () => {
  const previous = process.env.MEDIA_STORAGE_PROVIDER;
  process.env.MEDIA_STORAGE_PROVIDER = 'cos';
  try {
    const { claimLocalMediaFiles } = require('../lib/media-storage');
    const db = { execute() { throw new Error('Must not query for an empty or rejected reference'); } };
    assert.equal((await claimLocalMediaFiles(db, 'owner', [''])).success, true);
    assert.equal((await claimLocalMediaFiles(db, 'owner', ['https://example.invalid/x.png'])).success, false);
    assert.equal((await claimLocalMediaFiles(db, 'owner', ['local://12345678-1234-1234-1234-123456789abc'])).success, false);
  } finally {
    if (previous === undefined) delete process.env.MEDIA_STORAGE_PROVIDER;
    else process.env.MEDIA_STORAGE_PROVIDER = previous;
  }
});

test('云端按单附件解析限制返回大小，不批量返回超出SCF载荷的图片字节', async () => {
  const previous = process.env.MEDIA_STORAGE_PROVIDER;
  process.env.MEDIA_STORAGE_PROVIDER = 'cos';
  try {
    const { resolveLocalMediaForUser } = require('../lib/media-storage');
    const result = await resolveLocalMediaForUser({}, 'owner', { fileIds: [
      'cos://12345678-1234-1234-1234-123456789abc', 'cos://12345678-1234-1234-1234-123456789abd'
    ] });
    assert.equal(result.success, false);
  } finally {
    if (previous === undefined) delete process.env.MEDIA_STORAGE_PROVIDER;
    else process.env.MEDIA_STORAGE_PROVIDER = previous;
  }
});
