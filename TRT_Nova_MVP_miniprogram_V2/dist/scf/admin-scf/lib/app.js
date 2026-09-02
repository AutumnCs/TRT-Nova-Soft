import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAdminAuth } from './auth.js';
import { createAdminRouter } from './router.js';
import { createKnowledgeService } from './knowledgeService.js';
import { createKnowledgeRepository } from './knowledgeRepository.js';
import { createAdminUserRepository } from './adminUserRepository.js';
import { createDeviceService } from './deviceService.js';
import { createUserService } from './userService.js';
import { createLogService } from './logService.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const seedPath = path.join(currentDir, '..', '..', '..', '..', 'data', 'knowledge', 'articles.json');
let seedArticles = [];
try {
  seedArticles = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
} catch (error) {
  console.warn('[admin-scf] seed knowledge unavailable:', error.message);
}

function createRuntimeDbPool() {
  const { DB_HOST, DB_NAME, DB_USER, DB_PASSWORD } = process.env;
  if (!DB_HOST || !DB_NAME || !DB_USER || !DB_PASSWORD) {
    return null;
  }

  const mysql = require('mysql2/promise');
  return mysql.createPool({
    host: DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASSWORD,
    waitForConnections: true,
    connectionLimit: Math.max(1, Number(process.env.DB_CONN_LIMIT || 5)),
    charset: 'utf8mb4'
  });
}

const runtimeDb = createRuntimeDbPool();
const router = createAdminRouter({
  auth: createAdminAuth({
    repository: runtimeDb ? createAdminUserRepository({ db: runtimeDb }) : null
  }),
  knowledge: createKnowledgeService({
    repository: runtimeDb ? createKnowledgeRepository({ db: runtimeDb }) : null,
    seedArticles
  }),
  devices: createDeviceService(),
  users: createUserService(),
  logs: createLogService()
});

export async function main_handler(event = {}, context = {}) {
  return router.handle(event, context);
}
