import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAdminAuth } from './lib/auth.js';
import { createAdminRouter } from './lib/router.js';
import { createKnowledgeService } from './lib/knowledgeService.js';
import { createDeviceService } from './lib/deviceService.js';
import { createUserService } from './lib/userService.js';
import { createLogService } from './lib/logService.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const seedPath = path.join(currentDir, '..', '..', '..', 'data', 'knowledge', 'articles.json');
let seedArticles = [];
try {
  seedArticles = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
} catch (error) {
  console.warn('[admin-scf] seed knowledge unavailable:', error.message);
}

const auth = createAdminAuth();
const router = createAdminRouter({
  auth,
  knowledge: createKnowledgeService({ seedArticles }),
  devices: createDeviceService(),
  users: createUserService(),
  logs: createLogService()
});

export async function main_handler(event = {}, context = {}) {
  return router.handle(event, context);
}
