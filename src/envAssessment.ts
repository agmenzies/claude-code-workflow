/**
 * envAssessment.ts
 *
 * Scans the workspace on activation to build a ProjectProfile.
 * Every other module reads this profile instead of guessing paths.
 * Assessment runs in <2s via Promise.all — non-blocking.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// ── Types ────────────────────────────────────────────────────────────────────

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';
export type SwaggerFormat = 'yaml' | 'json' | 'typescript' | 'none';
export type CiProvider = 'azure-pipelines' | 'github-actions' | 'gitlab-ci' | 'none';
export type TestRunner = 'jest' | 'vitest' | 'mocha' | 'playwright' | 'none';

export type ArtefactStatus =
  | 'present'       // exists exactly where expected
  | 'equivalent'    // exists under a different name/path
  | 'custom'        // exists but content differs from shipped template
  | 'alternative'   // exists in a different structure (e.g. agents dir vs single file)
  | 'missing';      // does not exist

export interface DiscoveredDoc {
  expectedName: string;     // the name the extension uses by default
  actualPath: string | null; // relative to workspace root, or null if missing
  status: ArtefactStatus;
  label: string;
  icon: string;
}

export interface DiscoveredSkill {
  name: string;
  status: ArtefactStatus;
  path: string | null;
}

export interface ConflictItem {
  category: 'skill' | 'doc' | 'agent' | 'config' | 'swagger';
  what: string;
  status: ArtefactStatus;
  detail: string;
}

export interface ProjectProfile {
  // Fingerprint
  packageManager: PackageManager;
  framework: string;
  testRunner: TestRunner;
  testConfigPath: string | null;
  testDirectories: string[];
  swaggerFormat: SwaggerFormat;
  swaggerDir: string | null;
  ciProviders: CiProvider[];
  packageScripts: Record<string, string>;

  // Artefacts
  existingSkills: DiscoveredSkill[];
  existingAgents: string[];
  agentStructure: 'single-file' | 'directory' | 'none';
  livingDocs: DiscoveredDoc[];
  extraDocs: DiscoveredDoc[];
  historyFile: { found: boolean; path: string | null; valid: boolean };
  schemaSyncFile: { found: boolean; path: string | null };

  // Conflicts
  conflicts: ConflictItem[];

  // AI tools detected
  aiTools: AiToolDetection[];

  // Derived commands
  testCommand: string;
  buildCommand: string | null;
  lintCommand: string | null;
  checkCommand: string | null;

  // Meta
  assessedAt: Date;
  assessmentDurationMs: number;
}

export type AiToolId = 'claude-code' | 'copilot' | 'cursor' | 'codex' | 'aider' | 'windsurf';

export interface AiToolDetection {
  id: AiToolId;
  name: string;
  detected: boolean;
  contextFile: string;          // where context should be written
  existingContextFile: boolean; // whether the file already exists
}

// ── Known skill names (must match skillRunner.ts) ────────────────────────────

const KNOWN_SKILLS = [
  'update-tests', 'update-uat', 'regression', 'sync-design', 'done-check',
  'audit-api', 'sync-api-docs',
  'log-decision', 'capture-pattern', 'log-failure', 'log-debt',
  'release-notes', 'post-review', 'update-playbooks',
];

// ── Doc equivalence map ──────────────────────────────────────────────────────

interface DocSpec {
  expectedName: string;
  label: string;
  icon: string;
  equivalents: string[];  // alternative file names to check
}

const DOC_SPECS: DocSpec[] = [
  { expectedName: 'instruction-history.toon', label: 'Instruction History', icon: 'history',
    equivalents: ['instruction-history.yaml', 'session-log.toon'] },
  { expectedName: 'UAT.md', label: 'UAT Spec', icon: 'checklist',
    equivalents: ['uat.md', 'docs/UAT.md', 'acceptance-tests.md', 'test-plan-uat.md'] },
  { expectedName: 'design-standards.md', label: 'Design Standards', icon: 'symbol-color',
    equivalents: ['coding-standards.md', 'style-guide.md', 'docs/design-standards.md'] },
  { expectedName: 'decision-log.md', label: 'Decision Log', icon: 'milestone',
    equivalents: ['DECISIONS.md', 'decisions.md', 'docs/decisions.md', 'docs/adr/README.md'] },
  { expectedName: 'patterns-library.md', label: 'Patterns Library', icon: 'extensions',
    equivalents: ['coding-patterns.md', 'docs/patterns.md'] },
  { expectedName: 'failure-modes.md', label: 'Failure Modes', icon: 'bug',
    equivalents: ['troubleshooting.md', 'TROUBLESHOOTING.md', 'known-issues.md', 'docs/troubleshooting.md'] },
  { expectedName: 'tech-debt.md', label: 'Tech Debt', icon: 'flame',
    equivalents: ['TECH-DEBT.md', 'technical-debt.md', 'docs/tech-debt.md'] },
  { expectedName: 'release-notes.md', label: 'Release Notes', icon: 'tag',
    equivalents: ['CHANGELOG.md', 'changelog.md', 'RELEASE-NOTES.md', 'RELEASES.md'] },
  { expectedName: 'agent-playbooks.md', label: 'Agent Playbooks', icon: 'robot',
    equivalents: ['ai-playbooks.md', 'docs/agent-playbooks.md'] },
  { expectedName: 'post-reviews.md', label: 'Post-Reviews', icon: 'comment-discussion',
    equivalents: ['retrospectives.md', 'retros.md', 'docs/post-reviews.md'] },
  { expectedName: 'business-rules.md', label: 'Business Rules', icon: 'law',
    equivalents: ['docs/business-rules.md', 'BUSINESS-RULES.md'] },
  { expectedName: '.claude/api-audit.json', label: 'API Audit Results', icon: 'shield',
    equivalents: [] },
];

// ── Extra doc patterns ───────────────────────────────────────────────────────

const EXTRA_DOC_PATTERNS = [
  { pattern: /^architecture/i, icon: 'symbol-structure' },
  { pattern: /^bug.?report/i, icon: 'bug' },
  { pattern: /notes\.md$/i, icon: 'note' },
  { pattern: /^test.?plan/i, icon: 'beaker' },
  { pattern: /^runbook/i, icon: 'play' },
  { pattern: /^onboarding/i, icon: 'person-add' },
  { pattern: /^security/i, icon: 'shield' },
  { pattern: /^performance/i, icon: 'dashboard' },
  { pattern: /^migration/i, icon: 'arrow-swap' },
  { pattern: /^deployment/i, icon: 'cloud-upload' },
  { pattern: /^roadmap/i, icon: 'map' },
  { pattern: /^api.?guide/i, icon: 'file-code' },
];

// ── Detection functions ──────────────────────────────────────────────────────

function detectPackageManager(root: string): PackageManager {
  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(root, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(root, 'bun.lockb'))) return 'bun';
  return 'npm';
}

function detectFramework(pkg: PackageParsed): string {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps['@nestjs/core']) return 'nestjs';
  if (deps['next']) return 'nextjs';
  if (deps['nuxt']) return 'nuxt';
  if (deps['fastify']) return 'fastify';
  if (deps['@hono/node-server'] || deps['hono']) return 'hono';
  if (deps['express']) return 'express';
  if (deps['koa']) return 'koa';
  return 'unknown';
}

function detectTestRunner(root: string, pkg: PackageParsed): TestRunner {
  const devDeps = pkg.devDependencies ?? {};
  const deps = pkg.dependencies ?? {};
  const all = { ...deps, ...devDeps };

  // Check devDeps first, then config file existence
  if (all['jest'] || all['ts-jest']) return 'jest';
  if (all['vitest']) return 'vitest';
  if (all['mocha']) return 'mocha';
  if (all['@playwright/test']) return 'playwright';

  // Fallback: check config files
  const configs: Array<[string, TestRunner]> = [
    ['jest.config.ts', 'jest'], ['jest.config.js', 'jest'], ['jest.config.mjs', 'jest'],
    ['config/jest.config.ts', 'jest'], ['config/jest.config.js', 'jest'],
    ['vitest.config.ts', 'vitest'], ['vitest.config.js', 'vitest'],
    ['playwright.config.ts', 'playwright'],
    ['.mocharc.yml', 'mocha'], ['.mocharc.json', 'mocha'],
  ];
  for (const [file, runner] of configs) {
    if (fs.existsSync(path.join(root, file))) return runner;
  }
  return 'none';
}

async function findTestConfig(root: string): Promise<string | null> {
  const patterns = [
    '**/jest.config.*', '**/vitest.config.*', '**/playwright.config.*', '**/.mocharc.*',
  ];
  for (const pat of patterns) {
    const uris = await vscode.workspace.findFiles(
      new vscode.RelativePattern(root, pat),
      '**/node_modules/**', 3
    );
    if (uris.length > 0) return path.relative(root, uris[0].fsPath);
  }
  return null;
}

async function findTestDirectories(root: string): Promise<string[]> {
  const uris = await vscode.workspace.findFiles(
    new vscode.RelativePattern(root, '**/*.{test,spec}.{ts,tsx,js,jsx}'),
    '{**/node_modules/**,**/dist/**,**/out/**,**/coverage/**,.next/**}',
    200
  );

  const dirs = new Set<string>();
  for (const uri of uris) {
    const rel = path.relative(root, path.dirname(uri.fsPath));
    // Walk up to find the test root (stop at __tests__ or the first non-test ancestor)
    const parts = rel.split(path.sep);
    const testIdx = parts.indexOf('__tests__');
    if (testIdx >= 0) {
      dirs.add(parts.slice(0, testIdx + 1).join('/'));
    } else {
      dirs.add(rel);
    }
  }
  return [...dirs].sort();
}

async function detectSwaggerFormat(root: string): Promise<{ format: SwaggerFormat; dir: string | null }> {
  const candidates = ['server/swagger', 'swagger', 'openapi', 'docs/api', 'api-docs'];
  for (const dir of candidates) {
    const full = path.join(root, dir);
    if (!fs.existsSync(full)) continue;

    let hasTs = false, hasYaml = false, hasJson = false;
    try {
      const entries = fs.readdirSync(full, { withFileTypes: true, recursive: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const name = entry.name;
        if (name.endsWith('.ts') || name.endsWith('.js')) hasTs = true;
        if (name.endsWith('.yaml') || name.endsWith('.yml')) hasYaml = true;
        if (name.endsWith('.json') && name !== 'package.json') hasJson = true;
      }
    } catch { /* permission denied etc */ }

    if (hasTs) return { format: 'typescript', dir };
    if (hasYaml) return { format: 'yaml', dir };
    if (hasJson) return { format: 'json', dir };
  }
  return { format: 'none', dir: null };
}

function detectCiProviders(root: string): CiProvider[] {
  const providers: CiProvider[] = [];

  // Azure Pipelines
  try {
    const rootFiles = fs.readdirSync(root);
    if (rootFiles.some(f => f.startsWith('azure-pipelines') && f.endsWith('.yml'))) {
      providers.push('azure-pipelines');
    }
  } catch { /* */ }

  // GitHub Actions
  const ghDir = path.join(root, '.github', 'workflows');
  if (fs.existsSync(ghDir)) {
    try {
      const workflows = fs.readdirSync(ghDir);
      if (workflows.some(f => f.endsWith('.yml') || f.endsWith('.yaml'))) {
        providers.push('github-actions');
      }
    } catch { /* */ }
  }

  // Also check .github/ root for azure-pipelines
  const ghRoot = path.join(root, '.github');
  if (fs.existsSync(ghRoot) && !providers.includes('azure-pipelines')) {
    try {
      const ghFiles = fs.readdirSync(ghRoot);
      if (ghFiles.some(f => f.startsWith('azure-pipelines') && f.endsWith('.yml'))) {
        providers.push('azure-pipelines');
      }
    } catch { /* */ }
  }

  // GitLab CI
  if (fs.existsSync(path.join(root, '.gitlab-ci.yml'))) providers.push('gitlab-ci');

  return providers.length > 0 ? providers : ['none'];
}

function discoverSkills(root: string, templateContentMap: Map<string, string>): DiscoveredSkill[] {
  const skillsDir = path.join(root, '.claude', 'skills');
  return KNOWN_SKILLS.map(name => {
    const filePath = path.join(skillsDir, `${name}.md`);
    if (!fs.existsSync(filePath)) {
      return { name, status: 'missing' as ArtefactStatus, path: null };
    }

    // Check if content matches shipped template
    const templateContent = templateContentMap.get(name);
    if (!templateContent) {
      return { name, status: 'custom' as ArtefactStatus, path: `.claude/skills/${name}.md` };
    }

    try {
      const actual = fs.readFileSync(filePath, 'utf8');
      const status: ArtefactStatus = actual.trim() === templateContent.trim() ? 'present' : 'custom';
      return { name, status, path: `.claude/skills/${name}.md` };
    } catch {
      return { name, status: 'custom' as ArtefactStatus, path: `.claude/skills/${name}.md` };
    }
  });
}

function detectAiTools(root: string): AiToolDetection[] {
  const tools: Array<{ id: AiToolId; name: string; indicators: string[]; contextFile: string }> = [
    {
      id: 'claude-code',
      name: 'Claude Code',
      indicators: ['.claude/settings.json', '.claude/agents', '.claude/skills', 'CLAUDE.md'],
      contextFile: '.claude/rules/living-context.md',
    },
    {
      id: 'copilot',
      name: 'GitHub Copilot',
      indicators: ['.github/copilot-instructions.md'],
      contextFile: '.github/copilot-instructions.md',
    },
    {
      id: 'cursor',
      name: 'Cursor',
      indicators: ['.cursorrules', '.cursor/rules'],
      contextFile: '.cursorrules',
    },
    {
      id: 'codex',
      name: 'OpenAI Codex',
      indicators: ['AGENTS.md', 'codex.md'],
      contextFile: 'AGENTS.md',
    },
    {
      id: 'aider',
      name: 'Aider',
      indicators: ['.aider.conf.yml', '.aiderignore'],
      contextFile: '.aider.conf.yml',
    },
    {
      id: 'windsurf',
      name: 'Windsurf',
      indicators: ['.windsurfrules'],
      contextFile: '.windsurfrules',
    },
  ];

  return tools.map(tool => {
    const detected = tool.indicators.some(indicator =>
      fs.existsSync(path.join(root, indicator))
    );
    const existingContextFile = fs.existsSync(path.join(root, tool.contextFile));
    return {
      id: tool.id,
      name: tool.name,
      detected,
      contextFile: tool.contextFile,
      existingContextFile,
    };
  });
}

function discoverAgents(root: string): { agents: string[]; structure: 'single-file' | 'directory' | 'none' } {
  const agentsDir = path.join(root, '.claude', 'agents');
  if (fs.existsSync(agentsDir)) {
    try {
      const files = fs.readdirSync(agentsDir).filter(f => f.endsWith('.md'));
      if (files.length > 0) {
        return { agents: files.map(f => f.replace('.md', '')), structure: 'directory' };
      }
    } catch { /* */ }
  }

  if (fs.existsSync(path.join(root, 'agent-playbooks.md'))) {
    return { agents: ['agent-playbooks'], structure: 'single-file' };
  }

  return { agents: [], structure: 'none' };
}

function discoverLivingDocs(root: string, agentStructure: string): DiscoveredDoc[] {
  return DOC_SPECS.map(spec => {
    // Special case: agent-playbooks with directory structure
    if (spec.expectedName === 'agent-playbooks.md' && agentStructure === 'directory') {
      return {
        ...spec,
        actualPath: '.claude/agents',
        status: 'alternative' as ArtefactStatus,
      };
    }

    // Check exact path
    if (fs.existsSync(path.join(root, spec.expectedName))) {
      return { ...spec, actualPath: spec.expectedName, status: 'present' as ArtefactStatus };
    }

    // Check equivalents
    for (const alt of spec.equivalents) {
      if (fs.existsSync(path.join(root, alt))) {
        return { ...spec, actualPath: alt, status: 'equivalent' as ArtefactStatus };
      }
    }

    return { ...spec, actualPath: null, status: 'missing' as ArtefactStatus };
  });
}

function discoverExtraDocs(root: string, knownPaths: Set<string>): DiscoveredDoc[] {
  const extras: DiscoveredDoc[] = [];
  const scanDirs = [root, path.join(root, 'docs')];

  for (const dir of scanDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const entries = fs.readdirSync(dir);
      for (const file of entries) {
        if (!file.endsWith('.md')) continue;
        const relPath = path.relative(root, path.join(dir, file));
        if (knownPaths.has(relPath)) continue;
        if (file === 'README.md' || file === 'CLAUDE.md' || file === 'replit.md') continue;

        // Check if it matches a known extra pattern
        const matched = EXTRA_DOC_PATTERNS.find(p => p.pattern.test(file));
        if (matched) {
          const label = file.replace(/\.md$/i, '')
            .replace(/[-_]/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase());
          extras.push({
            expectedName: file,
            actualPath: relPath,
            status: 'present',
            label,
            icon: matched.icon,
          });
        }
      }
    } catch { /* */ }
  }
  return extras;
}

function detectHistoryFile(root: string): { found: boolean; path: string | null; valid: boolean } {
  const config = vscode.workspace.getConfiguration('claudeWorkflow');
  const historyFile = config.get<string>('historyFile', 'instruction-history.toon');
  const filePath = path.join(root, historyFile);

  if (!fs.existsSync(filePath)) return { found: false, path: null, valid: false };

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const valid = /instructions\[\d+\]/.test(content);
    return { found: true, path: historyFile, valid };
  } catch {
    return { found: true, path: historyFile, valid: false };
  }
}

function detectSchemaSyncFile(root: string): { found: boolean; path: string | null } {
  const candidates = ['azure-schema-sync.sql', 'schema-sync.sql', 'migrations/schema.sql'];
  for (const file of candidates) {
    if (fs.existsSync(path.join(root, file))) {
      return { found: true, path: file };
    }
  }
  return { found: false, path: null };
}

function detectConflicts(
  skills: DiscoveredSkill[],
  livingDocs: DiscoveredDoc[],
  agentStructure: string,
  swaggerFormat: SwaggerFormat
): ConflictItem[] {
  const conflicts: ConflictItem[] = [];

  for (const skill of skills) {
    if (skill.status === 'custom') {
      conflicts.push({
        category: 'skill', what: skill.name, status: 'custom',
        detail: `Custom skill file — won't be overwritten during scaffolding`,
      });
    }
  }

  for (const doc of livingDocs) {
    if (doc.status === 'equivalent') {
      conflicts.push({
        category: 'doc', what: doc.expectedName, status: 'equivalent',
        detail: `Found as ${doc.actualPath} — will use existing file`,
      });
    }
    if (doc.status === 'alternative') {
      conflicts.push({
        category: 'agent', what: doc.expectedName, status: 'alternative',
        detail: `Agent files exist as individual .md files in .claude/agents/`,
      });
    }
  }

  if (swaggerFormat === 'typescript') {
    conflicts.push({
      category: 'swagger', what: 'Swagger format', status: 'custom',
      detail: 'Swagger is TypeScript code-first — skill templates will be adapted',
    });
  }

  return conflicts;
}

function deriveCommands(
  pm: PackageManager,
  scripts: Record<string, string>
): { testCommand: string; buildCommand: string | null; lintCommand: string | null; checkCommand: string | null } {
  const run = (script: string) => {
    if (!scripts[script]) return null;
    return pm === 'npm' ? `npm run ${script}` : `${pm} ${script}`;
  };

  const testCmd = run('test');
  return {
    testCommand: testCmd ?? (pm === 'npm' ? 'npm test' : `${pm} test`),
    buildCommand: run('build'),
    lintCommand: run('lint'),
    checkCommand: run('check'),
  };
}

// ── Package.json helper ──────────────────────────────────────────────────────

interface PackageParsed {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readPackageJson(root: string): PackageParsed {
  try {
    const content = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
    return JSON.parse(content) as PackageParsed;
  } catch {
    return {};
  }
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

export async function assess(
  root: string,
  templateContentMap?: Map<string, string>
): Promise<ProjectProfile> {
  const start = Date.now();
  const pkg = readPackageJson(root);
  const pm = detectPackageManager(root);
  const scripts = pkg.scripts ?? {};

  // Parallel async detection
  const [testConfigPath, testDirectories, swaggerResult] = await Promise.all([
    findTestConfig(root),
    findTestDirectories(root),
    detectSwaggerFormat(root),
  ]);

  // Synchronous detection (fast, no I/O beyond readdir)
  const framework = detectFramework(pkg);
  const testRunner = detectTestRunner(root, pkg);
  const ciProviders = detectCiProviders(root);
  const agentResult = discoverAgents(root);
  const skills = discoverSkills(root, templateContentMap ?? new Map());
  const livingDocs = discoverLivingDocs(root, agentResult.structure);
  const historyFile = detectHistoryFile(root);
  const schemaSyncFile = detectSchemaSyncFile(root);
  const aiTools = detectAiTools(root);

  // Known paths for extra doc dedup
  const knownPaths = new Set<string>();
  for (const doc of livingDocs) {
    if (doc.actualPath) knownPaths.add(doc.actualPath);
  }
  knownPaths.add('CLAUDE.md');
  knownPaths.add('README.md');
  knownPaths.add('replit.md');
  const extraDocs = discoverExtraDocs(root, knownPaths);

  const conflicts = detectConflicts(skills, livingDocs, agentResult.structure, swaggerResult.format);
  const commands = deriveCommands(pm, scripts);

  return {
    packageManager: pm,
    framework,
    testRunner,
    testConfigPath,
    testDirectories,
    swaggerFormat: swaggerResult.format,
    swaggerDir: swaggerResult.dir,
    ciProviders,
    packageScripts: scripts,
    existingSkills: skills,
    existingAgents: agentResult.agents,
    agentStructure: agentResult.structure,
    aiTools,
    livingDocs,
    extraDocs,
    historyFile,
    schemaSyncFile,
    conflicts,
    ...commands,
    assessedAt: new Date(),
    assessmentDurationMs: Date.now() - start,
  };
}

// ── Cache ────────────────────────────────────────────────────────────────────

let cachedProfile: ProjectProfile | null = null;

export async function getProfile(
  root: string,
  templateContentMap?: Map<string, string>
): Promise<ProjectProfile> {
  if (cachedProfile) return cachedProfile;
  cachedProfile = await assess(root, templateContentMap);
  return cachedProfile;
}

export function invalidateProfile(): void {
  cachedProfile = null;
}

export function getCachedProfile(): ProjectProfile | null {
  return cachedProfile;
}
