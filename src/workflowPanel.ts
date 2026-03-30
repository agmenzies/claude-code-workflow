import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { HistoryState } from './historyTracker';
import { SkillName, SkillRunner, SkillCategory, SKILL_CATEGORIES } from './skillRunner';
import { AuditSummary } from './apiAuditor';
import type { ProjectProfile } from './envAssessment';

type ItemKind = 'section' | 'category' | 'checklist' | 'skill' | 'doc' | 'api-stat';

class WorkflowTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly kind: ItemKind,
    collapsibleState: vscode.TreeItemCollapsibleState,
    options?: {
      description?: string;
      tooltip?: string | vscode.MarkdownString;
      command?: vscode.Command;
      iconPath?: vscode.ThemeIcon;
      contextValue?: string;
    }
  ) {
    super(label, collapsibleState);
    if (options?.description !== undefined) this.description = options.description;
    if (options?.tooltip) this.tooltip = options.tooltip;
    if (options?.command) this.command = options.command;
    if (options?.iconPath) this.iconPath = options.iconPath;
    if (options?.contextValue) this.contextValue = options.contextValue;
  }
}

// Map from skill name → VS Code command ID
const COMMAND_MAP: Record<SkillName, string> = {
  'update-tests':    'claudeWorkflow.updateTests',
  'update-uat':      'claudeWorkflow.updateUAT',
  'regression':      'claudeWorkflow.regression',
  'sync-design':     'claudeWorkflow.syncDesign',
  'done-check':      'claudeWorkflow.doneCheck',
  'audit-api':       'claudeWorkflow.auditApi',
  'sync-api-docs':   'claudeWorkflow.syncApiDocs',
  'log-decision':    'claudeWorkflow.logDecision',
  'capture-pattern': 'claudeWorkflow.capturePattern',
  'log-failure':     'claudeWorkflow.logFailure',
  'log-debt':        'claudeWorkflow.logDebt',
  'release-notes':   'claudeWorkflow.releaseNotes',
  'post-review':     'claudeWorkflow.postReview',
  'update-playbooks':'claudeWorkflow.updatePlaybooks',
};

export class WorkflowPanelProvider
  implements vscode.TreeDataProvider<WorkflowTreeItem>
{
  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<WorkflowTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private historyState: HistoryState = {
    lastModified: null, entryCount: 0, isStale: false, filePath: null,
  };
  private auditSummary: AuditSummary | null = null;
  private auditStale = true;
  private profile: ProjectProfile | null = null;

  constructor(
    private readonly workspaceRoot: string,
    private readonly runner: SkillRunner
  ) {}

  setProfile(profile: ProjectProfile): void {
    this.profile = profile;
    this._onDidChangeTreeData.fire();
  }

  updateHistory(state: HistoryState): void {
    this.historyState = state;
    this._onDidChangeTreeData.fire();
  }

  updateAudit(summary: AuditSummary | null, stale: boolean): void {
    this.auditSummary = summary;
    this.auditStale = stale;
    this._onDidChangeTreeData.fire();
  }

  refresh(): void { this._onDidChangeTreeData.fire(); }

  getTreeItem(element: WorkflowTreeItem): vscode.TreeItem { return element; }

  getChildren(element?: WorkflowTreeItem): WorkflowTreeItem[] {
    if (!element) return this.getRootItems();

    const label = element.label as string;

    // Top-level sections
    if (label === 'Session Checklist') return this.getChecklistItems();
    if (label === 'Skills')            return this.getSkillCategoryItems();
    if (label === 'API Health')        return this.getApiHealthItems();
    if (label === 'Living Docs')       return this.getDocItems();

    // Skill sub-categories
    const categoryEntries = Object.entries(SKILL_CATEGORIES) as Array<[SkillCategory, string]>;
    for (const [cat, catLabel] of categoryEntries) {
      if (label === catLabel) return this.getSkillItemsForCategory(cat);
    }

    return [];
  }

  // ── Root sections ──────────────────────────────────────────────────────────

  private getRootItems(): WorkflowTreeItem[] {
    return [
      new WorkflowTreeItem('Session Checklist', 'section',
        vscode.TreeItemCollapsibleState.Expanded,
        { iconPath: new vscode.ThemeIcon('checklist') }),
      new WorkflowTreeItem('Skills', 'section',
        vscode.TreeItemCollapsibleState.Expanded,
        { iconPath: new vscode.ThemeIcon('tools') }),
      new WorkflowTreeItem('API Health', 'section',
        vscode.TreeItemCollapsibleState.Collapsed,
        { iconPath: new vscode.ThemeIcon(this.apiHealthIcon(), this.apiHealthColour()) }),
      new WorkflowTreeItem('Living Docs', 'section',
        vscode.TreeItemCollapsibleState.Collapsed,
        { iconPath: new vscode.ThemeIcon('book') }),
    ];
  }

  // ── Session checklist ──────────────────────────────────────────────────────

  private getChecklistItems(): WorkflowTreeItem[] {
    const items: Array<{ label: string; ok: boolean; cmd?: string }> = [
      { label: 'History updated',        ok: !this.historyState.isStale,              cmd: 'claudeWorkflow.appendHistory' },
      { label: 'Tests updated',          ok: this.hasTests() },
      { label: 'UAT spec current',       ok: this.docRecentByName('UAT.md', 7) },
      { label: 'API audit current',      ok: !this.auditStale && !!this.auditSummary, cmd: 'claudeWorkflow.auditApi' },
      { label: 'Design standards synced', ok: this.docExists('design-standards.md') },
      { label: 'Definition of Done run',  ok: this.recentFile('.claude/dod-result.md', 1), cmd: 'claudeWorkflow.doneCheck' },
    ];

    return items.map(c => {
      const icon = c.ok
        ? new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'))
        : new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('testing.iconQueued'));
      return new WorkflowTreeItem(c.label, 'checklist',
        vscode.TreeItemCollapsibleState.None,
        { iconPath: icon, command: c.cmd ? { command: c.cmd, title: c.label } : undefined });
    });
  }

  // ── Skills (categorised) ──────────────────────────────────────────────────

  private getSkillCategoryItems(): WorkflowTreeItem[] {
    const catOrder: SkillCategory[] = ['workflow', 'api', 'capture', 'generate'];
    const icons: Record<SkillCategory, string> = {
      workflow: 'pulse',
      api: 'shield',
      capture: 'archive',
      generate: 'output',
    };

    return catOrder.map(cat =>
      new WorkflowTreeItem(SKILL_CATEGORIES[cat], 'category',
        vscode.TreeItemCollapsibleState.Collapsed,
        { iconPath: new vscode.ThemeIcon(icons[cat]) })
    );
  }

  private getSkillItemsForCategory(category: SkillCategory): WorkflowTreeItem[] {
    const byCategory = this.runner.getSkillsByCategory();
    const skills = byCategory.get(category) ?? [];

    return skills.map(skill => {
      const exists = this.runner.skillExists(skill);
      const meta = SkillRunner.getMeta(skill);
      return new WorkflowTreeItem(meta.label, 'skill',
        vscode.TreeItemCollapsibleState.None,
        {
          description: exists ? '' : '(scaffold to create)',
          tooltip: meta.description,
          iconPath: new vscode.ThemeIcon(meta.icon),
          contextValue: `skill-${skill}`,
          command: exists
            ? { command: COMMAND_MAP[skill], title: meta.label }
            : { command: 'claudeWorkflow.scaffoldSkills', title: 'Scaffold Skills' },
        });
    });
  }

  // ── API Health ────────────────────────────────────────────────────────────

  private getApiHealthItems(): WorkflowTreeItem[] {
    if (!this.auditSummary) {
      return [new WorkflowTreeItem(
        this.fileExists('.claude/api-audit.json') ? 'Audit stale (>24h)' : 'No audit yet',
        'api-stat', vscode.TreeItemCollapsibleState.None,
        { iconPath: new vscode.ThemeIcon('warning'),
          command: { command: 'claudeWorkflow.auditApi', title: 'Run Audit' } })];
    }

    const s = this.auditSummary;
    const pct = (n: number, d: number) => d > 0 ? Math.round((n / d) * 100) : 100;

    const stat = (label: string, val: number, total: number, threshold: number) => {
      const p = pct(val, total);
      const iconId = p >= threshold ? 'pass'
        : p >= threshold - 20 ? 'warning' : 'error';
      const colourId = p >= threshold ? 'testing.iconPassed'
        : p >= threshold - 20 ? 'list.warningForeground' : 'list.errorForeground';
      return new WorkflowTreeItem(label, 'api-stat',
        vscode.TreeItemCollapsibleState.None,
        { description: `${val}/${total} (${p}%)`,
          iconPath: new vscode.ThemeIcon(iconId, new vscode.ThemeColor(colourId)) });
    };

    return [
      stat('Swagger coverage', s.documented, s.totalRoutes, 90),
      stat('Auth applied',     s.withAuth,   s.totalRoutes, 95),
      stat('Rate limiting',    s.withRateLimit, s.totalRoutes, 80),
      new WorkflowTreeItem('Re-run audit', 'api-stat',
        vscode.TreeItemCollapsibleState.None,
        { iconPath: new vscode.ThemeIcon('refresh'),
          description: this.auditStale ? '(stale)' : '',
          command: { command: 'claudeWorkflow.auditApi', title: 'Audit' } }),
    ];
  }

  // ── Living docs ───────────────────────────────────────────────────────────

  private getDocItems(): WorkflowTreeItem[] {
    if (!this.profile) return this.getLegacyDocItems();

    const items: WorkflowTreeItem[] = [];

    // Living docs discovered by assessment (show found ones)
    for (const doc of this.profile.livingDocs) {
      if (!doc.actualPath) continue;
      const suffix = doc.status === 'equivalent' ? ` (${path.basename(doc.actualPath)})` : '';
      const altSuffix = doc.status === 'alternative' ? ' (agents dir)' : '';
      items.push(new WorkflowTreeItem(doc.label, 'doc',
        vscode.TreeItemCollapsibleState.None,
        {
          description: suffix || altSuffix || '',
          iconPath: new vscode.ThemeIcon(doc.icon),
          command: { command: 'vscode.open', title: `Open ${doc.label}`,
            arguments: [vscode.Uri.file(path.join(this.workspaceRoot, doc.actualPath))] },
        }));
    }

    // Extra docs discovered by assessment (project-specific docs)
    for (const doc of this.profile.extraDocs) {
      if (!doc.actualPath) continue;
      items.push(new WorkflowTreeItem(doc.label, 'doc',
        vscode.TreeItemCollapsibleState.None,
        {
          description: '(discovered)',
          iconPath: new vscode.ThemeIcon(doc.icon),
          command: { command: 'vscode.open', title: `Open ${doc.label}`,
            arguments: [vscode.Uri.file(path.join(this.workspaceRoot, doc.actualPath))] },
        }));
    }

    return items;
  }

  /** Fallback when profile hasn't loaded yet. */
  private getLegacyDocItems(): WorkflowTreeItem[] {
    const docs = [
      { file: 'instruction-history.toon', label: 'Instruction History', icon: 'history' },
      { file: 'UAT.md', label: 'UAT Spec', icon: 'checklist' },
      { file: 'design-standards.md', label: 'Design Standards', icon: 'symbol-color' },
      { file: 'decision-log.md', label: 'Decision Log', icon: 'milestone' },
      { file: 'business-rules.md', label: 'Business Rules', icon: 'law' },
      { file: '.claude/api-audit.json', label: 'API Audit Results', icon: 'shield' },
    ];
    return docs.filter(d => this.fileExists(d.file)).map(d =>
      new WorkflowTreeItem(d.label, 'doc', vscode.TreeItemCollapsibleState.None,
        { iconPath: new vscode.ThemeIcon(d.icon),
          command: { command: 'vscode.open', title: `Open ${d.label}`,
            arguments: [vscode.Uri.file(path.join(this.workspaceRoot, d.file))] } })
    );
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private apiHealthIcon(): string {
    if (!this.auditSummary) return 'shield';
    return this.auditSummary.withAuth >= this.auditSummary.totalRoutes ? 'shield-check' : 'shield';
  }

  private apiHealthColour(): vscode.ThemeColor | undefined {
    if (!this.auditSummary) return new vscode.ThemeColor('list.warningForeground');
    if (this.auditSummary.withAuth < this.auditSummary.totalRoutes)
      return new vscode.ThemeColor('list.errorForeground');
    if (this.auditSummary.documented < this.auditSummary.totalRoutes)
      return new vscode.ThemeColor('list.warningForeground');
    return new vscode.ThemeColor('testing.iconPassed');
  }

  private fileExists(rel: string): boolean {
    return fs.existsSync(path.join(this.workspaceRoot, rel));
  }

  private recentFile(rel: string, days: number): boolean {
    const full = path.join(this.workspaceRoot, rel);
    try {
      const stat = fs.statSync(full);
      return Date.now() - stat.mtime.getTime() < days * 24 * 60 * 60 * 1000;
    } catch { return false; }
  }

  /** Profile-aware test directory check. Falls back to legacy glob if no profile. */
  private hasTests(): boolean {
    if (this.profile) return this.profile.testDirectories.length > 0;
    return ['server/__tests__', 'src/__tests__', '__tests__', 'test', 'tests']
      .some(d => this.fileExists(d));
  }

  /** Check if a living doc exists — uses profile equivalence if available. */
  private docExists(expectedName: string): boolean {
    if (this.profile) {
      const doc = this.profile.livingDocs.find(d => d.expectedName === expectedName);
      return doc?.status === 'present' || doc?.status === 'equivalent' || doc?.status === 'alternative';
    }
    return this.fileExists(expectedName);
  }

  /** Check if a living doc was recently updated — resolves actual path via profile. */
  private docRecentByName(expectedName: string, days: number): boolean {
    if (this.profile) {
      const doc = this.profile.livingDocs.find(d => d.expectedName === expectedName);
      if (!doc?.actualPath) return false;
      return this.recentFile(doc.actualPath, days);
    }
    return this.recentFile(expectedName, days);
  }
}
