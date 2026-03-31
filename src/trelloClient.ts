/**
 * trelloClient.ts
 *
 * Thin REST client for the Trello API. No npm dependencies — uses Node built-in https.
 * API key and token are stored in VS Code SecretStorage.
 */

import * as vscode from 'vscode';
import * as https from 'https';

const TRELLO_HOST = 'api.trello.com';

export interface TrelloBoard { id: string; name: string; }
export interface TrelloList  { id: string; name: string; }
export interface TrelloLabel { id: string; name: string; color: string; }
export interface TrelloCard  {
  id: string; name: string; desc: string;
  idList: string; url: string;
  labels: TrelloLabel[];
}

export class TrelloClient {
  private apiKey: string | null = null;
  private token:  string | null = null;

  constructor(private readonly secrets: vscode.SecretStorage) {}

  async ensureAuthenticated(): Promise<boolean> {
    this.apiKey = await this.secrets.get('claudeWorkflow.trello.apiKey') ?? null;
    this.token  = await this.secrets.get('claudeWorkflow.trello.token')  ?? null;
    if (this.apiKey && this.token) return true;

    if (!this.apiKey) {
      const key = await vscode.window.showInputBox({
        prompt: 'Enter your Trello API Key (from https://trello.com/app-key)',
        ignoreFocusOut: true,
      });
      if (!key) return false;
      await this.secrets.store('claudeWorkflow.trello.apiKey', key);
      this.apiKey = key;
    }

    if (!this.token) {
      const tok = await vscode.window.showInputBox({
        prompt: 'Enter your Trello API Token (from https://trello.com/app-key → Token link)',
        password: true,
        ignoreFocusOut: true,
      });
      if (!tok) return false;
      await this.secrets.store('claudeWorkflow.trello.token', tok);
      this.token = tok;
    }

    return !!(this.apiKey && this.token);
  }

  async clearCredentials(): Promise<void> {
    await this.secrets.delete('claudeWorkflow.trello.apiKey');
    await this.secrets.delete('claudeWorkflow.trello.token');
    this.apiKey = null;
    this.token  = null;
  }

  async getBoards(): Promise<TrelloBoard[]> {
    const data = await this.get('/1/members/me/boards?filter=open&fields=id,name');
    return (data as TrelloBoard[]) ?? [];
  }

  async getLists(boardId: string): Promise<TrelloList[]> {
    const data = await this.get(`/1/boards/${boardId}/lists?filter=open&fields=id,name`);
    return (data as TrelloList[]) ?? [];
  }

  async getCards(listId: string): Promise<TrelloCard[]> {
    const data = await this.get(`/1/lists/${listId}/cards?fields=id,name,desc,idList,url,labels`);
    return (data as TrelloCard[]) ?? [];
  }

  async createCard(listId: string, name: string, desc: string): Promise<TrelloCard> {
    const data = await this.post('/1/cards', { idList: listId, name, desc });
    return data as TrelloCard;
  }

  async moveCard(cardId: string, listId: string): Promise<void> {
    await this.put(`/1/cards/${cardId}`, { idList: listId });
  }

  // ── HTTP primitives ──

  private authSuffix(): string {
    return `key=${this.apiKey ?? ''}&token=${this.token ?? ''}`;
  }

  private get(path: string): Promise<unknown> {
    return this.request('GET', path);
  }

  private post(path: string, body: Record<string, string>): Promise<unknown> {
    return this.request('POST', path, body);
  }

  private put(path: string, body: Record<string, string>): Promise<unknown> {
    return this.request('PUT', path, body);
  }

  private request(method: string, path: string, body?: Record<string, string>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const sep = path.includes('?') ? '&' : '?';
      const fullPath = `${path}${sep}${this.authSuffix()}`;

      let payload: string | undefined;
      const headers: Record<string, string> = {};

      if (body && method !== 'GET') {
        payload = new URLSearchParams(body).toString();
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        headers['Content-Length'] = String(Buffer.byteLength(payload));
      }

      const req = https.request(
        { hostname: TRELLO_HOST, path: fullPath, method, headers },
        res => {
          let data = '';
          res.on('data', (c: string) => (data += c));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              try { resolve(JSON.parse(data || 'null')); } catch { resolve(null); }
            } else {
              reject(new Error(`Trello ${res.statusCode}: ${data.slice(0, 200)}`));
            }
          });
        }
      );

      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }
}
