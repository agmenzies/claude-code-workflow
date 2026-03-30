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
import { AzureDevOpsClient, AdoConfig } from './azureDevOps';

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
}
