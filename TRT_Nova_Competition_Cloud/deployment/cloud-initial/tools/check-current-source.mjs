import fs from 'node:fs';
import path from 'node:path';
import { cloudRoot, repoRoot, loadPolicy, collectFirstPartyFiles, cloudOverlaysForFunction, sha256File } from './common.mjs';

// Refuse stale test evidence: compare the runnable candidate against today's source,
// not just against its own (possibly old but internally consistent) manifest.
const mismatches = [];
let compared = 0;
const policy = loadPolicy();
for (const unit of policy.functions) {
  const sourceDir = path.join(repoRoot, policy.sourceRoot, unit.name);
  const buildDir = path.join(cloudRoot, 'build', unit.name);
  const pairs = collectFirstPartyFiles(policy, unit)
    .filter(file => path.basename(file) !== 'package.json')
    .map(file => [file, path.join(buildDir, path.relative(sourceDir, file))]);
  for (const name of ['package.json', 'package-lock.json']) pairs.push([
    path.join(cloudRoot, 'locks', unit.name, name), path.join(buildDir, name)]);
  for (const name of cloudOverlaysForFunction(unit.name)) {
    pairs.push([path.join(cloudRoot, 'overlays', name), path.join(buildDir, name)]);
  }
  for (const [source, candidate] of pairs) {
    compared++;
    if (!fs.existsSync(candidate) || sha256File(source) !== sha256File(candidate)) mismatches.push(path.relative(cloudRoot, candidate));
  }
  const manifestPath = path.join(buildDir, 'NOVA_PACKAGE_MANIFEST.json');
  if (!fs.existsSync(manifestPath) || JSON.parse(fs.readFileSync(manifestPath, 'utf8')).sourcePolicySha256 !== sha256File(path.join(cloudRoot, 'source-policy.json'))) {
    mismatches.push(unit.name + ':source-policy');
  }
}
console.log(JSON.stringify({ ok: !mismatches.length, compared, mismatches,
  claim: 'BUILT_FUNCTION_SOURCE_PARITY_ONLY_NOT_CLOUD_ACCEPTANCE' }, null, 2));
if (mismatches.length) process.exitCode = 1;
