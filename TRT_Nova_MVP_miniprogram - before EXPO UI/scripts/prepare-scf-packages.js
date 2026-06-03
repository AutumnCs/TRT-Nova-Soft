const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const distRoot = path.join(rootDir, 'dist', 'scf');

const packages = [
  {
    name: 'auth-scf',
    source: path.join(rootDir, 'reference', 'authScf.example.js'),
    env: path.join(rootDir, 'reference', 'authScf.env.example'),
    dependencies: {
      mysql2: '^3.14.0'
    },
    description: 'WeChat login -> openid -> JWT token'
  },
  {
    name: 'api-scf',
    source: path.join(rootDir, 'reference', 'scfApi.example.js'),
    env: path.join(rootDir, 'reference', 'apiScf.env.example'),
    dependencies: {
      mysql2: '^3.14.0'
    },
    description: 'Mini program API -> MySQL'
  },
  {
    name: 'ingest-scf',
    source: path.join(rootDir, 'reference', 'ingestScf.lightdb.example.js'),
    env: path.join(rootDir, 'reference', 'ingestScf.env.example'),
    dependencies: {
      mysql2: '^3.14.0'
    },
    description: 'OneNET webhook -> MySQL'
  }
];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeReadme(pkg) {
  return [
    `# ${pkg.name}`,
    '',
    pkg.description,
    '',
    '## Files',
    '',
    '- `index.js`: SCF entry file',
    '- `.env.example`: environment variable template',
    '- `package.json`: deploy-time dependencies',
    '',
    '## Deploy',
    '',
    '1. Run `npm install` in this folder',
    '2. Fill the SCF environment variables in Tencent Cloud console',
    '3. Upload this folder to SCF and set handler to `index.main` or `index.main_handler`',
    ''
  ].join('\n');
}

function copyPackage(pkg) {
  const targetDir = path.join(distRoot, pkg.name);
  ensureDir(targetDir);

  fs.copyFileSync(pkg.source, path.join(targetDir, 'index.js'));
  fs.copyFileSync(pkg.env, path.join(targetDir, '.env.example'));

  writeJson(path.join(targetDir, 'package.json'), {
    name: `trt-nova-${pkg.name}`,
    version: '0.1.0',
    private: true,
    main: 'index.js',
    license: 'UNLICENSED',
    dependencies: pkg.dependencies
  });

  fs.writeFileSync(
    path.join(targetDir, 'README.md'),
    `${writeReadme(pkg)}\n`,
    'utf8'
  );
}

function main() {
  ensureDir(distRoot);
  packages.forEach(copyPackage);

  console.log('SCF deploy packages generated:');
  packages.forEach((pkg) => {
    console.log(`- dist/scf/${pkg.name}`);
  });
}

main();
