import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { HistoryTracker } from './historyTracker';
import { SkillRunner, SkillName } from './skillRunner';
import { WorkflowPanelProvider } from './workflowPanel';
import { WorkflowStatusBar } from './statusBar';

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

  // Wire up history tracker → status bar + panel
  tracker.onDidChange(state => {
    statusBar.update(state);
    panelProvider.updateHistory(state);
  });

  tracker.start(root);

  // Tree view
  const treeView = vscode.window.createTreeView('claudeWorkflowPanel', {
    treeDataProvider: panelProvider,
    showCollapseAll: true,
  });

  // Commands
  const cmds: Array<[string, () => void]> = [
    ['claudeWorkflow.updateTests', () => void runner.runSkill('update-tests')],
    ['claudeWorkflow.updateUAT', () => void runner.runSkill('update-uat')],
    ['claudeWorkflow.regression', () => void runner.runSkill('regression')],
    ['claudeWorkflow.syncDesign', () => void runner.runSkill('sync-design')],
    ['claudeWorkflow.refresh', () => { tracker.refresh(); panelProvider.refresh(); }],
    ['claudeWorkflow.showPanel', () => void treeView.reveal(undefined as unknown as never)],
    [
      'claudeWorkflow.appendHistory',
      () => void appendHistoryEntry(root, tracker),
    ],
  ];

  for (const [id, handler] of cmds) {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  }

  // Optional: remind after git commit if history looks stale
  watchForGitCommit(root, tracker, context);

  context.subscriptions.push(tracker, statusBar, treeView);
}

export function deactivate(): void {}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getWorkspaceRoot(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length > 0 ? folders[0].uri.fsPath : null;
}

function hasClaudeSkills(root: string): boolean {
  return fs.existsSync(path.join(root, '.claude', 'skills'));
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

  // Read current entry count
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

  // Prompt for summary
  const instruction = await vscode.window.showInputBox({
    prompt: 'Summarise what was done in this session (plain English)',
    placeHolder: 'e.g. Fix maintenance allocation bug — building factor now displayed in form',
    ignoreFocusOut: true,
  });

  if (!instruction) return;

  const categories = [
    'Feature addition',
    'Bug fix',
    'Enhancement',
    'Update',
    'Refactoring',
    'Removal',
    'Configuration',
    'Change',
    'Implementation',
  ];
  const category = await vscode.window.showQuickPick(categories, {
    placeHolder: 'Select category',
    ignoreFocusOut: true,
  });

  if (!category) return;

  const actions = await vscode.window.showInputBox({
    prompt: 'Key actions taken (comma-separated)',
    placeHolder: 'e.g. Updated server/routes/maintenance.ts, Fixed bug in AllocationForm',
    ignoreFocusOut: true,
  });

  if (actions === undefined) return;

  const actionList = actions
    .split(',')
    .map(a => a.trim())
    .filter(Boolean);

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

  // Update count and append entry
  const updated = content
    .replace(`instructions[${currentCount}]:`, `instructions[${nextId}]:`)
    + '\n' + entry + '\n';

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

  // Watch COMMIT_EDITMSG — written on every git commit
  const commitMsgPath = path.join(root, '.git', 'COMMIT_EDITMSG');
  if (!fs.existsSync(path.join(root, '.git'))) return;

  const pattern = new vscode.RelativePattern(
    path.join(root, '.git'),
    'COMMIT_EDITMSG'
  );
  const watcher = vscode.workspace.createFileSystemWatcher(pattern);

  watcher.onDidChange(() => {
    // Give the tracker a moment to re-check
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
