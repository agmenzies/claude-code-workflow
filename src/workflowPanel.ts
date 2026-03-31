import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { HistoryState } from './historyTracker';
import { SkillName, SkillRunner, SkillCategory, SKILL_CATEGORIES } from './skillRunner';
import { AuditSummary } from './apiAuditor';
import type { ProjectProfile } from './envAssessment';
import type { AdoSprintItem } from './azureDevOps';
import type { TrelloCard } from './trelloClient';
import type { PlanningState } from './planningEngine';

type ItemKind =
  | 'section'
  | 'category'
  | 'checklist'
  | 'skill'
  | 'doc'
  | 'api-stat'
  | 'board-header'
  | 'board-item'
  | 'board-action'
  | 'artifact'
  | 'forecast'
  | 'forecast-item';

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
    if (options?.tooltip)      this.tooltip   = options.tooltip;
    if (options?.command)      this.command   = options.command;
    if (options?.iconPath)     this.iconPath  = options.iconPath;
    if (options?.contextValue) this.contextValue = options.contextValue;
  }
}

const COMMAND_MAP: Record<SkillName, string> = {
  'update-tests':         'claudeWorkflow.updateTests',
  'update-uat':           'claudeWorkflow.updateUAT',
  'regression':           'claudeWorkflow.regression',
  'sync-design':          'claudeWorkflow.syncDesign',
  'done-check':           'claudeWorkflow.doneCheck',
  'update-observability': 'claudeWorkflow.updateObservability',
  'audit-api':            'claudeWorkflow.auditApi',
  'sync-api-docs':        'claudeWorkflow.syncApiDocs',
  'log-decision':         'claudeWorkflow.logDecision',
  'capture-pattern':      'claudeWorkflow.capturePattern',
  'log-failure':          'claudeWorkflow.logFailure',
  'log-debt':             'claudeWorkflow.logDebt',
  'release-notes':        'claudeWorkflow.releaseNotes',
  'post-review':          'claudeWorkflow.postReview',
  'update-playbooks':     'claudeWorkflow.updatePlaybooks',
  'plan-sprint':          'claudeWorkflow.planSprint',
  'risk-review':          'claudeWorkflow.riskReview',
};

interface BoardState {
  adoSprintName: string;
  adoItems: AdoSprintItem[];
  trelloCards: TrelloCard[];
  trelloBoardName: string;
  lastLoaded: Date | null;
  loading: boolean;
}

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
  private planningState: PlanningState | null = null;
  private planningComputing = false;
  private boardState: BoardState = {
    adoSprintName:   '',
    adoItems:        [],
    trelloCards:     [],
    trelloBoardName: '',
    lastLoaded:      null,
    loading:         false,
  };

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
    this.auditStale   = stale;
    this._onDidChangeTreeData.fire();
  }

  setBoardState(state: Partial<BoardState>): void {
    this.boardState = { ...this.boardState, ...state };
    this._onDidChangeTreeData.fire();
  }

  refresh(): void { this._onDidChangeTreeData.fire(); }

  setPlanningState(state: PlanningState): void {
    this.planningState = state;
    this.planningComputing = false;
    this._onDidChangeTreeData.fire();
  }

  setPlanningComputing(computing: boolean): void {
    this.planningComputing = computing;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: WorkflowTreeItem): vscode.TreeItem { return element; }

  getChildren(element?: WorkflowTreeItem): WorkflowTreeItem[] {
    if (!element) return this.getRootItems();

    const label = element.label as string;

    if (label === 'Session Checklist') return this.getChecklistItems();
    if (label === 'Skills')            return this.getSkillCategoryItems();
    if (label === 'API Health')        return this.getApiHealthItems();
    if (label === 'Artifacts')         return this.getArtifactItems();
    if (label === 'Board')             return this.getBoardTopItems();
    if (label === 'Forecast')          return this.getForecastItems();

    // Skill sub-categories
    for (const [cat, catLabel] of Object.entries(SKILL_CATEGORIES) as Array<[SkillCategory, string]>) {
      if (label === catLabel) return this.getSkillItemsForCategory(cat);
    }

    // Board sub-sections
    if (label === 'Azure DevOps') return this.getAdoBoardItems();
    if (label === 'Trello')       return this.getTrelloBoardItems();

    return [];
  }

  // ── Root sections ──────────────────────────────────────────────────────────

  private getRootItems(): WorkflowTreeItem[] {
    const adoConfigured    = this.isAdoConfigured();
    const trelloConfigured = this.isTrelloConfigured();
    const boardIcon = this.boardStateIcon();

    const roots: WorkflowTreeItem[] = [
      new WorkflowTreeItem('Session Checklist', 'section',
        vscode.TreeItemCollapsibleState.Expanded,
        { iconPath: new vscode.ThemeIcon('checklist') }),
      new WorkflowTreeItem('Skills', 'section',
        vscode.TreeItemCollapsibleState.Expanded,
        { iconPath: new vscode.ThemeIcon('tools') }),
      new WorkflowTreeItem('API Health', 'section',
        vscode.TreeItemCollapsibleState.Collapsed,
        { iconPath: new vscode.ThemeIcon(this.apiHealthIcon(), this.apiHealthColour()) }),
      new WorkflowTreeItem('Artifacts', 'section',
        vscode.TreeItemCollapsibleState.Collapsed,
        { iconPath: new vscode.ThemeIcon('archive') }),
    ];

    // Only show Board section when at least one integration is configured
    if (adoConfigured || trelloConfigured) {
      roots.push(new WorkflowTreeItem('Board', 'section',
        vscode.TreeItemCollapsibleState.Collapsed,
        { iconPath: new vscode.ThemeIcon(boardIcon),
          description: this.boardStateSummary() }));
    } else {
      // Show Board as a prompt to connect
      roots.push(new WorkflowTreeItem('Board', 'section',
        vscode.TreeItemCollapsibleState.Collapsed,
        { iconPath: new vscode.ThemeIcon('cloud-download'),
          description: 'Connect ADO or Trello' }));
    }

    roots.push(new WorkflowTreeItem('Forecast', 'section',
      vscode.TreeItemCollapsibleState.Collapsed,
      { iconPath: new vscode.ThemeIcon('telescope'),
        description: this.forecastSummary() }));

    return roots;
  }

  // ── Session checklist ──────────────────────────────────────────────────────

  private getChecklistItems(): WorkflowTreeItem[] {
    const items: Array<{ label: string; ok: boolean; cmd?: string }> = [
      { label: 'History updated',         ok: !this.historyState.isStale,              cmd: 'claudeWorkflow.appendHistory' },
      { label: 'Tests updated',           ok: this.hasTests() },
      { label: 'UAT spec current',        ok: this.docRecentByName('UAT.md', 7) },
      { label: 'API audit current',       ok: !this.auditStale && !!this.auditSummary, cmd: 'claudeWorkflow.auditApi' },
      { label: 'Design standards synced', ok: this.docExists('design-standards.md') },
      { label: 'Definition of Done run',  ok: this.recentFile('.claude/dod-result.md', 1), cmd: 'claudeWorkflow.doneCheck' },
    ];

    return items.map(c => {
      const icon = c.ok
        ? new vscode.ThemeIcon('pass',           new vscode.ThemeColor('testing.iconPassed'))
        : new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('testing.iconQueued'));
      return new WorkflowTreeItem(c.label, 'checklist',
        vscode.TreeItemCollapsibleState.None,
        { iconPath: icon, command: c.cmd ? { command: c.cmd, title: c.label } : undefined });
    });
  }

  // ── Skills ─────────────────────────────────────────────────────────────────

  private getSkillCategoryItems(): WorkflowTreeItem[] {
    const catOrder: SkillCategory[] = ['workflow', 'api', 'capture', 'generate'];
    const icons: Record<SkillCategory, string> = { workflow: 'pulse', api: 'shield', capture: 'archive', generate: 'output' };
    return catOrder.map(cat =>
      new WorkflowTreeItem(SKILL_CATEGORIES[cat], 'category',
        vscode.TreeItemCollapsibleState.Collapsed,
        { iconPath: new vscode.ThemeIcon(icons[cat]) })
    );
  }

  private getSkillItemsForCategory(category: SkillCategory): WorkflowTreeItem[] {
    const skills = this.runner.getSkillsByCategory().get(category) ?? [];
    return skills.map(skill => {
      const exists = this.runner.skillExists(skill);
      const meta   = SkillRunner.getMeta(skill);
      return new WorkflowTreeItem(meta.label, 'skill',
        vscode.TreeItemCollapsibleState.None,
        {
          description:  exists ? '' : '(scaffold to create)',
          tooltip:      meta.description,
          iconPath:     new vscode.ThemeIcon(meta.icon),
          contextValue: `skill-${skill}`,
          command:      exists
            ? { command: COMMAND_MAP[skill], title: meta.label }
            : { command: 'claudeWorkflow.scaffoldSkills', title: 'Scaffold Skills' },
        });
    });
  }

  // ── API Health ─────────────────────────────────────────────────────────────

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
      const iconId   = p >= threshold ? 'pass' : p >= threshold - 20 ? 'warning' : 'error';
      const colourId = p >= threshold ? 'testing.iconPassed' : p >= threshold - 20 ? 'list.warningForeground' : 'list.errorForeground';
      return new WorkflowTreeItem(label, 'api-stat', vscode.TreeItemCollapsibleState.None,
        { description: `${val}/${total} (${p}%)`,
          iconPath: new vscode.ThemeIcon(iconId, new vscode.ThemeColor(colourId)) });
    };
    return [
      stat('Swagger coverage', s.documented,   s.totalRoutes, 90),
      stat('Auth applied',     s.withAuth,      s.totalRoutes, 95),
      stat('Rate limiting',    s.withRateLimit, s.totalRoutes, 80),
      new WorkflowTreeItem('Re-run audit', 'api-stat', vscode.TreeItemCollapsibleState.None,
        { iconPath: new vscode.ThemeIcon('refresh'), description: this.auditStale ? '(stale)' : '',
          command: { command: 'claudeWorkflow.auditApi', title: 'Audit' } }),
    ];
  }

  // ── Artifacts (enhanced Living Docs) ──────────────────────────────────────

  private getArtifactItems(): WorkflowTreeItem[] {
    const docs = this.profile
      ? [...this.profile.livingDocs, ...this.profile.extraDocs].filter(d => d.actualPath)
      : this.getLegacyDocList();

    const items: WorkflowTreeItem[] = [];

    for (const doc of docs) {
      const actualPath = 'actualPath' in doc ? (doc.actualPath as string) : (doc as { file: string }).file;
      if (!actualPath) continue;

      const fullPath   = path.join(this.workspaceRoot, actualPath);
      const age        = this.fileAgeBadge(fullPath);
      const openCount  = this.countOpenItems(actualPath);
      const countBadge = openCount > 0 ? ` · ${openCount} open` : '';
      const label      = 'label' in doc ? doc.label : (doc as { label: string }).label;
      const icon       = 'icon' in doc ? (doc.icon as string) : 'file-text';

      items.push(new WorkflowTreeItem(label, 'artifact',
        vscode.TreeItemCollapsibleState.None,
        {
          description:  age ? `${age}${countBadge}` : countBadge || '',
          tooltip:      `${actualPath}${openCount > 0 ? `\n${openCount} open items` : ''}`,
          iconPath:     new vscode.ThemeIcon(icon, this.ageColour(fullPath)),
          command:      { command: 'vscode.open', title: `Open ${label}`,
            arguments: [vscode.Uri.file(fullPath)] },
        }));
    }

    // Add missing docs as grey placeholders so users know what they can create
    if (this.profile) {
      for (const doc of this.profile.livingDocs) {
        if (doc.status === 'missing') {
          items.push(new WorkflowTreeItem(doc.label, 'artifact',
            vscode.TreeItemCollapsibleState.None,
            { description: '(not created yet)',
              iconPath: new vscode.ThemeIcon(doc.icon, new vscode.ThemeColor('disabledForeground')),
              command: { command: 'claudeWorkflow.scaffoldSkills', title: 'Scaffold Skills' } }));
        }
      }
    }

    return items;
  }

  private getLegacyDocList(): Array<{ label: string; file: string; icon: string; actualPath: string }> {
    const docs = [
      { label: 'Instruction History', file: 'instruction-history.toon', icon: 'history',     actualPath: 'instruction-history.toon' },
      { label: 'UAT Spec',            file: 'UAT.md',                   icon: 'checklist',    actualPath: 'UAT.md' },
      { label: 'Design Standards',    file: 'design-standards.md',      icon: 'symbol-color', actualPath: 'design-standards.md' },
      { label: 'Decision Log',        file: 'decision-log.md',          icon: 'milestone',    actualPath: 'decision-log.md' },
      { label: 'Tech Debt',           file: 'tech-debt.md',             icon: 'flame',        actualPath: 'tech-debt.md' },
      { label: 'Failure Modes',       file: 'failure-modes.md',         icon: 'bug',          actualPath: 'failure-modes.md' },
      { label: 'Business Rules',      file: 'business-rules.md',        icon: 'law',          actualPath: 'business-rules.md' },
      { label: 'API Audit Results',   file: '.claude/api-audit.json',   icon: 'shield',       actualPath: '.claude/api-audit.json' },
    ];
    return docs.filter(d => this.fileExists(d.file));
  }

  // ── Board section ──────────────────────────────────────────────────────────

  private getBoardTopItems(): WorkflowTreeItem[] {
    const ado    = this.isAdoConfigured();
    const trello = this.isTrelloConfigured();

    if (!ado && !trello) {
      return [
        new WorkflowTreeItem('Connect Azure DevOps', 'board-action',
          vscode.TreeItemCollapsibleState.None,
          { iconPath: new vscode.ThemeIcon('cloud'),
            description: 'Open Settings',
            command: { command: 'workbench.action.openSettings', title: 'Settings',
              arguments: ['claudeWorkflow.azureDevOps'] } }),
        new WorkflowTreeItem('Connect Trello', 'board-action',
          vscode.TreeItemCollapsibleState.None,
          { iconPath: new vscode.ThemeIcon('plug'),
            command: { command: 'claudeWorkflow.connectTrello', title: 'Connect Trello' } }),
      ];
    }

    const items: WorkflowTreeItem[] = [];
    if (ado)    items.push(new WorkflowTreeItem('Azure DevOps', 'board-header',
      vscode.TreeItemCollapsibleState.Expanded,
      { iconPath: new vscode.ThemeIcon('azure'), description: this.adoBoardSummary() }));
    if (trello) items.push(new WorkflowTreeItem('Trello', 'board-header',
      vscode.TreeItemCollapsibleState.Expanded,
      { iconPath: new vscode.ThemeIcon('versions'), description: this.trelloBoardSummary() }));
    return items;
  }

  private getAdoBoardItems(): WorkflowTreeItem[] {
    const items: WorkflowTreeItem[] = [];

    if (this.boardState.loading) {
      items.push(new WorkflowTreeItem('Loading\u2026', 'board-item',
        vscode.TreeItemCollapsibleState.None,
        { iconPath: new vscode.ThemeIcon('loading~spin') }));
      return items;
    }

    if (this.boardState.adoItems.length === 0 && !this.boardState.lastLoaded) {
      items.push(new WorkflowTreeItem('Refresh to load sprint items', 'board-action',
        vscode.TreeItemCollapsibleState.None,
        { iconPath: new vscode.ThemeIcon('refresh'),
          command: { command: 'claudeWorkflow.refreshBoard', title: 'Refresh Board' } }));
    } else {
      if (this.boardState.adoSprintName) {
        items.push(new WorkflowTreeItem(
          `\uD83D\uDCC5 ${this.boardState.adoSprintName}`,
          'board-item',
          vscode.TreeItemCollapsibleState.None,
          { description: `${this.boardState.adoItems.length} items`, iconPath: new vscode.ThemeIcon('calendar') }
        ));
      }
      for (const wi of this.boardState.adoItems.slice(0, 8)) {
        const stateIcon = this.adoStateIcon(wi.state);
        items.push(new WorkflowTreeItem(wi.title, 'board-item',
          vscode.TreeItemCollapsibleState.None,
          { description: wi.state,
            tooltip:     `${wi.workItemType} #${wi.id}${wi.assignedTo ? ` · ${wi.assignedTo}` : ''}`,
            iconPath:    new vscode.ThemeIcon(stateIcon) }));
      }
      if (this.boardState.adoItems.length > 8) {
        items.push(new WorkflowTreeItem(
          `+${this.boardState.adoItems.length - 8} more items`,
          'board-item', vscode.TreeItemCollapsibleState.None,
          { iconPath: new vscode.ThemeIcon('ellipsis') }));
      }
    }

    // Action buttons
    items.push(
      new WorkflowTreeItem('Create Work Items', 'board-action',
        vscode.TreeItemCollapsibleState.None,
        { description: 'from tech debt, DoD, API issues',
          iconPath: new vscode.ThemeIcon('add'),
          command: { command: 'claudeWorkflow.syncMultiSourceItems', title: 'Create Work Items' } }),
      new WorkflowTreeItem('Sync Board Status', 'board-action',
        vscode.TreeItemCollapsibleState.None,
        { description: 'close resolved items in living docs',
          iconPath: new vscode.ThemeIcon('sync'),
          command: { command: 'claudeWorkflow.syncBoardStatus', title: 'Sync Board Status' } }),
      new WorkflowTreeItem('Refresh', 'board-action',
        vscode.TreeItemCollapsibleState.None,
        { iconPath: new vscode.ThemeIcon('refresh'),
          description: this.boardState.lastLoaded ? `last: ${this.relativeTime(this.boardState.lastLoaded)}` : '',
          command: { command: 'claudeWorkflow.refreshBoard', title: 'Refresh Board' } }),
    );

    return items;
  }

  private getTrelloBoardItems(): WorkflowTreeItem[] {
    const items: WorkflowTreeItem[] = [];
    const cfg = vscode.workspace.getConfiguration('claudeWorkflow.trello');
    const boardName = cfg.get<string>('boardName') || 'Trello';

    if (this.boardState.trelloCards.length === 0) {
      items.push(new WorkflowTreeItem('Refresh to load In Progress cards', 'board-action',
        vscode.TreeItemCollapsibleState.None,
        { iconPath: new vscode.ThemeIcon('refresh'),
          command: { command: 'claudeWorkflow.refreshBoard', title: 'Refresh Board' } }));
    } else {
      items.push(new WorkflowTreeItem(`${boardName} \u2014 In Progress`, 'board-item',
        vscode.TreeItemCollapsibleState.None,
        { description: `${this.boardState.trelloCards.length} cards`,
          iconPath: new vscode.ThemeIcon('versions') }));
      for (const card of this.boardState.trelloCards.slice(0, 6)) {
        items.push(new WorkflowTreeItem(card.name, 'board-item',
          vscode.TreeItemCollapsibleState.None,
          { iconPath: new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.blue')),
            tooltip:  card.desc?.slice(0, 120) || card.name,
            command:  { command: 'vscode.open', title: 'Open in Trello',
              arguments: [vscode.Uri.parse(card.url)] } }));
      }
    }

    items.push(
      new WorkflowTreeItem('Create Cards', 'board-action',
        vscode.TreeItemCollapsibleState.None,
        { description: 'from tech debt, DoD, API issues',
          iconPath: new vscode.ThemeIcon('add'),
          command: { command: 'claudeWorkflow.syncToTrello', title: 'Create Trello Cards' } }),
      new WorkflowTreeItem('Refresh', 'board-action',
        vscode.TreeItemCollapsibleState.None,
        { iconPath: new vscode.ThemeIcon('refresh'),
          command: { command: 'claudeWorkflow.refreshBoard', title: 'Refresh Board' } }),
    );

    return items;
  }

  // ── Forecast section ───────────────────────────────────────────────────────

  private getForecastItems(): WorkflowTreeItem[] {
    if (this.planningComputing || (!this.planningState && !this.planningComputing)) {
      return [new WorkflowTreeItem(
        this.planningComputing ? 'Computing\u2026' : 'No data yet \u2014 refresh to compute',
        'forecast-item', vscode.TreeItemCollapsibleState.None,
        { iconPath: new vscode.ThemeIcon(this.planningComputing ? 'loading~spin' : 'sync'),
          command: this.planningComputing ? undefined : { command: 'claudeWorkflow.refresh', title: 'Refresh' } }
      )];
    }

    const s       = this.planningState!;
    const r       = s.readiness;
    const v       = s.velocity;
    const total   = s.backlog.length;
    const critical = s.backlog.filter(i => i.priority === 'Critical').length;

    const readinessColour = r.colour === 'green'
      ? new vscode.ThemeColor('testing.iconPassed')
      : r.colour === 'amber'
        ? new vscode.ThemeColor('list.warningForeground')
        : new vscode.ThemeColor('list.errorForeground');

    const readinessIcon = r.colour === 'green' ? 'pass'
      : r.colour === 'amber' ? 'warning' : 'error';

    const trendIcon = v.trend === 'up' ? 'arrow-up'
      : v.trend === 'down' ? 'arrow-down' : 'arrow-right';

    const trendSuffix = v.trendPercent > 0
      ? ` ${v.trend === 'up' ? '\u2191' : v.trend === 'down' ? '\u2193' : '\u2192'} ${v.trendPercent}%`
      : '';

    const sprintPlanLabel = s.sprintPlanExists
      ? (s.sprintPlanAgeDays === 0 ? 'Sprint planned today'
        : s.sprintPlanAgeDays === 1 ? 'Sprint planned yesterday'
        : `Sprint plan ${s.sprintPlanAgeDays}d old`)
      : 'No sprint plan yet';

    return [
      new WorkflowTreeItem('Release Readiness', 'forecast-item',
        vscode.TreeItemCollapsibleState.None,
        { description: `${r.score}/100 \u00b7 Grade ${r.grade}`,
          iconPath: new vscode.ThemeIcon(readinessIcon, readinessColour),
          tooltip: `DoD: ${r.breakdown.dodScore}/25 \u00b7 API: ${r.breakdown.apiScore}/25 \u00b7 Debt: ${r.breakdown.debtScore}/25 \u00b7 UAT: ${r.breakdown.uatScore}/25` }),
      new WorkflowTreeItem('Velocity', 'forecast-item',
        vscode.TreeItemCollapsibleState.None,
        { description: `${v.fourWeekAverage}/week${trendSuffix}`,
          iconPath: new vscode.ThemeIcon(trendIcon),
          tooltip: `4-week average: ${v.fourWeekAverage} entries/week. Prior 4 weeks: ${v.priorFourWeekAverage}` }),
      new WorkflowTreeItem('Open Backlog', 'forecast-item',
        vscode.TreeItemCollapsibleState.None,
        { description: `${total} items${critical > 0 ? `, ${critical} critical` : ''}`,
          iconPath: new vscode.ThemeIcon('issues') }),
      new WorkflowTreeItem('Sprint Capacity', 'forecast-item',
        vscode.TreeItemCollapsibleState.None,
        { description: `~${v.sprintCapacity} items this sprint`,
          iconPath: new vscode.ThemeIcon('calendar') }),
      new WorkflowTreeItem(sprintPlanLabel, 'forecast-item',
        vscode.TreeItemCollapsibleState.None,
        { iconPath: new vscode.ThemeIcon(s.sprintPlanExists ? 'check' : 'circle-outline'),
          command: s.sprintPlanExists
            ? { command: 'vscode.open', title: 'Open Sprint Plan',
                arguments: [vscode.Uri.file(path.join(this.workspaceRoot, '.claude', 'sprint-plan.md'))] }
            : undefined }),
      new WorkflowTreeItem('Open Sprint Planner', 'forecast-item',
        vscode.TreeItemCollapsibleState.None,
        { iconPath: new vscode.ThemeIcon('telescope'),
          command: { command: 'claudeWorkflow.openPlanner', title: 'Open Sprint Planner' } }),
      new WorkflowTreeItem('Generate Sprint Plan', 'forecast-item',
        vscode.TreeItemCollapsibleState.None,
        { description: '(AI-powered)',
          iconPath: new vscode.ThemeIcon('output'),
          command: { command: 'claudeWorkflow.planSprint', title: 'Generate Sprint Plan' } }),
      new WorkflowTreeItem('Run Risk Review', 'forecast-item',
        vscode.TreeItemCollapsibleState.None,
        { description: '(AI-powered)',
          iconPath: new vscode.ThemeIcon('warning'),
          command: { command: 'claudeWorkflow.riskReview', title: 'Run Risk Review' } }),
    ];
  }

  private forecastSummary(): string {
    if (!this.planningState) return '';
    const { readiness, backlog } = this.planningState;
    const critical = backlog.filter(i => i.priority === 'Critical').length;
    return critical > 0
      ? `${readiness.score}% \u00b7 ${critical} critical`
      : `${readiness.score}%`;
  }

  // ── Artifact helpers ───────────────────────────────────────────────────────

  private fileAgeBadge(fullPath: string): string {
    try {
      const mtime    = fs.statSync(fullPath).mtime;
      const diffMs   = Date.now() - mtime.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays === 0)  return 'today';
      if (diffDays === 1)  return 'yesterday';
      if (diffDays <= 6)   return `${diffDays}d ago`;
      if (diffDays <= 13)  return 'last week';
      if (diffDays <= 29)  return `${Math.floor(diffDays / 7)}w ago`;
      return 'stale';
    } catch { return ''; }
  }

  private ageColour(fullPath: string): vscode.ThemeColor | undefined {
    try {
      const diffDays = Math.floor((Date.now() - fs.statSync(fullPath).mtime.getTime()) / 86400000);
      if (diffDays <= 1)  return new vscode.ThemeColor('testing.iconPassed');
      if (diffDays <= 7)  return undefined;
      if (diffDays <= 14) return new vscode.ThemeColor('list.warningForeground');
      return new vscode.ThemeColor('list.errorForeground');
    } catch { return new vscode.ThemeColor('disabledForeground'); }
  }

  private countOpenItems(relPath: string): number {
    const fullPath = path.join(this.workspaceRoot, relPath);
    if (!fs.existsSync(fullPath)) return 0;
    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      const base = path.basename(relPath);

      if (base === 'tech-debt.md') {
        const sections = content.split(/^### TD-/gm).slice(1);
        return sections.filter(s => {
          const statusMatch = s.match(/\*\*Status\*\*:\s*(.+)/i);
          return !statusMatch || !statusMatch[1].toLowerCase().includes('resolved');
        }).length;
      }
      if (base === 'failure-modes.md') {
        return (content.match(/^### FM-/gm) ?? []).length;
      }
      if (base === 'decision-log.md') {
        return (content.match(/^### DEC-/gm) ?? []).length;
      }
      if (base === 'post-reviews.md') {
        return (content.match(/^- \[ \] /gm) ?? []).length;
      }
      if (base === 'instruction-history.toon') {
        const m = content.match(/instructions\[(\d+)\]/);
        return m ? parseInt(m[1], 10) : 0;
      }
      return 0;
    } catch { return 0; }
  }

  // ── Board helpers ─────────────────────────────────────────────────────────

  private isAdoConfigured(): boolean {
    const cfg = vscode.workspace.getConfiguration('claudeWorkflow.azureDevOps');
    return !!(cfg.get<string>('organization') && cfg.get<string>('project'));
  }

  private isTrelloConfigured(): boolean {
    const cfg = vscode.workspace.getConfiguration('claudeWorkflow.trello');
    return !!(cfg.get<string>('boardId') && cfg.get<string>('backlogListId'));
  }

  private boardStateIcon(): string {
    if (this.boardState.loading) return 'loading~spin';
    return 'project';
  }

  private boardStateSummary(): string {
    const total = this.boardState.adoItems.length + this.boardState.trelloCards.length;
    if (this.boardState.loading) return 'loading\u2026';
    if (total === 0 && this.boardState.lastLoaded) return '0 items';
    if (total > 0) return `${total} items`;
    return '';
  }

  private adoBoardSummary(): string {
    if (!this.boardState.lastLoaded) return '';
    return this.boardState.adoSprintName
      ? `${this.boardState.adoSprintName} · ${this.boardState.adoItems.length} items`
      : `${this.boardState.adoItems.length} items`;
  }

  private trelloBoardSummary(): string {
    const n = this.boardState.trelloCards.length;
    return n > 0 ? `${n} in progress` : '';
  }

  private adoStateIcon(state: string): string {
    const s = state.toLowerCase();
    if (s === 'active' || s === 'in progress') return 'circle-filled';
    if (s === 'new' || s === 'proposed')       return 'circle-outline';
    if (s === 'resolved' || s === 'closed' || s === 'done') return 'pass';
    return 'circle-outline';
  }

  private relativeTime(date: Date): string {
    const diffMs = Date.now() - date.getTime();
    const mins   = Math.floor(diffMs / 60000);
    if (mins < 1)  return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  // ── General helpers ────────────────────────────────────────────────────────

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

  private hasTests(): boolean {
    if (this.profile) return this.profile.testDirectories.length > 0;
    return ['server/__tests__', 'src/__tests__', '__tests__', 'test', 'tests']
      .some(d => this.fileExists(d));
  }

  private docExists(expectedName: string): boolean {
    if (this.profile) {
      const doc = this.profile.livingDocs.find(d => d.expectedName === expectedName);
      return doc?.status === 'present' || doc?.status === 'equivalent' || doc?.status === 'alternative';
    }
    return this.fileExists(expectedName);
  }

  private docRecentByName(expectedName: string, days: number): boolean {
    if (this.profile) {
      const doc = this.profile.livingDocs.find(d => d.expectedName === expectedName);
      if (!doc?.actualPath) return false;
      return this.recentFile(doc.actualPath, days);
    }
    return this.recentFile(expectedName, days);
  }
}
