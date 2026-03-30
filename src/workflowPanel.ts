import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { HistoryState } from './historyTracker';
import { SkillName, SkillRunner } from './skillRunner';
import { AuditSummary } from './apiAuditor';

type ItemKind = 'section' | 'checklist' | 'skill' | 'doc' | 'api-stat';

interface ChecklistItem {
  label: string;
  checked: boolean;
  command?: string;
}

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

export class WorkflowPanelProvider
  implements vscode.TreeDataProvider<WorkflowTreeItem>
{
  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<WorkflowTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private historyState: HistoryState = {
    lastModified: null,
    entryCount: 0,
    isStale: false,
    filePath: null,
  };

  private auditSummary: AuditSummary | null = null;
  private auditStale = true;

  constructor(
    private readonly workspaceRoot: string,
    private readonly runner: SkillRunner
  ) {}

  updateHistory(state: HistoryState): void {
    this.historyState = state;
    this._onDidChangeTreeData.fire();
  }

  updateAudit(summary: AuditSummary | null, stale: boolean): void {
    this.auditSummary = summary;
    this.auditStale = stale;
    this._onDidChangeTreeData.fire();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: WorkflowTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: WorkflowTreeItem): WorkflowTreeItem[] {
    if (!element) return this.getRootItems();

    switch (element.label as string) {
      case 'Session Checklist': return this.getChecklistItems();
      case 'Skills':            return this.getSkillItems();
      case 'API Health':        return this.getApiHealthItems();
      case 'Living Docs':       return this.getDocItems();
      default:                  return [];
    }
  }

  // ── Sections ──────────────────────────────────────────────────────────────

  private getRootItems(): WorkflowTreeItem[] {
    return [
      new WorkflowTreeItem(
        'Session Checklist',
        'section',
        vscode.TreeItemCollapsibleState.Expanded,
        { iconPath: new vscode.ThemeIcon('checklist') }
      ),
      new WorkflowTreeItem(
        'Skills',
        'section',
        vscode.TreeItemCollapsibleState.Expanded,
        { iconPath: new vscode.ThemeIcon('tools') }
      ),
      new WorkflowTreeItem(
        'API Health',
        'section',
        vscode.TreeItemCollapsibleState.Expanded,
        {
          iconPath: new vscode.ThemeIcon(
            this.apiHealthIcon(),
            this.apiHealthColour()
          ),
        }
      ),
      new WorkflowTreeItem(
        'Living Docs',
        'section',
        vscode.TreeItemCollapsibleState.Collapsed,
        { iconPath: new vscode.ThemeIcon('book') }
      ),
    ];
  }

  // ── Session checklist ──────────────────────────────────────────────────────

  private getChecklistItems(): WorkflowTreeItem[] {
    const checks: ChecklistItem[] = [
      {
        label: 'Instruction history updated',
        checked: !this.historyState.isStale,
        command: 'claudeWorkflow.appendHistory',
      },
      {
        label: 'Schema synced (if changed)',
        checked: this.fileExists('azure-schema-sync.sql'),
      },
      {
        label: 'Tests updated',
        checked:
          this.fileExists('server/__tests__') ||
          this.fileExists('src/__tests__') ||
          this.fileExists('__tests__'),
      },
      {
        label: 'UAT spec current',
        checked: this.fileExistsAndRecent('UAT.md', 7),
      },
      {
        label: 'Design standards synced',
        checked: this.fileExists('design-standards.md'),
      },
      {
        label: 'API audit current',
        checked: !this.auditStale && this.auditSummary !== null,
        command: 'claudeWorkflow.auditApi',
      },
    ];

    return checks.map(c => {
      const icon = c.checked
        ? new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'))
        : new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('testing.iconQueued'));

      return new WorkflowTreeItem(
        c.label,
        'checklist',
        vscode.TreeItemCollapsibleState.None,
        {
          iconPath: icon,
          command: c.command ? { command: c.command, title: c.label } : undefined,
        }
      );
    });
  }

  // ── Skills ────────────────────────────────────────────────────────────────

  private getSkillItems(): WorkflowTreeItem[] {
    const skills: Array<{ skill: SkillName; icon: string; key: string }> = [
      { skill: 'update-tests',  icon: 'beaker',       key: 'skill-update-tests' },
      { skill: 'update-uat',    icon: 'checklist',    key: 'skill-update-uat' },
      { skill: 'regression',    icon: 'run-all',      key: 'skill-regression' },
      { skill: 'sync-design',   icon: 'symbol-color', key: 'skill-sync-design' },
      { skill: 'audit-api',     icon: 'shield',       key: 'skill-audit-api' },
      { skill: 'sync-api-docs', icon: 'file-code',    key: 'skill-sync-api-docs' },
    ];

    const commandMap: Record<SkillName, string> = {
      'update-tests':  'claudeWorkflow.updateTests',
      'update-uat':    'claudeWorkflow.updateUAT',
      'regression':    'claudeWorkflow.regression',
      'sync-design':   'claudeWorkflow.syncDesign',
      'audit-api':     'claudeWorkflow.auditApi',
      'sync-api-docs': 'claudeWorkflow.syncApiDocs',
    };

    return skills.map(({ skill, icon, key }) => {
      const exists = this.runner.skillExists(skill);
      const meta = SkillRunner.getMeta(skill);
      return new WorkflowTreeItem(
        meta.label,
        'skill',
        vscode.TreeItemCollapsibleState.None,
        {
          description: exists ? '' : '(not scaffolded)',
          tooltip: exists
            ? meta.description
            : `${meta.description}\n\nRun "Scaffold API Skills" to create this skill file.`,
          iconPath: new vscode.ThemeIcon(icon),
          contextValue: key,
          command: exists
            ? { command: commandMap[skill], title: meta.label }
            : { command: 'claudeWorkflow.scaffoldApiSkills', title: 'Scaffold Skills' },
        }
      );
    });
  }

  // ── API Health ────────────────────────────────────────────────────────────

  private getApiHealthItems(): WorkflowTreeItem[] {
    if (!this.auditSummary) {
      return [
        new WorkflowTreeItem(
          this.auditStale && this.fileExists('.claude/api-audit.json')
            ? 'Audit results are stale (>24h)'
            : 'No audit yet — run Audit API',
          'api-stat',
          vscode.TreeItemCollapsibleState.None,
          {
            iconPath: new vscode.ThemeIcon('warning'),
            command: { command: 'claudeWorkflow.auditApi', title: 'Run Audit' },
          }
        ),
      ];
    }

    const s = this.auditSummary;
    const coveragePct = s.totalRoutes > 0
      ? Math.round((s.documented / s.totalRoutes) * 100)
      : 100;
    const authPct = s.totalRoutes > 0
      ? Math.round((s.withAuth / s.totalRoutes) * 100)
      : 100;
    const ratePct = s.totalRoutes > 0
      ? Math.round((s.withRateLimit / s.totalRoutes) * 100)
      : 100;

    const stat = (
      label: string,
      pct: number,
      count: number,
      total: number,
      goodThreshold: number
    ) => {
      const icon =
        pct >= goodThreshold
          ? new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'))
          : pct >= goodThreshold - 20
          ? new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'))
          : new vscode.ThemeIcon('error', new vscode.ThemeColor('list.errorForeground'));

      return new WorkflowTreeItem(label, 'api-stat', vscode.TreeItemCollapsibleState.None, {
        description: `${count} / ${total} (${pct}%)`,
        iconPath: icon,
      });
    };

    return [
      stat('Swagger coverage',    coveragePct, s.documented,      s.totalRoutes, 90),
      stat('Auth applied',        authPct,     s.withAuth,        s.totalRoutes, 95),
      stat('Rate limiting',       ratePct,     s.withRateLimit,   s.totalRoutes, 80),
      new WorkflowTreeItem(
        'Re-run audit',
        'api-stat',
        vscode.TreeItemCollapsibleState.None,
        {
          iconPath: new vscode.ThemeIcon('refresh'),
          command: { command: 'claudeWorkflow.auditApi', title: 'Audit API' },
          description: this.auditStale ? '(stale)' : '',
        }
      ),
    ];
  }

  // ── Living docs ───────────────────────────────────────────────────────────

  private getDocItems(): WorkflowTreeItem[] {
    const docs = [
      { file: 'instruction-history.toon', label: 'Instruction History', icon: 'history' },
      { file: 'UAT.md',                   label: 'UAT Spec',            icon: 'checklist' },
      { file: 'design-standards.md',      label: 'Design Standards',    icon: 'symbol-color' },
      { file: 'business-rules.md',        label: 'Business Rules',      icon: 'law' },
      { file: '.claude/api-audit.json',   label: 'API Audit Results',   icon: 'shield' },
    ];

    return docs
      .filter(d => this.fileExists(d.file))
      .map(d => {
        const absPath = path.join(this.workspaceRoot, d.file);
        return new WorkflowTreeItem(
          d.label,
          'doc',
          vscode.TreeItemCollapsibleState.None,
          {
            iconPath: new vscode.ThemeIcon(d.icon),
            command: {
              command: 'vscode.open',
              title: `Open ${d.label}`,
              arguments: [vscode.Uri.file(absPath)],
            },
          }
        );
      });
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  private apiHealthIcon(): string {
    if (!this.auditSummary) return 'shield';
    const s = this.auditSummary;
    const issues = s.totalRoutes - s.withAuth + (s.totalRoutes - s.documented);
    return issues === 0 ? 'shield-check' : 'shield';
  }

  private apiHealthColour(): vscode.ThemeColor | undefined {
    if (!this.auditSummary) return new vscode.ThemeColor('list.warningForeground');
    const s = this.auditSummary;
    if (s.withAuth < s.totalRoutes) return new vscode.ThemeColor('list.errorForeground');
    if (s.documented < s.totalRoutes) return new vscode.ThemeColor('list.warningForeground');
    return new vscode.ThemeColor('testing.iconPassed');
  }

  private fileExists(rel: string): boolean {
    return fs.existsSync(path.join(this.workspaceRoot, rel));
  }

  private fileExistsAndRecent(rel: string, days: number): boolean {
    const full = path.join(this.workspaceRoot, rel);
    if (!fs.existsSync(full)) return false;
    try {
      const stat = fs.statSync(full);
      return Date.now() - stat.mtime.getTime() < days * 24 * 60 * 60 * 1000;
    } catch {
      return false;
    }
  }
}
