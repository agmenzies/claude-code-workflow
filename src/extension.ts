import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { HistoryTracker } from './historyTracker';
import { SkillRunner } from './skillRunner';
import { WorkflowPanelProvider } from './workflowPanel';
import { WorkflowStatusBar } from './statusBar';
import { ApiDiagnosticsProvider } from './apiDiagnostics';
import { getScaffoldableForProfile, getScaffoldableTemplates } from './skillTemplates';
import { WikiSyncProvider, SyncResult } from './wikiSync';
import { WorkItemSyncProvider } from './workItemSync';
import { SetupWizard } from './setupWizard';
import { getProfile, invalidateProfile, getCachedProfile, ProjectProfile } from './envAssessment';

export function activate(context: vscode.ExtensionContext): void {
  const root = getWorkspaceRoot();
  if (!root) return;

  // Activate on .claude/skills OR .claude/agents (some projects have agents but not skills yet)
  if (!hasClaudeStructure(root)) return;

  void vscode.commands.executeCommand('setContext', 'claudeWorkflow.active', true);

  // Core services
  const tracker = new HistoryTracker(context);
  const runner = new SkillRunner(root);
  const statusBar = new WorkflowStatusBar();
  const panelProvider = new WorkflowPanelProvider(root, runner);
  const apiDiagnostics = new ApiDiagnosticsProvider(root);
  const wikiSync = new WikiSyncProvider(root, context.secrets);
  const workItemSync = new WorkItemSyncProvider(root, context.secrets);

  // Wire history → status bar + panel
  tracker.onDidChange(state => {
    statusBar.update(state);
    panelProvider.updateHistory(state);
  });

  // Wire API diagnostics → panel
  apiDiagnostics.onSummaryChanged(summary => {
    panelProvider.updateAudit(summary, apiDiagnostics.isAuditStale());
  });

  tracker.start(root);
  apiDiagnostics.start();
  panelProvider.updateAudit(apiDiagnostics.getSummary(), apiDiagnostics.isAuditStale());

  // ── Run environment assessment (non-blocking) ─────────────────────────────

  const profilePromise = getProfile(root);
  profilePromise.then(profile => {
    panelProvider.setProfile(profile);
    apiDiagnostics.setProfile(profile);
    wikiSync.setProfile(profile);
  });

  // Pass profile promise to wizard so it can show assessment results
  const setupWizard = new SetupWizard(context, root, profilePromise);

  const treeView = vscode.window.createTreeView('claudeWorkflowPanel', {
    treeDataProvider: panelProvider,
    showCollapseAll: true,
  });

  // ── Register all commands ────────────────────────────────────────────────

  const skill = (name: string) => () => void runner.runSkill(name as Parameters<typeof runner.runSkill>[0]);

  const cmds: Array<[string, () => void | Promise<void>]> = [
    // Workflow skills
    ['claudeWorkflow.updateTests',     skill('update-tests')],
    ['claudeWorkflow.updateUAT',       skill('update-uat')],
    ['claudeWorkflow.regression',      skill('regression')],
    ['claudeWorkflow.syncDesign',      skill('sync-design')],
    ['claudeWorkflow.doneCheck',       skill('done-check')],

    // API skills
    ['claudeWorkflow.auditApi',        skill('audit-api')],
    ['claudeWorkflow.syncApiDocs',     skill('sync-api-docs')],

    // Capture skills
    ['claudeWorkflow.logDecision',     skill('log-decision')],
    ['claudeWorkflow.capturePattern',  skill('capture-pattern')],
    ['claudeWorkflow.logFailure',      skill('log-failure')],
    ['claudeWorkflow.logDebt',         skill('log-debt')],

    // Generate skills
    ['claudeWorkflow.releaseNotes',    skill('release-notes')],
    ['claudeWorkflow.postReview',      skill('post-review')],
    ['claudeWorkflow.updatePlaybooks', skill('update-playbooks')],

    // Azure DevOps sync
    ['claudeWorkflow.syncToWiki', () => void syncToWiki(wikiSync)],
    ['claudeWorkflow.syncDebtToWorkItems', () => void workItemSync.syncTechDebt()],

    // Utility
    ['claudeWorkflow.refresh', () => {
      tracker.refresh();
      invalidateProfile();
      void getProfile(root).then(profile => {
        panelProvider.setProfile(profile);
        apiDiagnostics.setProfile(profile);
        wikiSync.setProfile(profile);
        panelProvider.refresh();
      });
      void apiDiagnostics.refresh();
    }],
    ['claudeWorkflow.showPanel', () => void treeView.reveal(undefined as unknown as never)],
    ['claudeWorkflow.appendHistory', () => void appendHistoryEntry(root, tracker)],
    ['claudeWorkflow.scaffoldSkills', () => void scaffoldSkillsAdaptive(root)],
    ['claudeWorkflow.openSetup', () => setupWizard.open()],
  ];

  for (const [id, handler] of cmds) {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  }

  watchForGitCommit(root, tracker, context);
  context.subscriptions.push(tracker, statusBar, treeView, apiDiagnostics);

  // Auto-show wizard on first activation
  const hasSeenWizard = context.workspaceState.get<boolean>('hasSeenSetupWizard', false);
  if (!hasSeenWizard) {
    void context.workspaceState.update('hasSeenSetupWizard', true);
    setupWizard.open();
  }
}

export function deactivate(): void {}

// ── Adaptive scaffolding ────────────────────────────────────────────────────

async function scaffoldSkillsAdaptive(root: string): Promise<void> {
  const skillsDir = path.join(root, '.claude', 'skills');
  if (!fs.existsSync(skillsDir)) fs.mkdirSync(skillsDir, { recursive: true });

  const profile = getCachedProfile();
  const templates = profile
    ? getScaffoldableForProfile(profile)
    : getScaffoldableTemplates();

  if (templates.length === 0) {
    void vscode.window.showInformationMessage(
      'Claude Workflow: All skill files already exist — nothing to scaffold.'
    );
    return;
  }

  const created: string[] = [];
  const skipped: string[] = [];

  for (const { name, content } of templates) {
    const dest = path.join(skillsDir, `${name}.md`);
    if (fs.existsSync(dest)) { skipped.push(name); continue; }
    fs.writeFileSync(dest, content, 'utf8');
    created.push(name);
  }

  if (created.length === 0) {
    void vscode.window.showInformationMessage(
      `Claude Workflow: All ${skipped.length} skill files already exist.`
    );
    return;
  }

  void vscode.window.showInformationMessage(
    `Claude Workflow: Created ${created.length} skills (${skipped.length} already existed).`
  );

  // Refresh profile so panel sees the new files
  invalidateProfile();
  void getProfile(root);
}

// ── Append history ──────────────────────────────────────────────────────────

async function appendHistoryEntry(root: string, tracker: HistoryTracker): Promise<void> {
  const config = vscode.workspace.getConfiguration('claudeWorkflow');
  const historyFile = config.get<string>('historyFile', 'instruction-history.toon');
  const filePath = path.join(root, historyFile);

  if (!fs.existsSync(filePath)) {
    void vscode.window.showErrorMessage(`History file not found: ${historyFile}`);
    return;
  }

  let content: string;
  try { content = fs.readFileSync(filePath, 'utf8'); }
  catch { void vscode.window.showErrorMessage('Could not read instruction history file'); return; }

  const countMatch = content.match(/instructions\[(\d+)\]/);
  const currentCount = countMatch ? parseInt(countMatch[1], 10) : 0;
  const nextId = currentCount + 1;

  const instruction = await vscode.window.showInputBox({
    prompt: 'Summarise what was done (plain English)',
    placeHolder: 'e.g. Add rate limiting to auth endpoints',
    ignoreFocusOut: true,
  });
  if (!instruction) return;

  const category = await vscode.window.showQuickPick(
    ['Feature addition', 'Bug fix', 'Enhancement', 'Update', 'Refactoring',
     'Removal', 'Configuration', 'Change', 'Implementation'],
    { placeHolder: 'Select category', ignoreFocusOut: true }
  );
  if (!category) return;

  const actions = await vscode.window.showInputBox({
    prompt: 'Key actions taken (comma-separated)',
    placeHolder: 'e.g. Updated server/routes/auth.ts, Added rate-limit middleware',
    ignoreFocusOut: true,
  });
  if (actions === undefined) return;

  const actionList = actions.split(',').map(a => a.trim()).filter(Boolean);
  const now = new Date();
  const iso = now.toISOString().replace(/\.\d{3}Z$/, 'Z');

  const entry = [
    `  -`,
    `    id: ${nextId}`,
    `    dateTime: "${iso}"`,
    `    date: ${iso.slice(0, 10)}`,
    `    type: user_instruction`,
    `    instruction: "${instruction.replace(/"/g, '\\"')}"`,
    `    category: ${category}`,
    `    actionsTaken[${actionList.length}]: ${actionList.join(',')}`,
  ].join('\n');

  const updated = content
    .replace(`instructions[${currentCount}]:`, `instructions[${nextId}]:`)
    + '\n' + entry + '\n';

  try {
    fs.writeFileSync(filePath, updated, 'utf8');
    tracker.refresh();
    void vscode.window.showInformationMessage(`Appended entry #${nextId} to instruction history`);
  } catch {
    void vscode.window.showErrorMessage('Failed to write instruction history');
  }
}

// ── Git commit watcher ──────────────────────────────────────────────────────

function watchForGitCommit(root: string, tracker: HistoryTracker, ctx: vscode.ExtensionContext): void {
  const config = vscode.workspace.getConfiguration('claudeWorkflow');
  if (!config.get<boolean>('autoRemindAfterCommit', true)) return;
  if (!fs.existsSync(path.join(root, '.git'))) return;

  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(path.join(root, '.git'), 'COMMIT_EDITMSG')
  );
  watcher.onDidChange(() => {
    setTimeout(() => {
      tracker.refresh();
      if (tracker.getState().isStale) {
        void vscode.window
          .showWarningMessage(
            'Claude Workflow: instruction-history.toon may need updating.',
            'Append Entry', 'Dismiss'
          )
          .then(c => { if (c === 'Append Entry') void vscode.commands.executeCommand('claudeWorkflow.appendHistory'); });
      }
    }, 500);
  });
  ctx.subscriptions.push(watcher);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getWorkspaceRoot(): string | null {
  const f = vscode.workspace.workspaceFolders;
  return f && f.length > 0 ? f[0].uri.fsPath : null;
}

function hasClaudeStructure(root: string): boolean {
  return fs.existsSync(path.join(root, '.claude', 'skills'))
    || fs.existsSync(path.join(root, '.claude', 'agents'))
    || fs.existsSync(path.join(root, '.claude', 'settings.json'));
}

async function syncToWiki(wikiSync: WikiSyncProvider): Promise<void> {
  const result: SyncResult = await wikiSync.syncAll();
  const parts: string[] = [];
  if (result.created.length) parts.push(`Created: ${result.created.join(', ')}`);
  if (result.updated.length) parts.push(`Updated: ${result.updated.join(', ')}`);
  if (result.skipped.length) parts.push(`Skipped (no local file): ${result.skipped.length}`);
  if (result.errors.length) parts.push(`Errors: ${result.errors.map(e => e.doc).join(', ')}`);

  if (parts.length === 0) {
    void vscode.window.showInformationMessage('Wiki sync: nothing to sync.');
    return;
  }

  if (result.errors.length) {
    void vscode.window.showWarningMessage(`Wiki sync: ${parts.join(' | ')}`);
  } else {
    void vscode.window.showInformationMessage(`Wiki sync: ${parts.join(' | ')}`);
  }
}
