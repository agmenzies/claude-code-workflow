/**
 * wikiSync.ts
 *
 * Pushes local living docs to Azure DevOps Wiki pages.
 * Each doc maps to a page under a configurable root path.
 * Handles create, update, and staleness detection.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { AzureDevOpsClient, AdoConfig } from './azureDevOps';
import type { ProjectProfile } from './envAssessment';

interface DocMapping {
  localFile: string;       // relative to workspace root
  wikiPath: string;        // wiki page path under root
  label: string;           // human-readable name
}

const DOC_MAPPINGS: DocMapping[] = [
  { localFile: 'decision-log.md',      wikiPath: 'Decision Log',      label: 'Decision Log' },
  { localFile: 'patterns-library.md',  wikiPath: 'Patterns Library',  label: 'Patterns Library' },
  { localFile: 'failure-modes.md',     wikiPath: 'Failure Modes',     label: 'Failure Modes' },
  { localFile: 'tech-debt.md',         wikiPath: 'Tech Debt',         label: 'Tech Debt' },
  { localFile: 'release-notes.md',     wikiPath: 'Release Notes',     label: 'Release Notes' },
  { localFile: 'UAT.md',              wikiPath: 'UAT Spec',           label: 'UAT Spec' },
  { localFile: 'design-standards.md', wikiPath: 'Design Standards',   label: 'Design Standards' },
  { localFile: 'agent-playbooks.md',  wikiPath: 'Agent Playbooks',    label: 'Agent Playbooks' },
  { localFile: 'post-reviews.md',     wikiPath: 'Post-Reviews',       label: 'Post-Reviews' },
];

export interface SyncResult {
  created: string[];
  updated: string[];
  skipped: string[];
  errors: Array<{ doc: string; error: string }>;
}

export class WikiSyncProvider {
  private client: AzureDevOpsClient | null = null;
  private profile: ProjectProfile | null = null;

  constructor(
    private readonly workspaceRoot: string,
    private readonly secrets: vscode.SecretStorage
  ) {}

  setProfile(profile: ProjectProfile): void {
    this.profile = profile;
  }

  /** Generate doc mappings from profile (uses actual discovered paths) or fall back to defaults. */
  private getDocMappings(): DocMapping[] {
    if (!this.profile) return DOC_MAPPINGS;

    const mappings: DocMapping[] = [];
    for (const doc of this.profile.livingDocs) {
      if (doc.actualPath && doc.status !== 'missing') {
        mappings.push({ localFile: doc.actualPath, wikiPath: doc.label, label: doc.label });
      }
    }
    // Also include extra docs discovered by assessment
    for (const doc of this.profile.extraDocs) {
      if (doc.actualPath) {
        mappings.push({ localFile: doc.actualPath, wikiPath: doc.label, label: doc.label });
      }
    }
    return mappings;
  }

  async syncAll(): Promise<SyncResult> {
    const config = this.getAdoConfig();
    if (!config) {
      void vscode.window.showErrorMessage(
        'Azure DevOps not configured. Set claudeWorkflow.azureDevOps.organization and project in settings.'
      );
      return { created: [], updated: [], skipped: [], errors: [] };
    }

    const client = this.getClient(config);
    if (!(await client.ensureAuthenticated())) {
      return { created: [], updated: [], skipped: [], errors: [] };
    }

    // Find or select wiki
    const wikiId = await this.resolveWikiId(client);
    if (!wikiId) return { created: [], updated: [], skipped: [], errors: [] };

    const rootPath = this.getWikiRootPath();
    const result: SyncResult = { created: [], updated: [], skipped: [], errors: [] };

    // Sync each doc that exists locally
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Syncing to Azure DevOps Wiki',
        cancellable: false,
      },
      async progress => {
        const allMappings = this.getDocMappings();
        const existingDocs = allMappings.filter(d =>
          fs.existsSync(path.join(this.workspaceRoot, d.localFile))
        );

        for (let i = 0; i < existingDocs.length; i++) {
          const doc = existingDocs[i];
          progress.report({
            message: doc.label,
            increment: (100 / existingDocs.length),
          });

          try {
            const content = fs.readFileSync(
              path.join(this.workspaceRoot, doc.localFile),
              'utf8'
            );
            const pagePath = `${rootPath}/${doc.wikiPath}`;
            const { created, updated } = await client.getOrCreateWikiPage(
              wikiId,
              pagePath,
              content
            );

            if (created) result.created.push(doc.label);
            else if (updated) result.updated.push(doc.label);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            result.errors.push({ doc: doc.label, error: msg });
          }
        }

        // Skipped = defined but file doesn't exist locally
        const missing = allMappings.filter(d =>
          !fs.existsSync(path.join(this.workspaceRoot, d.localFile))
        );
        result.skipped = missing.map(d => d.label);
      }
    );

    return result;
  }

  async syncSingleDoc(localFile: string): Promise<void> {
    const config = this.getAdoConfig();
    if (!config) return;

    const client = this.getClient(config);
    if (!(await client.ensureAuthenticated())) return;

    const wikiId = await this.resolveWikiId(client);
    if (!wikiId) return;

    const mapping = DOC_MAPPINGS.find(d => d.localFile === localFile);
    if (!mapping) return;

    const content = fs.readFileSync(
      path.join(this.workspaceRoot, localFile),
      'utf8'
    );
    const rootPath = this.getWikiRootPath();
    await client.getOrCreateWikiPage(wikiId, `${rootPath}/${mapping.wikiPath}`, content);
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

  private getWikiRootPath(): string {
    return vscode.workspace
      .getConfiguration('claudeWorkflow.azureDevOps')
      .get<string>('wikiRootPath', '/Claude Workflow');
  }

  private async resolveWikiId(client: AzureDevOpsClient): Promise<string | null> {
    const configuredId = vscode.workspace
      .getConfiguration('claudeWorkflow.azureDevOps')
      .get<string>('wikiId');
    if (configuredId) return configuredId;

    // Auto-discover — pick the project wiki
    try {
      const wikis = await client.listWikis();
      if (wikis.length === 0) {
        void vscode.window.showErrorMessage('No wikis found in the Azure DevOps project.');
        return null;
      }
      if (wikis.length === 1) return wikis[0].id;

      // Let user pick
      const pick = await vscode.window.showQuickPick(
        wikis.map(w => ({ label: w.name, id: w.id })),
        { placeHolder: 'Select which wiki to sync to' }
      );
      return pick?.id ?? null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`Failed to list wikis: ${msg}`);
      return null;
    }
  }
}
