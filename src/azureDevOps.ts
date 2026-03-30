/**
 * azureDevOps.ts
 *
 * Thin REST client for Azure DevOps — wiki pages and work items.
 * Uses PAT from VS Code SecretStorage or falls back to `az` CLI token.
 * No npm dependencies — uses Node built-in https.
 */

import * as vscode from 'vscode';
import * as https from 'https';
import * as http from 'http';
import { execSync } from 'child_process';

const API_VERSION = '7.0';

export interface AdoConfig {
  organization: string;
  project: string;
}

interface WikiPage {
  path: string;
  content: string;
  eTag?: string;
}

interface WorkItemFields {
  title: string;
  description?: string;
  tags?: string;
  priority?: number;       // 1-4 in Azure DevOps
  areaPath?: string;
  iterationPath?: string;
}

// ── Client ───────────────────────────────────────────────────────────────────

export class AzureDevOpsClient {
  private token: string | null = null;

  constructor(
    private readonly config: AdoConfig,
    private readonly secrets: vscode.SecretStorage
  ) {}

  // ── Authentication ──

  async ensureAuthenticated(): Promise<boolean> {
    // Try stored PAT first
    this.token = await this.secrets.get('claudeWorkflow.azureDevOps.pat') ?? null;
    if (this.token) return true;

    // Try az CLI token
    try {
      const result = execSync(
        'az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv',
        { encoding: 'utf8', timeout: 10000 }
      ).trim();
      if (result && result.length > 20) {
        this.token = result;
        return true;
      }
    } catch {
      // az CLI not available or not logged in
    }

    // Prompt for PAT
    const pat = await vscode.window.showInputBox({
      prompt: 'Enter your Azure DevOps Personal Access Token',
      placeHolder: 'PAT with Wiki Read/Write and Work Items Read/Write scopes',
      password: true,
      ignoreFocusOut: true,
    });

    if (!pat) return false;
    await this.secrets.store('claudeWorkflow.azureDevOps.pat', pat);
    this.token = pat;
    return true;
  }

  async clearStoredPat(): Promise<void> {
    await this.secrets.delete('claudeWorkflow.azureDevOps.pat');
    this.token = null;
  }

  // ── Wiki operations ──

  async listWikis(): Promise<Array<{ id: string; name: string }>> {
    const data = await this.get(`/_apis/wiki/wikis`);
    const items = (data as { value?: Array<{ id: string; name: string }> }).value ?? [];
    return items.map(w => ({ id: w.id, name: w.name }));
  }

  async getOrCreateWikiPage(
    wikiId: string,
    pagePath: string,
    content: string
  ): Promise<{ created: boolean; updated: boolean }> {
    const encodedPath = encodeURIComponent(pagePath);
    const url = `/_apis/wiki/wikis/${wikiId}/pages?path=${encodedPath}&includeContent=false`;

    // Try to get existing page for its eTag
    let eTag: string | undefined;
    try {
      const existing = await this.getWithHeaders(url);
      eTag = existing.headers['etag'] as string | undefined;
    } catch {
      // Page doesn't exist yet — that's fine
    }

    // PUT to create or update
    const putUrl = `/_apis/wiki/wikis/${wikiId}/pages?path=${encodedPath}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (eTag) {
      headers['If-Match'] = eTag;
    }

    await this.put(putUrl, { content }, headers);
    return { created: !eTag, updated: !!eTag };
  }

  // ── Work item operations ──

  async createWorkItem(
    type: string,
    fields: WorkItemFields
  ): Promise<{ id: number; url: string }> {
    const ops = [
      { op: 'add', path: '/fields/System.Title', value: fields.title },
    ];
    if (fields.description) {
      ops.push({ op: 'add', path: '/fields/System.Description', value: fields.description });
    }
    if (fields.tags) {
      ops.push({ op: 'add', path: '/fields/System.Tags', value: fields.tags });
    }
    if (fields.priority) {
      ops.push({ op: 'add', path: '/fields/Microsoft.VSTS.Common.Priority', value: fields.priority as unknown as string });
    }
    if (fields.areaPath) {
      ops.push({ op: 'add', path: '/fields/System.AreaPath', value: fields.areaPath });
    }
    if (fields.iterationPath) {
      ops.push({ op: 'add', path: '/fields/System.IterationPath', value: fields.iterationPath });
    }

    const data = await this.post(
      `/_apis/wit/workitems/$${encodeURIComponent(type)}`,
      ops,
      { 'Content-Type': 'application/json-patch+json' }
    );

    const typed = data as { id?: number; _links?: { html?: { href?: string } } };
    return { id: typed.id ?? 0, url: typed._links?.html?.href ?? '' };
  }

  async queryWorkItemsByTag(tag: string): Promise<Array<{ id: number; title: string }>> {
    const wiql = `SELECT [System.Id], [System.Title] FROM WorkItems WHERE [System.Tags] CONTAINS '${tag}' AND [System.State] <> 'Closed' ORDER BY [System.CreatedDate] DESC`;
    const data = await this.post('/_apis/wit/wiql', { query: wiql });
    const typed = data as { workItems?: Array<{ id: number }> };
    return (typed.workItems ?? []).map(w => ({
      id: w.id,
      title: '',
    }));
  }

  // ── HTTP primitives ────────────────────────────────────────────────────────

  private baseUrl(): string {
    return `https://dev.azure.com/${this.config.organization}/${this.config.project}`;
  }

  private authHeader(): string {
    if (!this.token) throw new Error('Not authenticated');
    // PAT uses Basic auth with empty username
    if (this.token.startsWith('eyJ')) {
      // Bearer token from az CLI
      return `Bearer ${this.token}`;
    }
    return `Basic ${Buffer.from(`:${this.token}`).toString('base64')}`;
  }

  private async get(path: string): Promise<Record<string, unknown>> {
    return this.request('GET', path);
  }

  private async getWithHeaders(
    path: string
  ): Promise<{ data: Record<string, unknown>; headers: http.IncomingHttpHeaders }> {
    return this.requestWithHeaders('GET', path);
  }

  private async post(
    path: string,
    body: unknown,
    extraHeaders?: Record<string, string>
  ): Promise<Record<string, unknown>> {
    return this.request('POST', path, body, extraHeaders);
  }

  private async put(
    path: string,
    body: unknown,
    extraHeaders?: Record<string, string>
  ): Promise<Record<string, unknown>> {
    return this.request('PUT', path, body, extraHeaders);
  }

  private request(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const separator = path.includes('?') ? '&' : '?';
      const fullUrl = `${this.baseUrl()}${path}${separator}api-version=${API_VERSION}`;
      const url = new URL(fullUrl);

      const headers: Record<string, string> = {
        Authorization: this.authHeader(),
        Accept: 'application/json',
        ...extraHeaders,
      };

      const payload = body ? JSON.stringify(body) : undefined;
      if (payload && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      }

      const opts: https.RequestOptions = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method,
        headers,
      };

      const req = https.request(opts, res => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(data || '{}')); }
            catch { resolve({}); }
          } else {
            reject(new Error(`Azure DevOps API ${res.statusCode}: ${data.slice(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  private requestWithHeaders(
    method: string,
    path: string
  ): Promise<{ data: Record<string, unknown>; headers: http.IncomingHttpHeaders }> {
    return new Promise((resolve, reject) => {
      const separator = path.includes('?') ? '&' : '?';
      const fullUrl = `${this.baseUrl()}${path}${separator}api-version=${API_VERSION}`;
      const url = new URL(fullUrl);

      const opts: https.RequestOptions = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method,
        headers: {
          Authorization: this.authHeader(),
          Accept: 'application/json',
        },
      };

      const req = https.request(opts, res => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve({ data: JSON.parse(data || '{}'), headers: res.headers }); }
            catch { resolve({ data: {}, headers: res.headers }); }
          } else {
            reject(new Error(`Azure DevOps API ${res.statusCode}: ${data.slice(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.end();
    });
  }
}
