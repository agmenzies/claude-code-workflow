import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface HistoryState {
  lastModified: Date | null;
  entryCount: number;
  isStale: boolean;
  filePath: string | null;
}

export class HistoryTracker implements vscode.Disposable {
  private watcher: vscode.FileSystemWatcher | null = null;
  private state: HistoryState = {
    lastModified: null,
    entryCount: 0,
    isStale: false,
    filePath: null,
  };

  private readonly _onDidChange = new vscode.EventEmitter<HistoryState>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  start(workspaceRoot: string): void {
    const config = vscode.workspace.getConfiguration('claudeWorkflow');
    const historyFile = config.get<string>('historyFile', 'instruction-history.toon');
    const filePath = path.join(workspaceRoot, historyFile);

    this.state.filePath = filePath;
    this.refresh();

    const pattern = new vscode.RelativePattern(workspaceRoot, historyFile);
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
    this.watcher.onDidChange(() => this.refresh());
    this.watcher.onDidCreate(() => this.refresh());
  }

  refresh(): void {
    if (!this.state.filePath) {
      return;
    }

    try {
      const stat = fs.statSync(this.state.filePath);
      const content = fs.readFileSync(this.state.filePath, 'utf8');

      const countMatch = content.match(/instructions\[(\d+)\]/);
      this.state.entryCount = countMatch ? parseInt(countMatch[1], 10) : 0;
      this.state.lastModified = stat.mtime;
      this.state.isStale = this.computeIsStale(stat.mtime);
    } catch {
      this.state.lastModified = null;
      this.state.entryCount = 0;
      this.state.isStale = false;
    }

    this._onDidChange.fire({ ...this.state });
  }

  getState(): HistoryState {
    return { ...this.state };
  }

  private computeIsStale(lastModified: Date): boolean {
    const config = vscode.workspace.getConfiguration('claudeWorkflow');
    const thresholdHours = config.get<number>('staleThresholdHours', 8);
    const ageMs = Date.now() - lastModified.getTime();
    return ageMs > thresholdHours * 60 * 60 * 1000;
  }

  dispose(): void {
    this.watcher?.dispose();
    this._onDidChange.dispose();
  }
}
