import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const CORE_REQUIRED_FILES = [
  'AGENTS.md',
  'docs/ai-project-map.md',
  'docs/ai-workflow.md',
  'docs/current-architecture.md',
  'data/knowledge/articles.json',
  'dist/scf/api-scf/index.js',
  'dist/scf/auth-scf/index.js',
  'dist/scf/ingest-scf/index.js',
  'dist/scf/agent-scf/index.js',
  'dist/scf/history-cleanup-scf/index.js',
  'dist/scf/api-scf/data/knowledge/articles.json',
  'dist/scf/agent-scf/data/knowledge/articles.json',
  'dist/scf/api-scf/knowledge.js',
  'services/core/ScfApiAdapter.js',
  'services/modules/DeviceService.js',
  'services/modules/KnowledgeService.js',
  '.claude/skills/evolving-trt-nova/SKILL.md',
  '.claude/skills/evolving-trt-nova/agents/openai.yaml',
  'scripts/link-ai-skills.mjs'
];

const ADMIN_REQUIRED_FILES = [
  'AGENTS.md',
  'admin-web/index.html',
  'dist/scf/admin-scf/index.js'
];

export function checkAiContext({ projectRoot = process.cwd() } = {}) {
  const root = resolve(projectRoot);
  const errors = [];
  const warnings = [];

  for (const file of getRequiredFiles(root)) {
    if (!existsSync(join(root, file))) {
      errors.push(`missing: ${file}`);
    }
  }

  validateSkillMetadata(root, errors);
  validateRedisEvidence(root, warnings);
  validateJunctionsExist(root, warnings);

  return { errors, warnings };
}

function getRequiredFiles(root) {
  if (hasAdminConsoleBoundary(root) && !hasCoreContextSignals(root)) {
    return ADMIN_REQUIRED_FILES;
  }

  return CORE_REQUIRED_FILES;
}

function hasAdminConsoleBoundary(root) {
  return (
    existsSync(join(root, 'admin-web')) ||
    existsSync(join(root, 'admin-web', 'index.html')) ||
    existsSync(join(root, 'dist', 'scf', 'admin-scf')) ||
    existsSync(join(root, 'dist', 'scf', 'admin-scf', 'index.js'))
  );
}

function hasCoreContextSignals(root) {
  return CORE_REQUIRED_FILES.some((file) => {
    if (file === 'AGENTS.md') {
      return false;
    }
    return existsSync(join(root, file));
  });
}

function validateJunctionsExist(root, warnings) {
  const links = ['.codex/skills/evolving-trt-nova', '.agents/skills/evolving-trt-nova'];
  const missing = links.filter(p => !existsSync(join(root, p)));
  if (missing.length > 0) {
    warnings.push(`cross-tool junctions missing (run: node scripts/link-ai-skills.mjs): ${missing.join(', ')}`);
  }
}

function validateSkillMetadata(root, errors) {
  const skillPath = join(root, '.claude/skills/evolving-trt-nova/SKILL.md');
  const metadataPath = join(root, '.claude/skills/evolving-trt-nova/agents/openai.yaml');

  if (existsSync(skillPath)) {
    const skill = readFileSync(skillPath, 'utf8');
    if (!/^name:\s*evolving-trt-nova$/m.test(skill)) {
      errors.push('skill metadata: expected name: evolving-trt-nova');
    }
    if (!/^description:\s*Use when\b/m.test(skill)) {
      errors.push('skill metadata: description must start with Use when');
    }
  }

  if (existsSync(metadataPath)) {
    const yaml = readFileSync(metadataPath, 'utf8');
    if (!/default_prompt:\s*".*\$evolving-trt-nova.*"/s.test(yaml)) {
      errors.push('skill metadata: default_prompt must mention $evolving-trt-nova');
    }
  }
}

function validateRedisEvidence(root, warnings) {
  const projectMapPath = join(root, 'docs/ai-project-map.md');
  if (!existsSync(projectMapPath)) {
    return;
  }

  const projectMap = readFileSync(projectMapPath, 'utf8');
  if (/\bredis\b/i.test(projectMap)) {
    return;
  }

  const docsDir = join(root, 'docs');
  if (!existsSync(docsDir)) {
    return;
  }

  const redisEvidence = scanMarkdownFor(redisWord, docsDir, projectMapPath);
  if (redisEvidence.length > 0) {
    warnings.push(
      `project map should mention Redis because other docs reference it: ${redisEvidence
        .map((file) => relative(root, file))
        .join(', ')}`
    );
  }
}

function scanMarkdownFor(pattern, dir, excludedPath) {
  const matches = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (fullPath === excludedPath) {
      continue;
    }
    if (entry.isDirectory()) {
      matches.push(...scanMarkdownFor(pattern, fullPath, excludedPath));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.md')) {
      continue;
    }
    const content = readFileSync(fullPath, 'utf8');
    if (pattern.test(content)) {
      matches.push(fullPath);
    }
  }

  return matches;
}

const redisWord = /\bredis\b/i;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = checkAiContext();
  for (const error of result.errors) {
    console.error(error);
  }
  for (const warning of result.warnings) {
    console.warn(warning);
  }
  process.exitCode = result.errors.length > 0 ? 1 : 0;
}
