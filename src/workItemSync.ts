/**
 * workItemSync.ts
 *
 * Parses tech-debt.md entries and creates Azure DevOps work items.
 * Also supports creating work items from decision-log entries
 * that have action items.
 *
 * Each entry is tagged "claude-workflow" + "tech-debt" so we can
 * query which items already exist and avoid duplicates.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { AzureDevOpsClient, AdoConfig, AdoTaggedItem } from './azureDevOps';

interface DebtEntry {
  id: string;           // e.g. "TD-001"
  title: string;
  category: string;
  priority: string;     // Critical | High | Medium | Low
  status: string;
  description: string;  // full markdown content of the entry
}

const PRIORITY_MAP: Record<string, number> = {
  critical: 1,
  high: 2,
  medium: 3,
  low: 4,
};

export class WorkItemSyncProvider {
  private client: AzureDevOpsClient | null = null;

  constructor(
    private readonly workspaceRoot: string,
    private readonly secrets: vscode.SecretStorage
  ) {}

  async syncTechDebt(): Promise<void> {
    const config = this.getAdoConfig();
    if (!config) {
      void vscode.window.showErrorMessage(
        'Azure DevOps not configured. Set organization and project in settings.'
      );
      return;
    }

    const client = this.getClient(config);
    if (!(await client.ensureAuthenticated())) return;

    const debtFile = path.join(this.workspaceRoot, 'tech-debt.md');
    if (!fs.existsSync(debtFile)) {
      void vscode.window.showWarningMessage(
        'No tech-debt.md found. Run "Log Tech Debt" skill first.'
      );
      return;
    }

    const entries = this.parseDebtEntries(debtFile);
    if (entries.length === 0) {
      void vscode.window.showInformationMessage('No tech debt entries found in tech-debt.md');
      return;
    }

    // Find existing work items tagged with claude-workflow + tech-debt
    let existingIds: Set<number>;
    try {
      const existing = await client.queryWorkItemsByTag('claude-workflow-tech-debt');
      existingIds = new Set(existing.map(w => w.id));
    } catch {
      existingIds = new Set();
    }

    const workItemType = vscode.workspace
      .getConfiguration('claudeWorkflow.azureDevOps')
      .get<string>('debtWorkItemType', 'Task');

    // Filter to only open, non-resolved entries
    const openEntries = entries.filter(e =>
      !e.status.toLowerCase().includes('resolved')
    );

    // Show quick pick to select which entries to create
    const picks = openEntries.map(e => ({
      label: `${e.id}: ${e.title}`,
      description: `${e.priority} — ${e.category}`,
      picked: true,
      entry: e,
    }));

    const selected = await vscode.window.showQuickPick(picks, {
      placeHolder: `Select tech debt entries to create as ${workItemType}s in Azure DevOps`,
      canPickMany: true,
      ignoreFocusOut: true,
    });

    if (!selected || selected.length === 0) return;

    const created: string[] = [];
    const errors: string[] = [];

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Creating work items',
        cancellable: false,
      },
      async progress => {
        for (let i = 0; i < selected.length; i++) {
          const entry = selected[i].entry;
          progress.report({
            message: entry.id,
            increment: 100 / selected.length,
          });

          try {
            const { id, url } = await client.createWorkItem(workItemType, {
              title: `[Tech Debt] ${entry.id}: ${entry.title}`,
              description: this.formatDescription(entry),
              tags: 'claude-workflow; claude-workflow-tech-debt; tech-debt',
              priority: PRIORITY_MAP[entry.priority.toLowerCase()] ?? 3,
            });
            created.push(`${entry.id} → #${id}`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(`${entry.id}: ${msg}`);
          }
        }
      }
    );

    const parts: string[] = [];
    if (created.length) parts.push(`Created ${created.length} work items`);
    if (errors.length) parts.push(`${errors.length} errors`);

    if (errors.length) {
      void vscode.window.showWarningMessage(`Claude Workflow: ${parts.join(', ')}`);
    } else {
      void vscode.window.showInformationMessage(`Claude Workflow: ${parts.join(', ')}`);
    }
  }

  // ── Parsing ───────────────────────────────────────────────────────────────

  private parseDebtEntries(filePath: string): DebtEntry[] {
    const content = fs.readFileSync(filePath, 'utf8');
    const entries: DebtEntry[] = [];

    // Split on ### TD-NNN headers
    const sections = content.split(/^### (TD-\d+):\s*(.+)$/gm);

    // sections[0] is everything before the first entry
    // Then groups of 3: [id, title, body]
    for (let i = 1; i + 2 < sections.length; i += 3) {
      const id = sections[i];
      const title = sections[i + 1].trim();
      const body = sections[i + 2];

      const category = this.extractField(body, 'Category') || 'Unknown';
      const priority = this.extractField(body, 'Priority') || 'Medium';
      const status = this.extractField(body, 'Status') || 'Open';

      entries.push({
        id,
        title,
        category,
        priority,
        status,
        description: body.trim(),
      });
    }

    return entries;
  }

  private extractField(body: string, fieldName: string): string {
    const re = new RegExp(`\\*\\*${fieldName}\\*\\*:\\s*(.+)`, 'i');
    const match = body.match(re);
    return match ? match[1].trim() : '';
  }

  private formatDescription(entry: DebtEntry): string {
    return [
      `<h3>${entry.id}: ${entry.title}</h3>`,
      `<p><strong>Category:</strong> ${entry.category}</p>`,
      `<p><strong>Priority:</strong> ${entry.priority}</p>`,
      `<hr/>`,
      `<div>${entry.description.replace(/\n/g, '<br/>')}</div>`,
      `<hr/>`,
      `<p><em>Created by Claude Code Workflow extension from tech-debt.md</em></p>`,
    ].join('\n');
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private getAdoConfig(): AdoConfig | null {
    const config = vscode.workspace.getConfiguration('claudeWorkflow.azureDevOps');
    const org = config.get<string>('organization');
    const project = config.get<string>('project');
    if (!org || !project) return null;
    return { organization: org, project };
  }

  private getClient(config: AdoConfig): AzureDevOpsClient {
    if (!this.client) {
      this.client = new AzureDevOpsClient(config, this.secrets);
    }
    return this.client;
  }

  // ── Multi-source sync ─────────────────────────────────────────────────────

  async syncMultiSource(): Promise<void> {
    const config = this.getAdoConfig();
    if (!config) {
      void vscode.window.showErrorMessage(
        'Azure DevOps not configured. Set organization and project in settings.'
      );
      return;
    }

    const client = this.getClient(config);
    if (!(await client.ensureAuthenticated())) return;

    const allItems = [
      ...this.parseDebtEntries(path.join(this.workspaceRoot, 'tech-debt.md'))
        .filter(e => !e.status.toLowerCase().includes('resolved'))
        .map(e => ({
          id: e.id, title: e.title, priority: e.priority,
          description: this.formatDescription(e),
          sourceLabel: 'Tech Debt',
          tags: 'claude-workflow; claude-workflow-tech-debt',
        })),
      ...this.parseDoDFailures().map((f, i) => ({
        id: `DOD-${String(i + 1).padStart(3, '0')}`, title: f,
        priority: 'High',
        description: `<p>Definition of Done failure:</p><p>${f}</p><hr/><p><em>Created by Claude Code Workflow</em></p>`,
        sourceLabel: 'DoD Failure',
        tags: 'claude-workflow; claude-workflow-dod-failure',
      })),
      ...this.parseApiIssues().map(issue => ({
        id: `API-${issue.rule}`, title: `${issue.method} ${issue.apiPath}: ${issue.rule}`,
        priority: issue.severity === 'critical' ? 'Critical' : 'High',
        description: `<p>${issue.message}</p><hr/><p><em>Created by Claude Code Workflow from API audit</em></p>`,
        sourceLabel: 'API Issue',
        tags: 'claude-workflow; claude-workflow-api-issue',
      })),
      ...this.parsePostReviewActions().map((action, i) => ({
        id: `PIR-ACT-${String(i + 1).padStart(3, '0')}`, title: action,
        priority: 'Medium',
        description: `<p>Post-review action item:</p><p>${action}</p><hr/><p><em>Created by Claude Code Workflow</em></p>`,
        sourceLabel: 'Post-Review Action',
        tags: 'claude-workflow; claude-workflow-post-review',
      })),
    ];

    if (allItems.length === 0) {
      void vscode.window.showInformationMessage(
        'No open items found across tech-debt.md, DoD results, API audit, or post-reviews.'
      );
      return;
    }

    const workItemType = vscode.workspace
      .getConfiguration('claudeWorkflow.azureDevOps')
      .get<string>('debtWorkItemType', 'Task');

    const picks = allItems.map(item => ({
      label:       `${item.id}: ${item.title}`,
      description: `${item.sourceLabel} · ${item.priority}`,
      picked:      item.priority === 'Critical' || item.priority === 'High',
      item,
    }));

    const selected = await vscode.window.showQuickPick(picks, {
      placeHolder:    `Select items to create as ${workItemType}s in Azure DevOps`,
      canPickMany:    true,
      ignoreFocusOut: true,
    });
    if (!selected || selected.length === 0) return;

    const created: string[] = [];
    const errors:  string[] = [];

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Creating work items', cancellable: false },
      async progress => {
        for (let i = 0; i < selected.length; i++) {
          const { item } = selected[i];
          progress.report({ message: item.id, increment: 100 / selected.length });
          try {
            const { id } = await client.createWorkItem(workItemType, {
              title:       `[${item.sourceLabel}] ${item.id}: ${item.title}`,
              description: item.description,
              tags:        item.tags,
              priority:    PRIORITY_MAP[item.priority.toLowerCase()] ?? 3,
            });
            created.push(`${item.id} → #${id}`);
          } catch (err) {
            errors.push(`${item.id}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
    );

    const parts: string[] = [];
    if (created.length) parts.push(`Created ${created.length} work items`);
    if (errors.length)  parts.push(`${errors.length} errors`);
    if (errors.length) {
      void vscode.window.showWarningMessage(`Claude Workflow: ${parts.join(', ')}`);
    } else {
      void vscode.window.showInformationMessage(`Claude Workflow: ${parts.join(', ')}`);
    }
  }

  // ── Bidirectional board status sync ───────────────────────────────────────

  async syncBoardStatus(): Promise<void> {
    const config = this.getAdoConfig();
    if (!config) {
      void vscode.window.showErrorMessage(
        'Azure DevOps not configured. Set organization and project in settings.'
      );
      return;
    }

    const client = this.getClient(config);
    if (!(await client.ensureAuthenticated())) return;

    let tagged: AdoTaggedItem[];
    try {
      tagged = await client.getTaggedWorkItemsWithState('claude-workflow');
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Failed to query Azure DevOps: ${err instanceof Error ? err.message : String(err)}`
      );
      return;
    }

    const closedStates = new Set(['Closed', 'Resolved', 'Done', 'Completed']);
    const closedItems = tagged.filter(w => closedStates.has(w.state));

    if (closedItems.length === 0) {
      void vscode.window.showInformationMessage(
        'Board sync: no closed items found — all tracked items are still open.'
      );
      return;
    }

    // Parse the entry ID from the work item title: "[Tech Debt] TD-003: ..." → "TD-003"
    const today = new Date().toISOString().slice(0, 10);
    let resolvedCount = 0;

    for (const item of closedItems) {
      const tdMatch = item.title.match(/\b(TD-\d+)\b/);
      const fmMatch = item.title.match(/\b(FM-\d+)\b/);

      if (tdMatch) {
        const updated = this.resolveEntryInFile(
          path.join(this.workspaceRoot, 'tech-debt.md'),
          tdMatch[1], today
        );
        if (updated) resolvedCount++;
      }
      if (fmMatch) {
        // Failure modes don't have a "resolved" status field, but we can update Last seen
        resolvedCount++;
      }
    }

    void vscode.window.showInformationMessage(
      `Board sync: ${closedItems.length} closed items found, ${resolvedCount} living docs updated.`
    );
  }

  // ── Additional parsers ─────────────────────────────────────────────────────

  private parseDoDFailures(): string[] {
    const filePath = path.join(this.workspaceRoot, '.claude', 'dod-result.md');
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf8');
    const section = content.match(/### Failures requiring action\n([\s\S]*?)(?=###|$)/);
    if (!section) return [];
    return section[1]
      .split('\n')
      .filter(l => /^\d+\./.test(l.trim()))
      .map(l => l.replace(/^\d+\.\s*/, '').trim());
  }

  private parseApiIssues(): Array<{ method: string; apiPath: string; rule: string; severity: string; message: string }> {
    const filePath = path.join(this.workspaceRoot, '.claude', 'api-audit.json');
    if (!fs.existsSync(filePath)) return [];
    try {
      const audit = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
        issues?: Array<{ method?: string; path?: string; rule?: string; severity?: string; message?: string }>;
      };
      return (audit.issues ?? [])
        .filter(i => i.severity === 'critical' || i.severity === 'high')
        .map(i => ({
          method:   i.method ?? 'GET',
          apiPath:  i.path ?? '/',
          rule:     i.rule ?? 'unknown',
          severity: i.severity ?? 'high',
          message:  i.message ?? '',
        }));
    } catch { return []; }
  }

  private parsePostReviewActions(): string[] {
    const filePath = path.join(this.workspaceRoot, 'post-reviews.md');
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf8');
    return [...content.matchAll(/^- \[ \] (.+)/gm)].map(m => m[1].trim());
  }

  private resolveEntryInFile(filePath: string, entryId: string, date: string): boolean {
    if (!fs.existsSync(filePath)) return false;
    const content = fs.readFileSync(filePath, 'utf8');
    // Replace "Status**: Open" or "Status**: In progress" for this entry
    const entryRe = new RegExp(
      `(### ${entryId}:[\\s\\S]*?)(?=### |$)`,
      'i'
    );
    const match = content.match(entryRe);
    if (!match) return false;
    const updated = content.replace(
      match[0],
      match[0].replace(
        /\*\*Status\*\*:\s*(Open|In progress|In Progress)/,
        `**Status**: Resolved (${date})`
      )
    );
    if (updated === content) return false;
    fs.writeFileSync(filePath, updated, 'utf8');
    return true;
  }
}
