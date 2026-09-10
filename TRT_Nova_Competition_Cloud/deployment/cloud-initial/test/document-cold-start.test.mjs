import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { documentFixtures } from './fixtures/local-cloud-providers.mjs';
import { projectRoot } from '../tools/migrate-database.mjs';

for (const attempt of [1, 2]) {
  test(`PDF cold process ${attempt}: first and only parse returns text without a retry`, () => {
    const pdf = documentFixtures().find(file => file.name.endsWith('.pdf'));
    const script = `const {extractDocumentText}=require(${JSON.stringify(path.join(projectRoot, 'dist/scf/agent-scf/agent/documentHandler.js'))});
      extractDocumentText({content_blob:Buffer.from(${JSON.stringify(pdf.bytes.toString('base64'))},'base64'),mime_type:'application/pdf'})
      .then(result=>process.stdout.write(JSON.stringify(result)))
      .catch(error=>{console.error(error.message);process.exitCode=1;});`;
    const result = JSON.parse(execFileSync(process.execPath, ['-e', script], { cwd: projectRoot, timeout: 15000, encoding: 'utf8' }));
    assert.equal(result.text, 'Rose care notes: provide ventilation. Check soil before watering.');
    assert.equal(result.truncated, false);
  });
}
