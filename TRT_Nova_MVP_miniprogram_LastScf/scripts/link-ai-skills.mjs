import { existsSync, mkdirSync, readlinkSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';

/**
 * Idempotent junction creator for cross-tool skill compatibility.
 *
 * Creates directory junctions so this single SKILL.md is discoverable by:
 * - Claude Code (.claude/skills)    — canonical source
 * - OpenAI Codex (.codex/skills)    — junction to canonical
 * - Agent SDK (.agents/skills)      — junction to canonical
 *
 * Run after clone: node scripts/link-ai-skills.mjs
 */

const ROOT = process.cwd();
const SKILL_NAME = 'evolving-trt-nova';
const CANONICAL = `.claude/skills/${SKILL_NAME}`;

if (!existsSync(join(ROOT, CANONICAL))) {
  console.error(`ERROR: canonical skill dir missing: ${CANONICAL}`);
  process.exit(1);
}

for (const linkPath of ['.codex/skills', '.agents/skills']) {
  const linkDest = `${linkPath}/${SKILL_NAME}`;
  const absLinkDest = join(ROOT, linkDest);

  if (existsSync(absLinkDest)) {
    console.log(`Junction exists: ${linkDest}`);
    continue;
  }

  const canonicalAbs = resolve(join(ROOT, CANONICAL));
  const linkDir = resolve(join(ROOT, linkPath));
  mkdirSync(linkDir, { recursive: true });

  if (process.platform === 'win32') {
    const winTarget = canonicalAbs.replace(/\//g, '\\');
    const winLink = absLinkDest.replace(/\//g, '\\');
    execSync(`mklink /J "${winLink}" "${winTarget}"`, { stdio: 'inherit' });
  } else {
    symlinkSync(canonicalAbs, absLinkDest);
  }

  console.log(`Created junction: ${linkDest} -> ${CANONICAL}`);
}

console.log('All AI-skill junctions ready.');
