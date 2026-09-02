const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const distRoot = path.join(rootDir, 'dist', 'scf');
const knowledgeSeedPath = path.join(rootDir, 'data', 'knowledge', 'articles.json');

const packages = [
  {
    name: 'auth-scf',
    description: 'WeChat login -> openid -> JWT token',
    envLines: [
      '# WeChat login and JWT settings',
      'DB_HOST=',
      'DB_PORT=3306',
      'DB_NAME=',
      'DB_USER=',
      'DB_PASSWORD=',
      'JWT_SECRET='
    ],
    dependencies: {
      mysql2: '^3.14.0'
    }
  },
  {
    name: 'api-scf',
    description: 'Mini program API -> MySQL',
    envLines: [
      '# Mini program API settings',
      'DB_HOST=',
      'DB_PORT=3306',
      'DB_NAME=',
      'DB_USER=',
      'DB_PASSWORD=',
      'JWT_SECRET=',
      'ONENET_PRODUCT_ACCESS_KEY=',
      'EMQX_PUBLISH_URL='
    ],
    dependencies: {
      mysql2: '^3.14.0'
    }
  },
  {
    name: 'ingest-scf',
    description: 'OneNET webhook -> MySQL',
    envLines: [
      '# Ingest SCF settings',
      'DB_HOST=',
      'DB_PORT=3306',
      'DB_NAME=',
      'DB_USER=',
      'DB_PASSWORD=',
      'ONENET_ACCESS_KEY='
    ],
    dependencies: {
      mysql2: '^3.14.0'
    }
  },
  {
    name: 'agent-scf',
    description: 'Plant care chat backend with lightweight knowledge retrieval',
    envLines: [
      '# Agent SCF settings',
      'DB_HOST=',
      'DB_PORT=3306',
      'DB_NAME=',
      'DB_USER=',
      'DB_PASSWORD=',
      'LLM_API_ENABLED=false',
      'LLM_API_BASE_URL=',
      'LLM_API_KEY=',
      'LLM_MODEL='
    ],
    dependencies: {
      mysql2: '^3.14.0'
    }
  },
  {
    name: 'history-cleanup-scf',
    description: 'History aggregation and cleanup tasks',
    envLines: [
      '# History cleanup SCF settings',
      'DB_HOST=',
      'DB_PORT=3306',
      'DB_NAME=',
      'DB_USER=',
      'DB_PASSWORD='
    ],
    dependencies: {
      mysql2: '^3.14.0'
    }
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
    '1. Run `npm install` in this folder if the SCF runtime needs dependencies',
    '2. Fill the SCF environment variables in Tencent Cloud console',
    '3. Upload this folder to SCF and set handler to `index.main` or `index.main_handler`',
    ''
  ].join('\n');
}

function writeFileIfMissing(filePath, content) {
  if (fs.existsSync(filePath)) return;
  fs.writeFileSync(filePath, content, 'utf8');
}

function ensurePackageManifest(pkg, targetDir) {
  const packageJsonPath = path.join(targetDir, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    return;
  }

  writeJson(packageJsonPath, {
    name: `trt-nova-${pkg.name}`,
    version: '0.1.0',
    private: true,
    main: 'index.js',
    license: 'UNLICENSED',
    dependencies: pkg.dependencies
  });
}

function ensureEnvExample(pkg, targetDir) {
  const envPath = path.join(targetDir, '.env.example');
  writeFileIfMissing(envPath, `${pkg.envLines.join('\n')}\n`);
}

function ensureReadme(pkg, targetDir) {
  const readmePath = path.join(targetDir, 'README.md');
  writeFileIfMissing(readmePath, `${writeReadme(pkg)}\n`);
}

function copyFileIfExists(sourcePath, targetPath) {
  if (!fs.existsSync(sourcePath)) return false;
  ensureDir(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
  return true;
}

function copyKnowledgeSeed(pkg, targetDir) {
  if (!['api-scf', 'agent-scf'].includes(pkg.name)) return;
  const targetPath = path.join(targetDir, 'data', 'knowledge', 'articles.json');
  if (!copyFileIfExists(knowledgeSeedPath, targetPath)) {
    console.warn(`Knowledge seed not found, skipped: ${knowledgeSeedPath}`);
  }
}

function validateIndexJs(targetDir, pkg) {
  const indexPath = path.join(targetDir, 'index.js');
  if (!fs.existsSync(indexPath)) {
    throw new Error(`Missing index.js for ${pkg.name} at ${indexPath}`);
  }
}

function main() {
  ensureDir(distRoot);

  packages.forEach((pkg) => {
    const targetDir = path.join(distRoot, pkg.name);
    ensureDir(targetDir);
    validateIndexJs(targetDir, pkg);
    ensurePackageManifest(pkg, targetDir);
    ensureEnvExample(pkg, targetDir);
    ensureReadme(pkg, targetDir);
    copyKnowledgeSeed(pkg, targetDir);
  });

  console.log('SCF package directories verified:');
  packages.forEach((pkg) => {
    console.log(`- dist/scf/${pkg.name}`);
  });
}

main();
