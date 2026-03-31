/**
 * trelloSync.ts
 *
 * Syncs living-doc items to Trello: tech debt, DoD failures, API issues,
 * post-review actions. Provides board connection wizard and card creation.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { TrelloClient, TrelloCard } from './trelloClient';

export interface TrelloListConfig {
  boardId: string;
  boardName: string;
  backlogListId: string;
  inProgressListId: string;
  doneListId: string;
}

interface SourceItem {
  id: string;
  title: string;
  description: string;
  priority: string;
  sourceType: 'tech-debt' | 'dod-failure' | 'api-issue' | 'post-review-action';
}

export class TrelloSyncProvider {
  private readonly client: TrelloClient;

  constructor(
    private readonly workspaceRoot: string,
    private readonly secrets: vscode.SecretStorage
  ) {
    this.client = new TrelloClient(secrets);
  }

  // ── Board connection wizard ────────────────────────────────────────────────

  async connectBoard(): Promise<void> {
    if (!(await this.client.ensureAuthenticated())) return;

    let boards: Awaited<ReturnType<TrelloClient['getBoards']>>;
    try {
      boards = await this.client.getBoards();
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Trello: failed to load boards — ${err instanceof Error ? err.message : String(err)}`
      );
      return;
    }

    if (boards.length === 0) {
      void vscode.window.showWarningMessage('No open Trello boards found for this account.');
      return;
    }

    const boardPick = await vscode.window.showQuickPick(
      boards.map(b => ({ label: b.name, description: b.id, id: b.id, name: b.name })),
      { placeHolder: 'Select your project board', ignoreFocusOut: true }
    );
    if (!boardPick) return;

    let lists: Awaited<ReturnType<TrelloClient['getLists']>>;
    try {
      lists = await this.client.getLists(boardPick.id);
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Trello: failed to load lists — ${err instanceof Error ? err.message : String(err)}`
      );
      return;
    }

    if (lists.length === 0) {
      void vscode.window.showWarningMessage('No open lists found on this board.');
      return;
    }

    const listItems = lists.map(l => ({ label: l.name, id: l.id }));

    const pickList = (prompt: string) =>
      vscode.window.showQuickPick(listItems, { placeHolder: prompt, ignoreFocusOut: true });

    const backlog    = await pickList('Which list is your Backlog?');
    if (!backlog) return;
    const inProgress = await pickList('Which list is In Progress?');
    if (!inProgress) return;
    const done       = await pickList('Which list is Done?');
    if (!done) return;

    const cfg = vscode.workspace.getConfiguration('claudeWorkflow.trello');
    await cfg.update('boardId',          boardPick.id,    vscode.ConfigurationTarget.Workspace);
    await cfg.update('boardName',        boardPick.name,  vscode.ConfigurationTarget.Workspace);
    await cfg.update('backlogListId',    backlog.id,      vscode.ConfigurationTarget.Workspace);
    await cfg.update('inProgressListId', inProgress.id,  vscode.ConfigurationTarget.Workspace);
    await cfg.update('doneListId',       done.id,         vscode.ConfigurationTarget.Workspace);

    void vscode.window.showInformationMessage(
      `Trello connected: "${boardPick.label}" (${lists.length} lists configured)`
    );
  }

  // ── Multi-source card creation ────────────────────────────────────────────

  async syncItems(): Promise<void> {
    if (!(await this.client.ensureAuthenticated())) return;

    const config = this.getListConfig();
    if (!config) {
      const choice = await vscode.window.showWarningMessage(
        'Trello board not configured.',
        'Connect Board'
      );
      if (choice === 'Connect Board') void this.connectBoard();
      return;
    }

    const items = this.collectSourceItems();
    if (items.length === 0) {
      void vscode.window.showInformationMessage(
        'No open items found across tech-debt.md, DoD results, API audit, or post-reviews.'
      );
      return;
    }

    const picks = items.map(item => ({
      label: `${item.id}: ${item.title}`,
      description: `${item.sourceType} · ${item.priority}`,
      detail:  item.description.slice(0, 100).replace(/\n/g, ' '),
      picked:  item.priority === 'Critical' || item.priority === 'High',
      item,
    }));

    const selected = await vscode.window.showQuickPick(picks, {
      placeHolder: 'Select items to create as Trello cards in Backlog',
      canPickMany: true,
      ignoreFocusOut: true,
    });
    if (!selected || selected.length === 0) return;

    const created: string[] = [];
    const errors:  string[] = [];

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Creating Trello cards', cancellable: false },
      async progress => {
        for (let i = 0; i < selected.length; i++) {
          const { item } = selected[i];
          progress.report({ message: item.id, increment: 100 / selected.length });
          try {
            await this.client.createCard(config.backlogListId, `[${item.sourceType}] ${item.id}: ${item.title}`, this.formatDesc(item));
            created.push(item.id);
          } catch (err) {
            errors.push(`${item.id}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
    );

    const parts: string[] = [];
    if (created.length) parts.push(`Created ${created.length} card${created.length > 1 ? 's' : ''}`);
    if (errors.length)  parts.push(`${errors.length} failed`);

    if (errors.length) {
      void vscode.window.showWarningMessage(`Trello: ${parts.join(', ')}`);
    } else {
      void vscode.window.showInformationMessage(`Trello: ${parts.join(', ')}`);
    }
  }

  /** Load current In Progress cards for sidebar display. */
  async getActiveCards(): Promise<TrelloCard[]> {
    const config = this.getListConfig();
    if (!config) return [];
    try {
      if (!(await this.client.ensureAuthenticated())) return [];
      return await this.client.getCards(config.inProgressListId);
    } catch { return []; }
  }

  getListConfig(): TrelloListConfig | null {
    const cfg = vscode.workspace.getConfiguration('claudeWorkflow.trello');
    const boardId          = cfg.get<string>('boardId');
    const backlogListId    = cfg.get<string>('backlogListId');
    const inProgressListId = cfg.get<string>('inProgressListId');
    const doneListId       = cfg.get<string>('doneListId');
    if (!boardId || !backlogListId || !inProgressListId || !doneListId) return null;
    return {
      boardId,
      boardName:      cfg.get<string>('boardName') || 'Trello Board',
      backlogListId,
      inProgressListId,
      doneListId,
    };
  }

  // ── Source parsers ─────────────────────────────────────────────────────────

  private collectSourceItems(): SourceItem[] {
    return [
      ...this.parseTechDebt(),
      ...this.parseDoDFailures(),
      ...this.parseApiIssues(),
      ...this.parsePostReviewActions(),
    ];
  }

  private parseTechDebt(): SourceItem[] {
    const filePath = path.join(this.workspaceRoot, 'tech-debt.md');
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf8');
    const sections = content.split(/^### (TD-\d+):\s*(.+)$/gm);
    const items: SourceItem[] = [];
    for (let i = 1; i + 2 < sections.length; i += 3) {
      const id = sections[i];
      const title = sections[i + 1].trim();
      const body  = sections[i + 2];
      const status = this.extractField(body, 'Status') || 'Open';
      if (status.toLowerCase().includes('resolved')) continue;
      items.push({
        id, title,
        description: body.trim().slice(0, 300),
        priority:   this.extractField(body, 'Priority') || 'Medium',
        sourceType: 'tech-debt',
      });
    }
    return items;
  }

  private parseDoDFailures(): SourceItem[] {
    const filePath = path.join(this.workspaceRoot, '.claude', 'dod-result.md');
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf8');
    const failSection = content.match(/### Failures requiring action\n([\s\S]*?)(?=###|$)/);
    if (!failSection) return [];
    const lines = failSection[1].split('\n').filter(l => /^\d+\./.test(l.trim()));
    return lines.map((line, i) => ({
      id:          `DOD-${String(i + 1).padStart(3, '0')}`,
      title:       line.replace(/^\d+\.\s*/, '').split('—')[0].trim().slice(0, 80),
      description: line.replace(/^\d+\.\s*/, ''),
      priority:    'High',
      sourceType:  'dod-failure' as const,
    }));
  }

  private parseApiIssues(): SourceItem[] {
    const filePath = path.join(this.workspaceRoot, '.claude', 'api-audit.json');
    if (!fs.existsSync(filePath)) return [];
    try {
      const audit = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
        issues?: Array<{ method: string; path: string; rule: string; severity: string; message: string }>;
      };
      const critical = (audit.issues ?? []).filter(
        i => i.severity === 'critical' || i.severity === 'high'
      );
      return critical.map((issue, i) => ({
        id:          `API-${String(i + 1).padStart(3, '0')}`,
        title:       `${issue.method?.toUpperCase() ?? 'GET'} ${issue.path}: ${issue.rule}`,
        description: issue.message,
        priority:    issue.severity === 'critical' ? 'Critical' : 'High',
        sourceType:  'api-issue' as const,
      }));
    } catch { return []; }
  }

  private parsePostReviewActions(): SourceItem[] {
    const filePath = path.join(this.workspaceRoot, 'post-reviews.md');
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf8');
    const unchecked = [...content.matchAll(/^- \[ \] (.+)/gm)];
    return unchecked.map((m, i) => ({
      id:          `PIR-ACT-${String(i + 1).padStart(3, '0')}`,
      title:       m[1].trim().slice(0, 80),
      description: m[1].trim(),
      priority:    'Medium',
      sourceType:  'post-review-action' as const,
    }));
  }

  private extractField(body: string, fieldName: string): string {
    const re = new RegExp(`\\*\\*${fieldName}\\*\\*:\\s*(.+)`, 'i');
    const m  = body.match(re);
    return m ? m[1].trim() : '';
  }

  private formatDesc(item: SourceItem): string {
    return `Source: ${item.sourceType}\nPriority: ${item.priority}\n\n${item.description}\n\n---\nCreated by Claude Code Workflow extension`;
  }
}
