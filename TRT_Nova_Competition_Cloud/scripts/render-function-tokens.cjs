// Build-time UI text rendering, using the existing Lucide plug asset.
// No user image or generated illustration is used. Runtime keeps tool metadata separate.
const path = require('node:path');
const fs = require('node:fs');
const { createCanvas, loadImage } = require(process.env.NOVA_CANVAS_MODULE || '@napi-rs/canvas');
const labels = { plant_status: '查看植株状态', watering: '判断是否浇水', memory: '读取相关记忆' };
(async () => {
  const dir = path.join(__dirname, '../images/icons/function-tokens');
  fs.mkdirSync(dir, { recursive: true });
  const icon = await loadImage(path.join(__dirname, '../images/icons/message/plug.svg'));
  for (const [key, label] of Object.entries(labels)) {
    const canvas = createCanvas(180 * 3, 38 * 3);
    const ctx = canvas.getContext('2d');
    ctx.scale(3, 3);
    ctx.drawImage(icon, 0, 10, 26, 26);
    ctx.font = '24px "Microsoft YaHei"';
    ctx.fillStyle = '#2778c9';
    // Native inline images align their bottom to the text baseline.
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(label, 32, 37 - ctx.measureText(label).actualBoundingBoxDescent);
    fs.writeFileSync(path.join(dir, key + '.png'), canvas.toBuffer('image/png'));
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
