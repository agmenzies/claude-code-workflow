import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export type SkillName =
  // Workflow
  | 'update-tests'
  | 'update-uat'
  | 'regression'
  | 'sync-design'
  | 'done-check'
  | 'update-observability'
  // API
  | 'audit-api'
  | 'sync-api-docs'
  // Capture
  | 'log-decision'
  | 'capture-pattern'
  | 'log-failure'
  | 'log-debt'
  // Generate
  | 'release-notes'
  | 'post-review'
  | 'update-playbooks'
  | 'plan-sprint'
  | 'risk-review';

export type SkillCategory = 'workflow' | 'api' | 'capture' | 'generate';

interface SkillMeta {
  label: string;
  description: string;
  icon: string;
  category: SkillCategory;
}

const SKILL_META: Record<SkillName, SkillMeta> = {
  // ── Workflow ──
  'update-tests':  { label: 'Update Tests',          description: 'Generate/update tests from instruction history',                 icon: 'beaker',       category: 'workflow' },
  'update-uat':    { label: 'Update UAT',             description: 'Regenerate UAT.md from instruction-history.toon',                icon: 'checklist',    category: 'workflow' },
  'regression':    { label: 'Run Regression',         description: 'Run Jest, TypeScript check, lint, and UAT checklist',            icon: 'run-all',      category: 'workflow' },
  'sync-design':   { label: 'Sync Design Standards',  description: 'Scan codebase and update design-standards.md',                   icon: 'symbol-color', category: 'workflow' },
  'done-check':             { label: 'Definition of Done',          description: 'Run the full DoD checklist against recent work',                 icon: 'tasklist',     category: 'workflow' },
  'update-observability':  { label: 'Update Observability',         description: 'Update observability-expectations.md — logging, metrics, alerting', icon: 'pulse',        category: 'workflow' },

  // ── API ──
  'audit-api':     { label: 'Audit API',              description: 'Check routes for auth, rate limits, validation, Swagger',        icon: 'shield',       category: 'api' },
  'sync-api-docs': { label: 'Sync API Docs',          description: 'Generate/update Swagger for undocumented routes',                icon: 'file-code',    category: 'api' },

  // ── Capture ──
  'log-decision':    { label: 'Log Decision',         description: 'Append to decision-log.md — what, why, alternatives, trade-offs', icon: 'milestone',   category: 'capture' },
  'capture-pattern': { label: 'Capture Pattern',      description: 'Extract a reusable pattern into patterns-library.md',             icon: 'extensions',  category: 'capture' },
  'log-failure':     { label: 'Log Failure Mode',     description: 'Add to failure-modes.md — symptoms, diagnosis, fix, prevention',  icon: 'bug',         category: 'capture' },
  'log-debt':        { label: 'Log Tech Debt',        description: 'Add to tech-debt.md — impact, effort, trigger for action',        icon: 'flame',       category: 'capture' },

  // ── Generate ──
  'release-notes':    { label: 'Release Notes',       description: 'Generate release notes from recent history',                      icon: 'tag',         category: 'generate' },
  'post-review':      { label: 'Post-Review',         description: 'Capture what slowed you down, what was missing',                  icon: 'comment-discussion', category: 'generate' },
  'update-playbooks': { label: 'Update Playbooks',    description: 'Update agent-playbooks.md with prompt templates and patterns',    icon: 'robot',       category: 'generate' },
  'plan-sprint':      { label: 'Plan Sprint',          description: 'Generate prioritised sprint plan from velocity + open backlog',      icon: 'calendar',    category: 'generate' },
  'risk-review':      { label: 'Risk Review',          description: 'Flag triggered tech debt, recent failures, and open API issues',     icon: 'warning',     category: 'generate' },
};

export const SKILL_CATEGORIES: Record<SkillCategory, string> = {
  workflow: 'Workflow',
  api:      'API',
  capture:  'Capture',
  generate: 'Generate',
};

export class SkillRunner {
  private terminal: vscode.Terminal | null = null;

  constructor(private readonly workspaceRoot: string) {}

  async runSkill(skill: SkillName): Promise<void> {
    const claudePath = vscode.workspace
      .getConfiguration('claudeWorkflow')
      .get<string>('claudePath', 'claude');

    const skillFile = path.join(this.workspaceRoot, '.claude', 'skills', `${skill}.md`);
    const skillExists = fs.existsSync(skillFile);

    if (!skillExists) {
      const choice = await vscode.window.showWarningMessage(
        `Skill file not found: .claude/skills/${skill}.md`,
        'Scaffold All Skills',
        'Cancel'
      );
      if (choice === 'Scaffold All Skills') {
        void vscode.commands.executeCommand('claudeWorkflow.scaffoldSkills');
      }
      return;
    }

    const meta = SKILL_META[skill];
    const terminal = this.getOrCreateTerminal();
    terminal.show(true);
    terminal.sendText(`cd "${this.workspaceRoot}" && ${claudePath} "/${skill}"`, true);

    void vscode.window.showInformationMessage(
      `Claude: ${meta.label} — running in terminal`
    );
  }

  skillExists(skill: SkillName): boolean {
    return fs.existsSync(
      path.join(this.workspaceRoot, '.claude', 'skills', `${skill}.md`)
    );
  }

  getAvailableSkills(): SkillName[] {
    return (Object.keys(SKILL_META) as SkillName[]).filter(s => this.skillExists(s));
  }

  getSkillsByCategory(): Map<SkillCategory, SkillName[]> {
    const map = new Map<SkillCategory, SkillName[]>();
    for (const [name, meta] of Object.entries(SKILL_META)) {
      const list = map.get(meta.category) ?? [];
      list.push(name as SkillName);
      map.set(meta.category, list);
    }
    return map;
  }

  private getOrCreateTerminal(): vscode.Terminal {
    if (this.terminal && vscode.window.terminals.includes(this.terminal)) {
      return this.terminal;
    }
    this.terminal = vscode.window.createTerminal({
      name: 'Claude Code Workflow',
      cwd: this.workspaceRoot,
    });
    return this.terminal;
  }

  static getMeta(skill: SkillName): SkillMeta {
    return SKILL_META[skill];
  }

  static getAllSkillNames(): SkillName[] {
    return Object.keys(SKILL_META) as SkillName[];
  }
}
