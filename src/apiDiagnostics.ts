/**
 * apiDiagnostics.ts
 *
 * Translates ApiIssue arrays into VS Code DiagnosticsCollection entries
 * so findings appear as inline squiggles directly on route files.
 *
 * Sources merged in priority order (highest wins on the same line):
 *   1. Deep audit results from .claude/api-audit.json  (Claude-written)
 *   2. Quick coverage scan                             (extension-computed)
 */

import * as vscode from 'vscode';
import * as path from 'path';
import {
  ApiIssue,
  AuditSeverity,
  AuditSummary,
  auditResultAge,
  getAuditSummary,
  loadDeepAuditResults,
  quickCoverageScan,
} from './apiAuditor';

const DIAGNOSTIC_SOURCE = 'Claude API Audit';

function getAuditStaleMs(): number {
  const hours = vscode.workspace
    .getConfiguration('claudeWorkflow')
    .get<number>('staleThresholdHours', 8);
  return hours * 60 * 60 * 1000;
}

export class ApiDiagnosticsProvider implements vscode.Disposable {
  private readonly collection: vscode.DiagnosticCollection;
  private routeWatchers: vscode.FileSystemWatcher[] = [];
  private auditWatcher: vscode.FileSystemWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly _onSummaryChanged = new vscode.EventEmitter<AuditSummary | null>();
  readonly onSummaryChanged = this._onSummaryChanged.event;

  constructor(private readonly workspaceRoot: string) {
    this.collection = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_SOURCE);
  }

  start(): void {
    // Watch route files — re-run quick scan on save
    const config = vscode.workspace.getConfiguration('claudeWorkflow');
    const routeGlobs = config.get<string[]>('routeGlobs', [
      'server/routes/**/*.ts',
      'src/routes/**/*.ts',
      'routes/**/*.ts',
    ]);

    for (const glob of routeGlobs) {
      const pattern = new vscode.RelativePattern(this.workspaceRoot, glob);
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      watcher.onDidChange(() => this.scheduleRefresh());
      watcher.onDidCreate(() => this.scheduleRefresh());
      this.routeWatchers.push(watcher);
    }

    // Watch the Claude audit result file
    const auditPattern = new vscode.RelativePattern(
      this.workspaceRoot,
      '.claude/api-audit.json'
    );
    this.auditWatcher = vscode.workspace.createFileSystemWatcher(auditPattern);
    this.auditWatcher.onDidChange(() => this.refresh());
    this.auditWatcher.onDidCreate(() => this.refresh());

    // Initial load
    void this.refresh();
  }

  async refresh(): Promise<void> {
    const [coverageIssues, deepResult] = await Promise.all([
      quickCoverageScan(this.workspaceRoot),
      Promise.resolve(loadDeepAuditResults(this.workspaceRoot)),
    ]);

    // Merge: deep audit issues + coverage issues, dedup by file+line+rule
    const allIssues = mergeIssues(
      deepResult?.issues ?? [],
      coverageIssues
    );

    this.applyDiagnostics(allIssues);
    this._onSummaryChanged.fire(deepResult?.summary ?? null);
  }

  getSummary(): AuditSummary | null {
    return getAuditSummary(this.workspaceRoot);
  }

  isAuditStale(): boolean {
    const age = auditResultAge(this.workspaceRoot);
    return age === null || age > getAuditStaleMs();
  }

  hasAuditFile(): boolean {
    return auditResultAge(this.workspaceRoot) !== null;
  }

  dispose(): void {
    this.collection.dispose();
    this.routeWatchers.forEach(w => w.dispose());
    this.auditWatcher?.dispose();
    this._onSummaryChanged.dispose();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private scheduleRefresh(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => void this.refresh(), 800);
  }

  private applyDiagnostics(issues: ApiIssue[]): void {
    // Group by absolute file path
    const byFile = new Map<string, vscode.Diagnostic[]>();

    for (const issue of issues) {
      const absPath = path.isAbsolute(issue.file)
        ? issue.file
        : path.join(this.workspaceRoot, issue.file);

      const uri = vscode.Uri.file(absPath);
      const key = uri.toString();

      if (!byFile.has(key)) byFile.set(key, []);

      const lineIndex = Math.max(0, issue.line - 1);
      const range = new vscode.Range(lineIndex, 0, lineIndex, Number.MAX_SAFE_INTEGER);
      const diag = new vscode.Diagnostic(
        range,
        issue.message,
        toVscodeSeverity(issue.severity)
      );
      diag.source = DIAGNOSTIC_SOURCE;
      diag.code = issue.rule;

      byFile.get(key)!.push(diag);
    }

    // Clear then re-apply
    this.collection.clear();
    for (const [key, diags] of byFile) {
      this.collection.set(vscode.Uri.parse(key), diags);
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toVscodeSeverity(s: AuditSeverity): vscode.DiagnosticSeverity {
  switch (s) {
    case 'error':   return vscode.DiagnosticSeverity.Error;
    case 'warning': return vscode.DiagnosticSeverity.Warning;
    case 'info':    return vscode.DiagnosticSeverity.Information;
  }
}

/**
 * Merge deep-audit issues (from Claude) with quick coverage issues.
 * Deep audit wins when there's a conflict on the same file+line.
 * Quick coverage issues for a line are suppressed if Claude already flagged it.
 */
function mergeIssues(deep: ApiIssue[], quick: ApiIssue[]): ApiIssue[] {
  const deepKeys = new Set(deep.map(i => `${i.file}:${i.line}`));
  const filteredQuick = quick.filter(i => !deepKeys.has(`${i.file}:${i.line}`));
  return [...deep, ...filteredQuick];
}
