import { createAdminAuth } from './lib/auth.js';
import { createAdminRouter } from './lib/router.js';

const auth = createAdminAuth();
const router = createAdminRouter({
  auth,
  knowledge: {},
  devices: {},
  users: {},
  logs: {}
});

export async function main_handler(event = {}, context = {}) {
  return router.handle(event, context);
}
