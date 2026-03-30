import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { HistoryState } from './historyTracker';
import { SkillName, SkillRunner } from './skillRunner';

type ItemKind = 'section' | 'checklist' | 'skill' | 'doc';

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
      tooltip?: string;
      command?: vscode.Command;
      iconPath?: vscode.ThemeIcon;
      contextValue?: string;
    }
  ) {
    super(label, collapsibleState);
    if (options?.description) this.description = options.description;
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

  constructor(
    private readonly workspaceRoot: string,
    private readonly runner: SkillRunner
  ) {}

  updateHistory(state: HistoryState): void {
    this.historyState = state;
    this._onDidChangeTreeData.fire();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: WorkflowTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: WorkflowTreeItem): WorkflowTreeItem[] {
    if (!element) {
      return this.getRootItems();
    }

    const label = element.label as string;

    if (label === 'Session Checklist') {
      return this.getChecklistItems();
    }
    if (label === 'Skills') {
      return this.getSkillItems();
    }
    if (label === 'Living Docs') {
      return this.getDocItems();
    }

    return [];
  }

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
        'Living Docs',
        'section',
        vscode.TreeItemCollapsibleState.Collapsed,
        { iconPath: new vscode.ThemeIcon('book') }
      ),
    ];
  }

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
        checked: this.fileExists('server/__tests__') || this.fileExists('src/__tests__'),
      },
      {
        label: 'UAT spec current',
        checked: this.fileExistsAndRecent('UAT.md'),
      },
      {
        label: 'Design standards synced',
        checked: this.fileExists('design-standards.md'),
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
          command: c.command
            ? { command: c.command, title: c.label }
            : undefined,
        }
      );
    });
  }

  private getSkillItems(): WorkflowTreeItem[] {
    const skills: Array<{ skill: SkillName; icon: string; key: string }> = [
      { skill: 'update-tests', icon: 'beaker', key: 'skill-update-tests' },
      { skill: 'update-uat', icon: 'checklist', key: 'skill-update-uat' },
      { skill: 'regression', icon: 'run-all', key: 'skill-regression' },
      { skill: 'sync-design', icon: 'symbol-color', key: 'skill-sync-design' },
    ];

    const commandMap: Record<SkillName, string> = {
      'update-tests': 'claudeWorkflow.updateTests',
      'update-uat': 'claudeWorkflow.updateUAT',
      'regression': 'claudeWorkflow.regression',
      'sync-design': 'claudeWorkflow.syncDesign',
    };

    return skills.map(({ skill, icon, key }) => {
      const exists = this.runner.skillExists(skill);
      const meta = SkillRunner.getMeta(skill);
      return new WorkflowTreeItem(
        meta.label,
        'skill',
        vscode.TreeItemCollapsibleState.None,
        {
          description: exists ? '' : '(skill not found)',
          tooltip: meta.description,
          iconPath: new vscode.ThemeIcon(icon),
          contextValue: key,
          command: exists
            ? {
                command: commandMap[skill],
                title: meta.label,
              }
            : undefined,
        }
      );
    });
  }

  private getDocItems(): WorkflowTreeItem[] {
    const docs = [
      { file: 'instruction-history.toon', label: 'Instruction History', icon: 'history' },
      { file: 'UAT.md', label: 'UAT Spec', icon: 'checklist' },
      { file: 'design-standards.md', label: 'Design Standards', icon: 'symbol-color' },
      { file: 'business-rules.md', label: 'Business Rules', icon: 'law' },
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

  private fileExists(rel: string): boolean {
    return fs.existsSync(path.join(this.workspaceRoot, rel));
  }

  private fileExistsAndRecent(rel: string): boolean {
    const full = path.join(this.workspaceRoot, rel);
    if (!fs.existsSync(full)) return false;
    try {
      const stat = fs.statSync(full);
      const ageMs = Date.now() - stat.mtime.getTime();
      return ageMs < 7 * 24 * 60 * 60 * 1000; // within 7 days
    } catch {
      return false;
    }
  }
}
