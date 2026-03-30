import * as vscode from 'vscode';
import { HistoryState } from './historyTracker';

export class WorkflowStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.item.command = 'claudeWorkflow.showPanel';
    this.setIdle();
  }

  update(state: HistoryState): void {
    if (!state.filePath) {
      this.item.hide();
      return;
    }

    const entryLabel = state.entryCount > 0 ? ` (${state.entryCount})` : '';

    if (state.isStale) {
      this.item.text = `$(warning) Claude History${entryLabel}`;
      this.item.tooltip = this.buildTooltip(state, 'History not updated recently — append a session entry');
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      this.item.text = `$(check) Claude History${entryLabel}`;
      this.item.tooltip = this.buildTooltip(state, 'Up to date');
      this.item.backgroundColor = undefined;
    }

    this.item.show();
  }

  setIdle(): void {
    this.item.text = '$(robot) Claude Workflow';
    this.item.tooltip = 'Claude Code Workflow — click to open panel';
    this.item.backgroundColor = undefined;
    this.item.show();
  }

  hide(): void {
    this.item.hide();
  }

  dispose(): void {
    this.item.dispose();
  }

  private buildTooltip(state: HistoryState, statusLine: string): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.appendMarkdown(`**Claude Code Workflow**\n\n`);
    md.appendMarkdown(`Status: ${statusLine}\n\n`);

    if (state.lastModified) {
      md.appendMarkdown(`History last updated: ${state.lastModified.toLocaleString()}\n\n`);
    }

    if (state.entryCount > 0) {
      md.appendMarkdown(`Entries: ${state.entryCount}\n\n`);
    }

    md.appendMarkdown(
      `[Open panel](command:claudeWorkflow.showPanel)  ` +
      `[Append history](command:claudeWorkflow.appendHistory)`
    );
    return md;
  }
}
