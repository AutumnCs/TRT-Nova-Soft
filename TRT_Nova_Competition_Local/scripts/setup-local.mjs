import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { projectRoot, parseEnvironment, validateLocalSettings, argumentsByName } from './local-env.mjs';

export function setupLocal(options = {}, root = projectRoot) {
  const envPath = path.join(root, '.env.local');
  const clientPath = path.join(root, 'services/config/local-runtime.js');
  if (fs.existsSync(envPath) || fs.existsSync(clientPath)) throw new Error('LOCAL_CONFIG_ALREADY_EXISTS_NO_OVERWRITE');
  const env = parseEnvironment(fs.readFileSync(path.join(root, '.env.local.example'), 'utf8'));
  Object.assign(env, {
    DB_HOST: '127.0.0.1', DB_PORT: String(options['db-port'] || 3306),
    DB_NAME: String(options.database || 'nova_competition_local'),
    DB_USER: String(options['db-user'] || 'nova_competition'),
    DB_PASSWORD: options['db-password-env'] ? process.env[options['db-password-env']] || '' : crypto.randomBytes(24).toString('hex'),
    JWT_SECRET: crypto.randomBytes(32).toString('hex'), LOCAL_PORT: String(options.port || 3000)
  });
  validateLocalSettings(env);
  const client = { baseUrl: 'http://127.0.0.1:' + env.LOCAL_PORT };
  fs.writeFileSync(envPath, '# Generated local-only configuration; do not commit.\n' +
    Object.entries(env).map(([key, value]) => key + '=' + value).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
  fs.mkdirSync(path.dirname(clientPath), { recursive: true });
  fs.writeFileSync(clientPath, 'module.exports = ' + JSON.stringify(client, null, 2) + ';\n', { flag: 'wx' });
  return { database: env.DB_NAME, databasePort: Number(env.DB_PORT), localUrl: client.baseUrl,
    files: ['.env.local', 'services/config/local-runtime.js'], credentialsDisplayed: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(setupLocal(argumentsByName()), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
