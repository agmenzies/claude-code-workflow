/**
 * setupWizard.ts
 *
 * Multi-step webview wizard for first-time configuration.
 * Steps:
 *   0. Welcome — what the extension does
 *   1. Assessment — what the extension found in this project
 *   2. Azure DevOps — org, project, auth, test connection
 *   3. Scaffold — create only what's missing
 *   4. Done — summary + quick actions
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { AzureDevOpsClient, AdoConfig } from './azureDevOps';
import { getScaffoldableTemplates, getScaffoldableForProfile } from './skillTemplates';
import type { ProjectProfile } from './envAssessment';

export class SetupWizard {
  private panel: vscode.WebviewPanel | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly workspaceRoot: string | null,
    private readonly profilePromise: Promise<ProjectProfile> | null = null
  ) {}

  open(): void {
    if (this.panel) { this.panel.reveal(); return; }

    this.panel = vscode.window.createWebviewPanel(
      'claudeWorkflowSetup',
      'Claude Code Workflow — Setup',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.file(path.join(this.context.extensionPath, 'media'))] }
    );

    const iconUri = this.panel.webview.asWebviewUri(
      vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'icon.png'))
    );
    this.panel.iconPath = vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'icon.png'));
    this.panel.webview.html = this.getHtml(iconUri.toString());

    this.panel.webview.onDidReceiveMessage(
      msg => void this.handleMessage(msg),
      undefined, this.context.subscriptions
    );
    this.panel.onDidDispose(() => { this.panel = null; });
  }

  // ── Message handler ───────────────────────────────────────────────────────

  private async handleMessage(msg: { type: string; payload?: Record<string, string> }): Promise<void> {
    switch (msg.type) {
      case 'requestAssessment':
        await this.sendAssessment();
        break;
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

  private async sendAssessment(): Promise<void> {
    if (!this.profilePromise) {
      this.postMessage('assessmentData', { profile: '' });
      return;
    }
    try {
      const profile = await this.profilePromise;
      this.postMessage('assessmentData', { profile: JSON.stringify(profile) });
    } catch {
      this.postMessage('assessmentData', { profile: '' });
    }
  }

  private async testConnection(payload: Record<string, string>): Promise<void> {
    const config: AdoConfig = { organization: payload.organization, project: payload.project };
    const client = new AzureDevOpsClient(config, this.context.secrets);
    if (payload.pat) {
      await this.context.secrets.store('claudeWorkflow.azureDevOps.pat', payload.pat);
    }
    try {
      const wikis = await client.listWikis();
      this.postMessage('connectionResult', {
        success: 'true',
        message: `Connected! Found ${wikis.length} wiki${wikis.length !== 1 ? 's' : ''}: ${wikis.map(w => w.name).join(', ')}`,
      });
    } catch (err) {
      this.postMessage('connectionResult', {
        success: 'false',
        message: `Connection failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  private async saveConfig(payload: Record<string, string>): Promise<void> {
    const config = vscode.workspace.getConfiguration('claudeWorkflow.azureDevOps');
    await config.update('organization', payload.organization, vscode.ConfigurationTarget.Workspace);
    await config.update('project', payload.project, vscode.ConfigurationTarget.Workspace);
    this.postMessage('configSaved', {});
  }

  private async scaffoldSkills(): Promise<void> {
    if (!this.workspaceRoot) return;
    const skillsDir = path.join(this.workspaceRoot, '.claude', 'skills');
    if (!fs.existsSync(skillsDir)) fs.mkdirSync(skillsDir, { recursive: true });

    let templates;
    if (this.profilePromise) {
      try {
        const profile = await this.profilePromise;
        templates = getScaffoldableForProfile(profile);
      } catch {
        templates = getScaffoldableTemplates();
      }
    } else {
      templates = getScaffoldableTemplates();
    }

    let created = 0, skipped = 0;
    for (const { name, content } of templates) {
      const dest = path.join(skillsDir, `${name}.md`);
      if (fs.existsSync(dest)) { skipped++; continue; }
      fs.writeFileSync(dest, content, 'utf8');
      created++;
    }

    this.postMessage('scaffoldResult', {
      created: String(created), skipped: String(skipped), total: String(templates.length),
    });
  }

  private postMessage(type: string, payload: Record<string, string>): void {
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
      --orange-500: #FF6B35; --orange-400: #FF8C42; --green-500: #22C55E;
      --amber-500: #F59E0B; --red-500: #EF4444;
      --bg: var(--vscode-editor-background); --fg: var(--vscode-editor-foreground);
      --muted: var(--vscode-descriptionForeground); --border: var(--vscode-panel-border);
      --input-bg: var(--vscode-input-background); --input-fg: var(--vscode-input-foreground);
      --input-border: var(--vscode-input-border);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
           color: var(--fg); background: var(--bg); }
    .wizard { max-width: 680px; margin: 0 auto; padding: 32px 24px; }
    .header { text-align: center; margin-bottom: 24px; }
    .header img { width: 64px; height: 64px; border-radius: 14px; margin-bottom: 12px; }
    .header h1 { font-size: 22px; font-weight: 600; }
    .header p { color: var(--muted); font-size: 13px; }

    .steps { display: flex; justify-content: center; gap: 6px; margin-bottom: 28px; }
    .step-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--border); transition: all 0.3s; }
    .step-dot.active { background: var(--orange-500); width: 28px; border-radius: 5px; }
    .step-dot.done { background: var(--green-500); }

    .step-panel { display: none; animation: fadeIn 0.3s ease; }
    .step-panel.active { display: block; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
    .step-panel h2 { font-size: 17px; font-weight: 600; margin-bottom: 6px; }
    .step-panel .desc { color: var(--muted); margin-bottom: 20px; line-height: 1.5; font-size: 13px; }

    .card { background: var(--input-bg); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 14px; }
    .card h3 { font-size: 13px; font-weight: 600; margin-bottom: 10px; display: flex; align-items: center; gap: 8px; }
    .badge { font-size: 11px; font-weight: 500; padding: 2px 8px; border-radius: 10px; color: white; }
    .badge-orange { background: var(--orange-500); }
    .badge-green { background: var(--green-500); }
    .badge-amber { background: var(--amber-500); }

    .form-group { margin-bottom: 14px; }
    .form-group label { display: block; font-size: 11px; font-weight: 500; margin-bottom: 4px;
                        color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; }
    .form-group input { width: 100%; padding: 7px 10px; background: var(--input-bg); color: var(--input-fg);
                        border: 1px solid var(--input-border); border-radius: 4px; font-size: 13px;
                        font-family: var(--vscode-font-family); }
    .form-group input:focus { outline: none; border-color: var(--orange-500); }
    .form-group .hint { font-size: 11px; color: var(--muted); margin-top: 3px; }

    .btn { padding: 7px 18px; border: none; border-radius: 4px; font-size: 13px;
           font-family: var(--vscode-font-family); cursor: pointer; transition: opacity 0.2s; }
    .btn:hover { opacity: 0.9; } .btn:active { opacity: 0.8; }
    .btn-primary { background: var(--orange-500); color: white; font-weight: 500; }
    .btn-secondary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .btn-ghost { background: transparent; color: var(--muted); border: 1px solid var(--border); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; }

    .status { padding: 8px 12px; border-radius: 6px; font-size: 12px; margin-top: 10px; display: none; }
    .status.visible { display: block; }
    .status.success { background: rgba(34,197,94,0.12); border: 1px solid rgba(34,197,94,0.3); color: var(--green-500); }
    .status.error { background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.3); color: var(--red-500); }
    .status.loading { background: rgba(255,107,53,0.12); border: 1px solid rgba(255,107,53,0.3); color: var(--orange-500); }

    .feature-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 16px 0; }
    .feature-item { padding: 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--input-bg); }
    .feature-item .icon { font-size: 18px; margin-bottom: 4px; }
    .feature-item h4 { font-size: 12px; font-weight: 600; } .feature-item p { font-size: 11px; color: var(--muted); }

    .action-row { display: flex; gap: 10px; margin-top: 16px; flex-wrap: wrap; }
    .action-card { flex: 1; min-width: 130px; padding: 14px; border-radius: 8px; border: 1px solid var(--border);
                   background: var(--input-bg); cursor: pointer; text-align: center; transition: border-color 0.2s; }
    .action-card:hover { border-color: var(--orange-500); }
    .action-card .icon { font-size: 22px; margin-bottom: 6px; }
    .action-card h4 { font-size: 12px; font-weight: 600; }
    .action-card p { font-size: 11px; color: var(--muted); }

    .spinner { display: inline-block; width: 13px; height: 13px; border: 2px solid rgba(255,255,255,0.3);
               border-top-color: white; border-radius: 50%; animation: spin 0.6s linear infinite;
               margin-right: 5px; vertical-align: middle; }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* Assessment step */
    .assess-row { display: flex; align-items: center; gap: 8px; padding: 5px 0; font-size: 12px; }
    .assess-row .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .dot-green { background: var(--green-500); }
    .dot-amber { background: var(--amber-500); }
    .dot-red { background: var(--red-500); }
    .dot-blue { background: #3B82F6; }
    .assess-row .label { flex: 1; }
    .assess-row .value { color: var(--muted); text-align: right; }
    .assess-section { margin-bottom: 14px; }
    .assess-section h4 { font-size: 12px; font-weight: 600; margin-bottom: 6px; text-transform: uppercase;
                         letter-spacing: 0.5px; color: var(--muted); }
    .conflict-item { padding: 6px 10px; margin: 4px 0; border-radius: 4px; font-size: 12px;
                     background: rgba(245,158,11,0.1); border-left: 3px solid var(--amber-500); }
  </style>
</head>
<body>
  <div class="wizard">
    <div class="header">
      <img src="${iconUri}" alt="Claude Code Workflow" />
      <h1>Claude Code Workflow</h1>
      <p>Delivery cadence toolkit for AI-powered development</p>
    </div>

    <div class="steps">
      <div class="step-dot active" id="dot-0"></div>
      <div class="step-dot" id="dot-1"></div>
      <div class="step-dot" id="dot-2"></div>
      <div class="step-dot" id="dot-3"></div>
      <div class="step-dot" id="dot-4"></div>
    </div>

    <!-- Step 0: Welcome -->
    <div class="step-panel active" id="step-0">
      <h2>Ship faster, forget less</h2>
      <p class="desc">14 Claude Code skills that capture decisions, track debt, audit APIs, maintain living docs, and sync to Azure DevOps.</p>
      <div class="feature-grid">
        <div class="feature-item"><div class="icon">&#9889;</div><h4>Definition of Done</h4><p>25-point quality gate</p></div>
        <div class="feature-item"><div class="icon">&#128736;</div><h4>API Auditing</h4><p>Auth, rate limits, coverage</p></div>
        <div class="feature-item"><div class="icon">&#128218;</div><h4>Living Docs</h4><p>Decision log, patterns, debt</p></div>
        <div class="feature-item"><div class="icon">&#9729;&#65039;</div><h4>Azure DevOps</h4><p>Wiki + work item sync</p></div>
      </div>
      <div class="btn-row"><button class="btn btn-primary" onclick="goStep(1)">Scan this project</button></div>
    </div>

    <!-- Step 1: Assessment -->
    <div class="step-panel" id="step-1">
      <h2>Project assessment</h2>
      <p class="desc">Scanning your workspace to find what's already in place...</p>
      <div id="assess-loading" class="status visible loading"><span class="spinner"></span> Scanning...</div>
      <div id="assess-results" style="display:none;">
        <div class="card">
          <h3>Project fingerprint</h3>
          <div id="fingerprint"></div>
        </div>
        <div class="card">
          <h3>Artefacts found</h3>
          <div id="artefacts"></div>
        </div>
        <div id="conflicts-card" class="card" style="display:none;">
          <h3>Adaptations <span class="badge badge-amber" id="conflict-count">0</span></h3>
          <div id="conflicts-list"></div>
        </div>
      </div>
      <div class="btn-row">
        <button class="btn btn-ghost" onclick="goStep(0)">Back</button>
        <button class="btn btn-primary" onclick="goStep(2)">Continue</button>
      </div>
    </div>

    <!-- Step 2: Azure DevOps -->
    <div class="step-panel" id="step-2">
      <h2>Connect Azure DevOps</h2>
      <p class="desc">Sync living docs to your team's Wiki. You can skip and configure later.</p>
      <div class="card">
        <h3>Connection details</h3>
        <div class="form-group"><label>Organization</label><input type="text" id="ado-org" placeholder="mycompany" /><div class="hint">From dev.azure.com/<strong>mycompany</strong></div></div>
        <div class="form-group"><label>Project</label><input type="text" id="ado-project" placeholder="MyProject" /></div>
        <div class="form-group"><label>Personal Access Token</label><input type="password" id="ado-pat" placeholder="Paste your PAT" /><div class="hint">Wiki + Work Items scopes. Stored securely.</div></div>
        <button class="btn btn-secondary" id="btn-test" onclick="testConnection()">Test connection</button>
        <div class="status" id="connection-status"></div>
      </div>
      <div class="btn-row">
        <button class="btn btn-ghost" onclick="goStep(3)">Skip</button>
        <button class="btn btn-primary" id="btn-save-ado" onclick="saveAndContinue()" disabled>Save &amp; continue</button>
      </div>
    </div>

    <!-- Step 3: Scaffold -->
    <div class="step-panel" id="step-3">
      <h2>Scaffold skills</h2>
      <p class="desc" id="scaffold-desc">Create Claude Code skill files in <code>.claude/skills/</code>. Only missing skills will be created — existing ones won't be touched.</p>
      <div class="card">
        <h3>Skills <span class="badge badge-orange" id="skill-count"></span></h3>
        <div id="skill-summary" style="font-size:12px; color:var(--muted); margin-bottom:10px;"></div>
        <button class="btn btn-primary" id="btn-scaffold" onclick="scaffoldSkills()">Scaffold missing skills</button>
        <div class="status" id="scaffold-status"></div>
      </div>
      <div class="btn-row">
        <button class="btn btn-ghost" onclick="goStep(2)">Back</button>
        <button class="btn btn-primary" onclick="goStep(4)">Continue</button>
      </div>
    </div>

    <!-- Step 4: Done -->
    <div class="step-panel" id="step-4">
      <h2>You're all set!</h2>
      <p class="desc">The extension is configured and adapted to your project.</p>
      <div class="action-row">
        <div class="action-card" onclick="send('openPanel')"><div class="icon">&#128203;</div><h4>Open sidebar</h4><p>Checklist &amp; skills</p></div>
        <div class="action-card" onclick="send('runAudit')"><div class="icon">&#128737;</div><h4>Audit API</h4><p>Check routes</p></div>
        <div class="action-card" onclick="send('syncWiki')"><div class="icon">&#9729;&#65039;</div><h4>Sync to wiki</h4><p>Push docs to ADO</p></div>
      </div>
      <div class="btn-row" style="margin-top:28px;"><button class="btn btn-ghost" onclick="send('close')">Close wizard</button></div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let currentStep = 0;
    let profileData = null;

    function goStep(n) {
      document.getElementById('step-' + currentStep).classList.remove('active');
      document.getElementById('step-' + n).classList.add('active');
      for (let i = 0; i < 5; i++) {
        const dot = document.getElementById('dot-' + i);
        dot.classList.remove('active', 'done');
        if (i < n) dot.classList.add('done');
        else if (i === n) dot.classList.add('active');
      }
      currentStep = n;

      // Trigger assessment when entering step 1
      if (n === 1 && !profileData) {
        send('requestAssessment');
      }
    }

    function send(type, payload) { vscode.postMessage({ type, payload }); }

    function testConnection() {
      const btn = document.getElementById('btn-test');
      const status = document.getElementById('connection-status');
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Testing...';
      status.className = 'status visible loading'; status.textContent = 'Connecting...';
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
      goStep(3);
    }

    function scaffoldSkills() {
      const btn = document.getElementById('btn-scaffold');
      const status = document.getElementById('scaffold-status');
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Scaffolding...';
      status.className = 'status visible loading'; status.textContent = 'Creating skill files...';
      send('scaffoldSkills');
    }

    // ── Render assessment ────────────────────────────────────────────────

    function renderAssessment(profile) {
      document.getElementById('assess-loading').style.display = 'none';
      document.getElementById('assess-results').style.display = 'block';

      // Fingerprint
      const fp = document.getElementById('fingerprint');
      const fpItems = [
        ['Package manager', profile.packageManager, 'green'],
        ['Framework', profile.framework, 'green'],
        ['Test runner', profile.testRunner === 'none' ? 'Not detected' : profile.testRunner + (profile.testConfigPath ? ' (' + profile.testConfigPath + ')' : ''), profile.testRunner === 'none' ? 'red' : 'green'],
        ['Test directories', profile.testDirectories.length > 0 ? profile.testDirectories.join(', ') : 'None found', profile.testDirectories.length > 0 ? 'green' : 'red'],
        ['Swagger format', profile.swaggerFormat === 'none' ? 'Not detected' : profile.swaggerFormat + (profile.swaggerDir ? ' (' + profile.swaggerDir + ')' : ''), profile.swaggerFormat === 'none' ? 'amber' : 'green'],
        ['CI/CD', profile.ciProviders.filter(p => p !== 'none').join(', ') || 'None detected', profile.ciProviders[0] === 'none' ? 'amber' : 'green'],
      ];
      fp.innerHTML = fpItems.map(([label, value, color]) =>
        '<div class="assess-row"><div class="dot dot-' + color + '"></div><span class="label">' + label + '</span><span class="value">' + value + '</span></div>'
      ).join('');

      // Artefacts
      const ar = document.getElementById('artefacts');
      let html = '';

      // Skills
      const presentSkills = profile.existingSkills.filter(s => s.status === 'present' || s.status === 'custom').length;
      const missingSkills = profile.existingSkills.filter(s => s.status === 'missing').length;
      html += '<div class="assess-section"><h4>Skills</h4>';
      html += '<div class="assess-row"><div class="dot dot-' + (presentSkills > 0 ? 'green' : 'red') + '"></div>';
      html += '<span class="label">' + presentSkills + ' existing, ' + missingSkills + ' to scaffold</span></div></div>';

      // Living docs
      html += '<div class="assess-section"><h4>Living Docs</h4>';
      for (const doc of profile.livingDocs) {
        let color = 'red';
        let detail = 'Missing';
        if (doc.status === 'present') { color = 'green'; detail = doc.actualPath; }
        else if (doc.status === 'equivalent') { color = 'amber'; detail = 'Found as ' + doc.actualPath; }
        else if (doc.status === 'alternative') { color = 'blue'; detail = doc.actualPath; }
        html += '<div class="assess-row"><div class="dot dot-' + color + '"></div>';
        html += '<span class="label">' + doc.label + '</span><span class="value">' + detail + '</span></div>';
      }
      html += '</div>';

      // Extra docs discovered
      if (profile.extraDocs.length > 0) {
        html += '<div class="assess-section"><h4>Additional docs found</h4>';
        for (const doc of profile.extraDocs) {
          html += '<div class="assess-row"><div class="dot dot-blue"></div>';
          html += '<span class="label">' + doc.label + '</span><span class="value">' + doc.actualPath + '</span></div>';
        }
        html += '</div>';
      }

      // Agents
      if (profile.existingAgents.length > 0) {
        html += '<div class="assess-section"><h4>Agents (' + profile.agentStructure + ')</h4>';
        html += '<div class="assess-row"><div class="dot dot-green"></div>';
        html += '<span class="label">' + profile.existingAgents.length + ' agent files in .claude/agents/</span></div></div>';
      }

      ar.innerHTML = html;

      // Conflicts
      if (profile.conflicts.length > 0) {
        const cc = document.getElementById('conflicts-card');
        cc.style.display = 'block';
        document.getElementById('conflict-count').textContent = profile.conflicts.length;
        document.getElementById('conflicts-list').innerHTML = profile.conflicts.map(c =>
          '<div class="conflict-item"><strong>' + c.what + '</strong>: ' + c.detail + '</div>'
        ).join('');
      }

      // Update scaffold step summary
      const skillSummaryEl = document.getElementById('skill-summary');
      if (missingSkills === 0) {
        skillSummaryEl.textContent = 'All skill files already exist. Nothing to scaffold.';
        document.getElementById('btn-scaffold').disabled = true;
        document.getElementById('btn-scaffold').textContent = 'All skills present';
      } else {
        skillSummaryEl.textContent = missingSkills + ' skills to create, ' + presentSkills + ' already in place (won\\'t be touched).';
      }
      document.getElementById('skill-count').textContent = missingSkills + ' missing';

      // Assessment timing
      const descEl = document.querySelector('#step-1 .desc');
      descEl.textContent = 'Scanned in ' + profile.assessmentDurationMs + 'ms. Here\\'s what was found:';
    }

    // ── Message handler ──────────────────────────────────────────────────

    window.addEventListener('message', event => {
      const { type, payload } = event.data;

      if (type === 'assessmentData') {
        if (payload.profile) {
          profileData = JSON.parse(payload.profile);
          renderAssessment(profileData);
        } else {
          document.getElementById('assess-loading').innerHTML = 'Assessment not available. Continue to configure manually.';
        }
      }

      if (type === 'connectionResult') {
        const btn = document.getElementById('btn-test');
        const status = document.getElementById('connection-status');
        btn.disabled = false; btn.textContent = 'Test connection';
        if (payload.success === 'true') {
          status.className = 'status visible success'; status.textContent = payload.message;
          document.getElementById('btn-save-ado').disabled = false;
        } else {
          status.className = 'status visible error'; status.textContent = payload.message;
          document.getElementById('btn-save-ado').disabled = true;
        }
      }

      if (type === 'scaffoldResult') {
        const btn = document.getElementById('btn-scaffold');
        const status = document.getElementById('scaffold-status');
        btn.disabled = false; btn.textContent = 'Scaffold missing skills';
        status.className = 'status visible success';
        status.textContent = 'Created ' + payload.created + ' skills (' + payload.skipped + ' already existed)';
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
  for (let i = 0; i < 32; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));
  return text;
}
