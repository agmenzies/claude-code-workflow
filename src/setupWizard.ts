/**
 * setupWizard.ts
 *
 * Multi-step webview wizard for first-time configuration.
 * Steps:
 *   1. Welcome — what the extension does
 *   2. Azure DevOps — org, project, auth, test connection
 *   3. Scaffold — pick which skills to create
 *   4. Done — summary + quick actions
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { AzureDevOpsClient, AdoConfig } from './azureDevOps';
import { getScaffoldableTemplates } from './skillTemplates';

export class SetupWizard {
  private panel: vscode.WebviewPanel | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly workspaceRoot: string | null
  ) {}

  open(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'claudeWorkflowSetup',
      'Claude Code Workflow — Setup',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(this.context.extensionPath, 'media')),
        ],
      }
    );

    const iconUri = this.panel.webview.asWebviewUri(
      vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'icon.png'))
    );

    this.panel.iconPath = vscode.Uri.file(
      path.join(this.context.extensionPath, 'media', 'icon.png')
    );

    this.panel.webview.html = this.getHtml(iconUri.toString());

    this.panel.webview.onDidReceiveMessage(
      msg => void this.handleMessage(msg),
      undefined,
      this.context.subscriptions
    );

    this.panel.onDidDispose(() => { this.panel = null; });
  }

  // ── Message handler ───────────────────────────────────────────────────────

  private async handleMessage(msg: { type: string; payload?: Record<string, string> }): Promise<void> {
    switch (msg.type) {
      case 'testConnection':
        await this.testConnection(msg.payload!);
        break;
      case 'saveConfig':
        await this.saveConfig(msg.payload!);
        break;
      case 'scaffoldSkills':
        await this.scaffoldSkills();
        break;
      case 'openPanel':
        void vscode.commands.executeCommand('claudeWorkflowPanel.focus');
        break;
      case 'runAudit':
        void vscode.commands.executeCommand('claudeWorkflow.auditApi');
        break;
      case 'syncWiki':
        void vscode.commands.executeCommand('claudeWorkflow.syncToWiki');
        break;
      case 'close':
        this.panel?.dispose();
        break;
    }
  }

  private async testConnection(payload: Record<string, string>): Promise<void> {
    const config: AdoConfig = {
      organization: payload.organization,
      project: payload.project,
    };

    const client = new AzureDevOpsClient(config, this.context.secrets);

    // Store PAT if provided
    if (payload.pat) {
      await this.context.secrets.store('claudeWorkflow.azureDevOps.pat', payload.pat);
    }

    try {
      const wikis = await client.listWikis();
      this.postMessage('connectionResult', {
        success: true,
        message: `Connected! Found ${wikis.length} wiki${wikis.length !== 1 ? 's' : ''}: ${wikis.map(w => w.name).join(', ')}`,
        wikis: JSON.stringify(wikis),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.postMessage('connectionResult', {
        success: false,
        message: `Connection failed: ${msg}`,
      });
    }
  }

  private async saveConfig(payload: Record<string, string>): Promise<void> {
    const config = vscode.workspace.getConfiguration('claudeWorkflow.azureDevOps');
    await config.update('organization', payload.organization, vscode.ConfigurationTarget.Workspace);
    await config.update('project', payload.project, vscode.ConfigurationTarget.Workspace);
    if (payload.wikiId) {
      await config.update('wikiId', payload.wikiId, vscode.ConfigurationTarget.Workspace);
    }
    this.postMessage('configSaved', {});
  }

  private async scaffoldSkills(): Promise<void> {
    if (!this.workspaceRoot) return;

    const skillsDir = path.join(this.workspaceRoot, '.claude', 'skills');
    if (!fs.existsSync(skillsDir)) fs.mkdirSync(skillsDir, { recursive: true });

    const templates = getScaffoldableTemplates();
    let created = 0;
    let skipped = 0;

    for (const { name, content } of templates) {
      const dest = path.join(skillsDir, `${name}.md`);
      if (fs.existsSync(dest)) { skipped++; continue; }
      fs.writeFileSync(dest, content, 'utf8');
      created++;
    }

    this.postMessage('scaffoldResult', {
      created: String(created),
      skipped: String(skipped),
      total: String(templates.length),
    });
  }

  private postMessage(type: string, payload: Record<string, string | boolean>): void {
    void this.panel?.webview.postMessage({ type, payload });
  }

  // ── HTML ──────────────────────────────────────────────────────────────────

  private getHtml(iconUri: string): string {
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src \${webview.cspSource} data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <style nonce="${nonce}">
    :root {
      --orange-500: #FF6B35;
      --orange-400: #FF8C42;
      --orange-600: #E85D26;
      --orange-100: #FFF3ED;
      --green-500: #22C55E;
      --red-500: #EF4444;
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --muted: var(--vscode-descriptionForeground);
      --border: var(--vscode-panel-border);
      --input-bg: var(--vscode-input-background);
      --input-fg: var(--vscode-input-foreground);
      --input-border: var(--vscode-input-border);
      --btn-bg: var(--vscode-button-background);
      --btn-fg: var(--vscode-button-foreground);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--fg);
      background: var(--bg);
      padding: 0;
      overflow-x: hidden;
    }

    .wizard {
      max-width: 680px;
      margin: 0 auto;
      padding: 32px 24px;
    }

    /* ── Header ── */
    .header {
      text-align: center;
      margin-bottom: 32px;
    }
    .header img {
      width: 72px;
      height: 72px;
      border-radius: 16px;
      margin-bottom: 16px;
    }
    .header h1 {
      font-size: 24px;
      font-weight: 600;
      margin-bottom: 4px;
    }
    .header p {
      color: var(--muted);
      font-size: 14px;
    }

    /* ── Step indicators ── */
    .steps {
      display: flex;
      justify-content: center;
      gap: 8px;
      margin-bottom: 32px;
    }
    .step-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--border);
      transition: all 0.3s ease;
    }
    .step-dot.active {
      background: var(--orange-500);
      width: 28px;
      border-radius: 5px;
    }
    .step-dot.done {
      background: var(--green-500);
    }

    /* ── Step panels ── */
    .step-panel {
      display: none;
      animation: fadeIn 0.3s ease;
    }
    .step-panel.active { display: block; }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .step-panel h2 {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 8px;
    }
    .step-panel .desc {
      color: var(--muted);
      margin-bottom: 24px;
      line-height: 1.5;
    }

    /* ── Cards ── */
    .card {
      background: var(--input-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 16px;
    }
    .card h3 {
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .card h3 .badge {
      font-size: 11px;
      font-weight: 500;
      padding: 2px 8px;
      border-radius: 10px;
      background: var(--orange-500);
      color: white;
    }

    /* ── Forms ── */
    .form-group {
      margin-bottom: 16px;
    }
    .form-group label {
      display: block;
      font-size: 12px;
      font-weight: 500;
      margin-bottom: 6px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .form-group input {
      width: 100%;
      padding: 8px 12px;
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--input-border);
      border-radius: 4px;
      font-size: 14px;
      font-family: var(--vscode-font-family);
    }
    .form-group input:focus {
      outline: none;
      border-color: var(--orange-500);
    }
    .form-group .hint {
      font-size: 12px;
      color: var(--muted);
      margin-top: 4px;
    }

    /* ── Buttons ── */
    .btn {
      padding: 8px 20px;
      border: none;
      border-radius: 4px;
      font-size: 14px;
      font-family: var(--vscode-font-family);
      cursor: pointer;
      transition: opacity 0.2s;
    }
    .btn:hover { opacity: 0.9; }
    .btn:active { opacity: 0.8; }

    .btn-primary {
      background: var(--orange-500);
      color: white;
      font-weight: 500;
    }
    .btn-secondary {
      background: var(--btn-bg);
      color: var(--btn-fg);
    }
    .btn-ghost {
      background: transparent;
      color: var(--muted);
      border: 1px solid var(--border);
    }
    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .btn-row {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      margin-top: 24px;
    }

    /* ── Status messages ── */
    .status {
      padding: 10px 14px;
      border-radius: 6px;
      font-size: 13px;
      margin-top: 12px;
      display: none;
    }
    .status.visible { display: block; }
    .status.success {
      background: rgba(34, 197, 94, 0.12);
      border: 1px solid rgba(34, 197, 94, 0.3);
      color: var(--green-500);
    }
    .status.error {
      background: rgba(239, 68, 68, 0.12);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: var(--red-500);
    }
    .status.loading {
      background: rgba(255, 107, 53, 0.12);
      border: 1px solid rgba(255, 107, 53, 0.3);
      color: var(--orange-500);
    }

    /* ── Feature grid ── */
    .feature-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin: 20px 0;
    }
    .feature-item {
      padding: 14px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--input-bg);
    }
    .feature-item .icon {
      font-size: 20px;
      margin-bottom: 6px;
    }
    .feature-item h4 {
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 2px;
    }
    .feature-item p {
      font-size: 12px;
      color: var(--muted);
    }

    /* ── Quick actions (step 4) ── */
    .action-row {
      display: flex;
      gap: 12px;
      margin-top: 20px;
      flex-wrap: wrap;
    }
    .action-card {
      flex: 1;
      min-width: 140px;
      padding: 16px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--input-bg);
      cursor: pointer;
      text-align: center;
      transition: border-color 0.2s, background 0.2s;
    }
    .action-card:hover {
      border-color: var(--orange-500);
      background: rgba(255, 107, 53, 0.06);
    }
    .action-card .icon { font-size: 24px; margin-bottom: 8px; }
    .action-card h4 { font-size: 13px; font-weight: 600; }
    .action-card p { font-size: 12px; color: var(--muted); }

    /* ── Spinner ── */
    .spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid rgba(255,255,255,0.3);
      border-top-color: white;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
      margin-right: 6px;
      vertical-align: middle;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="wizard">
    <!-- Header -->
    <div class="header">
      <img src="${iconUri}" alt="Claude Code Workflow" />
      <h1>Claude Code Workflow</h1>
      <p>Delivery cadence toolkit for AI-powered development</p>
    </div>

    <!-- Step indicators -->
    <div class="steps">
      <div class="step-dot active" id="dot-0"></div>
      <div class="step-dot" id="dot-1"></div>
      <div class="step-dot" id="dot-2"></div>
      <div class="step-dot" id="dot-3"></div>
    </div>

    <!-- Step 0: Welcome -->
    <div class="step-panel active" id="step-0">
      <h2>Ship faster, forget less</h2>
      <p class="desc">
        14 Claude Code skills that capture decisions, track debt, audit APIs, maintain living docs, and sync everything to Azure DevOps so your whole team stays in the loop.
      </p>

      <div class="feature-grid">
        <div class="feature-item">
          <div class="icon">&#9889;</div>
          <h4>Definition of Done</h4>
          <p>25-point quality gate run by Claude</p>
        </div>
        <div class="feature-item">
          <div class="icon">&#128736;</div>
          <h4>API Auditing</h4>
          <p>Auth, rate limits, Swagger coverage</p>
        </div>
        <div class="feature-item">
          <div class="icon">&#128218;</div>
          <h4>Living Docs</h4>
          <p>Decision log, patterns, failure modes</p>
        </div>
        <div class="feature-item">
          <div class="icon">&#9729;&#65039;</div>
          <h4>Azure DevOps Sync</h4>
          <p>Wiki pages + work items, auto or manual</p>
        </div>
      </div>

      <div class="btn-row">
        <button class="btn btn-primary" onclick="goStep(1)">Get started</button>
      </div>
    </div>

    <!-- Step 1: Azure DevOps -->
    <div class="step-panel" id="step-1">
      <h2>Connect Azure DevOps</h2>
      <p class="desc">
        Connect to sync living docs to your team's Wiki and push tech debt to Boards. You can skip this and configure later.
      </p>

      <div class="card">
        <h3>Connection details</h3>
        <div class="form-group">
          <label>Organization</label>
          <input type="text" id="ado-org" placeholder="mycompany" />
          <div class="hint">From dev.azure.com/<strong>mycompany</strong></div>
        </div>
        <div class="form-group">
          <label>Project</label>
          <input type="text" id="ado-project" placeholder="MyProject" />
        </div>
        <div class="form-group">
          <label>Personal Access Token</label>
          <input type="password" id="ado-pat" placeholder="Paste your PAT here" />
          <div class="hint">Needs Wiki Read/Write + Work Items Read/Write scopes. Stored in VS Code's secure secret storage.</div>
        </div>

        <button class="btn btn-secondary" id="btn-test" onclick="testConnection()">
          Test connection
        </button>

        <div class="status" id="connection-status"></div>
      </div>

      <div class="btn-row">
        <button class="btn btn-ghost" onclick="goStep(2)">Skip for now</button>
        <button class="btn btn-primary" id="btn-save-ado" onclick="saveAndContinue()" disabled>
          Save &amp; continue
        </button>
      </div>
    </div>

    <!-- Step 2: Scaffold Skills -->
    <div class="step-panel" id="step-2">
      <h2>Scaffold skills</h2>
      <p class="desc">
        Create Claude Code skill files in your project. These are markdown prompts in <code>.claude/skills/</code> that Claude executes when you invoke them.
      </p>

      <div class="card">
        <h3>Skills to create <span class="badge" id="skill-count">10 available</span></h3>
        <p style="color: var(--muted); font-size: 13px; margin-bottom: 12px;">
          Existing skill files won't be overwritten.
        </p>
        <button class="btn btn-primary" id="btn-scaffold" onclick="scaffoldSkills()">
          Scaffold all skills
        </button>
        <div class="status" id="scaffold-status"></div>
      </div>

      <div class="btn-row">
        <button class="btn btn-ghost" onclick="goStep(1)">Back</button>
        <button class="btn btn-primary" onclick="goStep(3)">Continue</button>
      </div>
    </div>

    <!-- Step 3: Done! -->
    <div class="step-panel" id="step-3">
      <h2>You're all set!</h2>
      <p class="desc">
        The extension is ready. Here are quick actions to get started:
      </p>

      <div class="action-row">
        <div class="action-card" onclick="send('openPanel')">
          <div class="icon">&#128203;</div>
          <h4>Open sidebar</h4>
          <p>View checklist &amp; skills</p>
        </div>
        <div class="action-card" onclick="send('runAudit')">
          <div class="icon">&#128737;</div>
          <h4>Audit API</h4>
          <p>Check routes for standards</p>
        </div>
        <div class="action-card" onclick="send('syncWiki')">
          <div class="icon">&#9729;&#65039;</div>
          <h4>Sync to wiki</h4>
          <p>Push docs to Azure DevOps</p>
        </div>
      </div>

      <div class="btn-row" style="margin-top: 32px;">
        <button class="btn btn-ghost" onclick="send('close')">Close wizard</button>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let currentStep = 0;
    let connectionOk = false;

    function goStep(n) {
      document.getElementById('step-' + currentStep).classList.remove('active');
      document.getElementById('step-' + n).classList.add('active');

      for (let i = 0; i < 4; i++) {
        const dot = document.getElementById('dot-' + i);
        dot.classList.remove('active', 'done');
        if (i < n) dot.classList.add('done');
        else if (i === n) dot.classList.add('active');
      }
      currentStep = n;
    }

    function send(type, payload) {
      vscode.postMessage({ type, payload });
    }

    function testConnection() {
      const btn = document.getElementById('btn-test');
      const status = document.getElementById('connection-status');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>Testing...';
      status.className = 'status visible loading';
      status.textContent = 'Connecting to Azure DevOps...';

      send('testConnection', {
        organization: document.getElementById('ado-org').value,
        project: document.getElementById('ado-project').value,
        pat: document.getElementById('ado-pat').value,
      });
    }

    function saveAndContinue() {
      send('saveConfig', {
        organization: document.getElementById('ado-org').value,
        project: document.getElementById('ado-project').value,
      });
      goStep(2);
    }

    function scaffoldSkills() {
      const btn = document.getElementById('btn-scaffold');
      const status = document.getElementById('scaffold-status');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>Scaffolding...';
      status.className = 'status visible loading';
      status.textContent = 'Creating skill files...';
      send('scaffoldSkills');
    }

    // Handle messages from extension
    window.addEventListener('message', event => {
      const { type, payload } = event.data;

      if (type === 'connectionResult') {
        const btn = document.getElementById('btn-test');
        const status = document.getElementById('connection-status');
        const saveBtn = document.getElementById('btn-save-ado');
        btn.disabled = false;
        btn.textContent = 'Test connection';

        if (payload.success) {
          status.className = 'status visible success';
          status.textContent = payload.message;
          connectionOk = true;
          saveBtn.disabled = false;
        } else {
          status.className = 'status visible error';
          status.textContent = payload.message;
          connectionOk = false;
          saveBtn.disabled = true;
        }
      }

      if (type === 'scaffoldResult') {
        const btn = document.getElementById('btn-scaffold');
        const status = document.getElementById('scaffold-status');
        btn.disabled = false;
        btn.textContent = 'Scaffold all skills';
        status.className = 'status visible success';
        status.textContent = 'Created ' + payload.created + ' skills (' + payload.skipped + ' already existed)';
      }

      if (type === 'configSaved') {
        // config saved, continue to next step
      }
    });
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
