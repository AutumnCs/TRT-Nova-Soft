import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { projectRoot, readLocalEnvironment, validateLocalSettings } from '../local-env.mjs';

// Operates only on the configured loopback competition database and an owned Node server.
// Existing suites use synthetic smoke identities and never call a model/weather provider.
const settings = validateLocalSettings(readLocalEnvironment());
const evidence = path.join(projectRoot, '.runtime', 'competition-smoke', new Date().toISOString().replaceAll(':', '-'));
fs.mkdirSync(evidence, { recursive: true });
const results = [];
function run(name, command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot, env: { ...process.env, LOCAL_PORT: settings.LOCAL_PORT },
    encoding: 'utf8', timeout: 120000, windowsHide: true
  });
  const output = (result.stdout || '') + (result.stderr || '');
  fs.writeFileSync(path.join(evidence, name + '.log'), output);
  results.push({ name, exitCode: result.status, assertionsPassed: (output.match(/\[PASS\]/g) || []).length });
  console.log(name + ': exit=' + result.status + '; assertions=' + results.at(-1).assertionsPassed);
  if (result.error || result.status !== 0) throw new Error(name + ' failed; inspect ' + evidence);
}
try {
  run('owned-server', 'pwsh', ['-NoProfile', '-File', 'scripts/local-server/manage-local-runtime.ps1', '-Action', 'status']);
  run('schema', process.execPath, ['scripts/local-db/initialize.mjs', '--verify']);
  for (const name of ['smoke', 'm1-smoke', 'm2-smoke', 'm3-smoke']) {
    run(name, process.execPath, ['scripts/local-server/' + name + '.js']);
  }
  fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify({
    status: 'PASS', evidence: 'LOCAL_HTTP_DATABASE_SMOKE', database: settings.DB_NAME,
    localPort: Number(settings.LOCAL_PORT), actualCloudAcceptance: false, physicalDeviceTested: false,
    realProviderTested: false, results
  }, null, 2));
  console.log('PASS: local HTTP/database only; evidence=' + evidence);
} catch (error) {
  fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify({ status: 'FAIL', results, error: error.message }, null, 2));
  console.error(error.message); process.exitCode = 1;
}
