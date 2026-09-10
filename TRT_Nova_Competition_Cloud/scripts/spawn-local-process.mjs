import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

// Launch a hidden detached process with explicit stdin/stdout/stderr destinations.
// No shell, command-string evaluation, credentials, or environment serialization.
const [executable, cwd, stdoutPath, stderrPath, ...args] = process.argv.slice(2);
if (!executable || !cwd || !stdoutPath || !stderrPath) throw new Error('SPAWN_ARGUMENTS_REQUIRED');
for (const file of [stdoutPath, stderrPath]) {
  if (!path.resolve(file).startsWith(path.resolve(cwd) + path.sep)) throw new Error('LOG_PATH_OUTSIDE_RUNTIME');
}
const out = fs.openSync(stdoutPath, 'a');
const err = fs.openSync(stderrPath, 'a');
const child = spawn(executable, args, { cwd, detached: true, windowsHide: true, shell: false, stdio: ['ignore', out, err] });
child.once('error', error => { console.error(error.code || 'SPAWN_FAILED'); process.exitCode = 1; });
child.once('spawn', () => { console.log(JSON.stringify({ processId: child.pid })); child.unref(); });
fs.closeSync(out); fs.closeSync(err);
