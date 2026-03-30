import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { HistoryTracker } from './historyTracker';
import { SkillRunner } from './skillRunner';
import { WorkflowPanelProvider } from './workflowPanel';
import { WorkflowStatusBar } from './statusBar';
import { ApiDiagnosticsProvider } from './apiDiagnostics';
import { AUDIT_API_SKILL, SYNC_API_DOCS_SKILL } from './skillTemplates';

export function activate(context: vscode.ExtensionContext): void {
  const root = getWorkspaceRoot();
  if (!root) return;

  if (!hasClaudeSkills(root)) {
    // Workspace doesn't use Claude Code skills — stay dormant
    return;
  }

  // Signal to menus that the extension is active
  void vscode.commands.executeCommand('setContext', 'claudeWorkflow.active', true);

  // Core services
  const tracker = new HistoryTracker(context);
  const runner = new SkillRunner(root);
  const statusBar = new WorkflowStatusBar();
  const panelProvider = new WorkflowPanelProvider(root, runner);
  const apiDiagnostics = new ApiDiagnosticsProvider(root);

  // Wire up history tracker → status bar + panel
  tracker.onDidChange(state => {
    statusBar.update(state);
    panelProvider.updateHistory(state);
  });

  // Wire up API diagnostics → panel
  apiDiagnostics.onSummaryChanged(summary => {
    panelProvider.updateAudit(summary, apiDiagnostics.isAuditStale());
  });

  tracker.start(root);
  apiDiagnostics.start();

  // Initial audit state
  panelProvider.updateAudit(
    apiDiagnostics.getSummary(),
    apiDiagnostics.isAuditStale()
  );

  // Tree view
  const treeView = vscode.window.createTreeView('claudeWorkflowPanel', {
    treeDataProvider: panelProvider,
    showCollapseAll: true,
  });

  // ── Commands ────────────────────────────────────────────────────────────────

  const cmds: Array<[string, () => void | Promise<void>]> = [
    // Existing workflow skills
    ['claudeWorkflow.updateTests',  () => void runner.runSkill('update-tests')],
    ['claudeWorkflow.updateUAT',    () => void runner.runSkill('update-uat')],
    ['claudeWorkflow.regression',   () => void runner.runSkill('regression')],
    ['claudeWorkflow.syncDesign',   () => void runner.runSkill('sync-design')],

    // New API skills
    ['claudeWorkflow.auditApi',     () => void runner.runSkill('audit-api')],
    ['claudeWorkflow.syncApiDocs',  () => void runner.runSkill('sync-api-docs')],

    // Utility
    ['claudeWorkflow.refresh', () => {
      tracker.refresh();
      panelProvider.refresh();
      void apiDiagnostics.refresh();
    }],
    ['claudeWorkflow.showPanel', () => void treeView.reveal(undefined as unknown as never)],
    ['claudeWorkflow.appendHistory', () => void appendHistoryEntry(root, tracker)],
    ['claudeWorkflow.scaffoldApiSkills', () => void scaffoldApiSkills(root, runner)],
  ];

  for (const [id, handler] of cmds) {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  }

  // Optional: remind after git commit if history looks stale
  watchForGitCommit(root, tracker, context);

  context.subscriptions.push(tracker, statusBar, treeView, apiDiagnostics);
}

export function deactivate(): void {}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getWorkspaceRoot(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length > 0 ? folders[0].uri.fsPath : null;
}

function hasClaudeSkills(root: string): boolean {
  return fs.existsSync(path.join(root, '.claude', 'skills'));
}

/**
 * Write audit-api.md and sync-api-docs.md into .claude/skills/ if they
 * don't already exist. Offers to overwrite if they do.
 */
async function scaffoldApiSkills(root: string, runner: SkillRunner): Promise<void> {
  const skillsDir = path.join(root, '.claude', 'skills');

  const skills: Array<{ name: string; content: string }> = [
    { name: 'audit-api',     content: AUDIT_API_SKILL },
    { name: 'sync-api-docs', content: SYNC_API_DOCS_SKILL },
  ];

  const created: string[] = [];
  const skipped: string[] = [];

  for (const { name, content } of skills) {
    const dest = path.join(skillsDir, `${name}.md`);

    if (fs.existsSync(dest)) {
      const overwrite = await vscode.window.showWarningMessage(
        `.claude/skills/${name}.md already exists. Overwrite?`,
        'Overwrite',
        'Skip'
      );
      if (overwrite !== 'Overwrite') {
        skipped.push(name);
        continue;
      }
    }

    fs.writeFileSync(dest, content, 'utf8');
    created.push(name);
  }

  const parts: string[] = [];
  if (created.length) parts.push(`Created: ${created.join(', ')}`);
  if (skipped.length) parts.push(`Skipped: ${skipped.join(', ')}`);

  void vscode.window.showInformationMessage(
    `Claude Workflow: ${parts.join(' | ')}. Run "Audit API" to generate the first report.`
  );
}

async function appendHistoryEntry(
  root: string,
  tracker: HistoryTracker
): Promise<void> {
  const config = vscode.workspace.getConfiguration('claudeWorkflow');
  const historyFile = config.get<string>('historyFile', 'instruction-history.toon');
  const filePath = path.join(root, historyFile);

  if (!fs.existsSync(filePath)) {
    void vscode.window.showErrorMessage(`History file not found: ${historyFile}`);
    return;
  }

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    void vscode.window.showErrorMessage('Could not read instruction history file');
    return;
  }

  const countMatch = content.match(/instructions\[(\d+)\]/);
  const currentCount = countMatch ? parseInt(countMatch[1], 10) : 0;
  const nextId = currentCount + 1;

  const instruction = await vscode.window.showInputBox({
    prompt: 'Summarise what was done in this session (plain English)',
    placeHolder: 'e.g. Fix maintenance allocation bug — building factor now displayed in form',
    ignoreFocusOut: true,
  });
  if (!instruction) return;

  const category = await vscode.window.showQuickPick(
    [
      'Feature addition',
      'Bug fix',
      'Enhancement',
      'Update',
      'Refactoring',
      'Removal',
      'Configuration',
      'Change',
      'Implementation',
    ],
    { placeHolder: 'Select category', ignoreFocusOut: true }
  );
  if (!category) return;

  const actions = await vscode.window.showInputBox({
    prompt: 'Key actions taken (comma-separated)',
    placeHolder: 'e.g. Updated server/routes/maintenance.ts, Fixed bug in AllocationForm',
    ignoreFocusOut: true,
  });
  if (actions === undefined) return;

  const actionList = actions.split(',').map(a => a.trim()).filter(Boolean);

  const now = new Date();
  const iso = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const date = iso.slice(0, 10);

  const entry = [
    `  -`,
    `    id: ${nextId}`,
    `    dateTime: "${iso}"`,
    `    date: ${date}`,
    `    type: user_instruction`,
    `    instruction: "${instruction.replace(/"/g, '\\"')}"`,
    `    category: ${category}`,
    `    actionsTaken[${actionList.length}]: ${actionList.join(',')}`,
  ].join('\n');

  const updated =
    content.replace(`instructions[${currentCount}]:`, `instructions[${nextId}]:`) +
    '\n' + entry + '\n';

  try {
    fs.writeFileSync(filePath, updated, 'utf8');
    tracker.refresh();
    void vscode.window.showInformationMessage(
      `Appended entry #${nextId} to instruction history`
    );
  } catch {
    void vscode.window.showErrorMessage('Failed to write instruction history');
  }
}

function watchForGitCommit(
  root: string,
  tracker: HistoryTracker,
  context: vscode.ExtensionContext
): void {
  const config = vscode.workspace.getConfiguration('claudeWorkflow');
  if (!config.get<boolean>('autoRemindAfterCommit', true)) return;
  if (!fs.existsSync(path.join(root, '.git'))) return;

  const pattern = new vscode.RelativePattern(path.join(root, '.git'), 'COMMIT_EDITMSG');
  const watcher = vscode.workspace.createFileSystemWatcher(pattern);

  watcher.onDidChange(() => {
    setTimeout(() => {
      tracker.refresh();
      const state = tracker.getState();
      if (state.isStale) {
        void vscode.window
          .showWarningMessage(
            'Claude Workflow: instruction-history.toon may need updating after this commit.',
            'Append Entry',
            'Dismiss'
          )
          .then(choice => {
            if (choice === 'Append Entry') {
              void vscode.commands.executeCommand('claudeWorkflow.appendHistory');
            }
          });
      }
    }, 500);
  });

  context.subscriptions.push(watcher);
}
