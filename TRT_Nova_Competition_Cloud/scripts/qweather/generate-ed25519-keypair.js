const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const outputDir = path.resolve(process.argv[2] || path.join(os.homedir(), '.plant-pet-secrets', 'qweather'));
const privateKeyPath = path.join(outputDir, 'ed25519-private.pem');
const publicKeyPath = path.join(outputDir, 'ed25519-public.pem');

if (fs.existsSync(privateKeyPath) || fs.existsSync(publicKeyPath)) {
  throw new Error(`目标目录已有密钥文件，拒绝覆盖：${outputDir}`);
}

fs.mkdirSync(outputDir, { recursive: true });
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
fs.writeFileSync(privateKeyPath, privateKey.export({ format: 'pem', type: 'pkcs8' }), {
  flag: 'wx',
  mode: 0o600
});
fs.writeFileSync(publicKeyPath, publicKey.export({ format: 'pem', type: 'spki' }), {
  flag: 'wx'
});

console.log(`Ed25519 密钥已生成：${outputDir}`);
console.log(`上传到和风天气控制台的公钥：${publicKeyPath}`);
console.log(`只由团队本地保存的私钥：${privateKeyPath}`);
console.log('脚本不会打印私钥内容；不要把私钥发到聊天或提交到 Git。');
