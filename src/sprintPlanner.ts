/**
 * sprintPlanner.ts
 *
 * Planning dashboard webview. Shows release readiness, velocity,
 * open backlog, and sprint plan builder. Opens via claudeWorkflow.openPlanner.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { SkillRunner } from './skillRunner';
import type { PlanningState, BacklogItem } from './planningEngine';

interface PlannerWebviewState {
  computedAt: string;
  velocity: PlanningState['velocity'];
  backlog: BacklogItem[];
  readiness: PlanningState['readiness'];
  sprintPlanExists: boolean;
  sprintPlanAgeDays: number;
  adoConfigured: boolean;
  trelloConfigured: boolean;
}

export class SprintPlanner {
  private panel: vscode.WebviewPanel | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly workspaceRoot: string,
    private readonly runner: SkillRunner,
    private readonly getPlanningState: () => PlanningState | null,
    private readonly triggerRefresh: () => Promise<void>
  ) {}

  open(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'claudeWorkflowPlanner',
      'Sprint Planner',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.file(path.join(this.context.extensionPath, 'media'))] }
    );

    this.panel.iconPath = vscode.Uri.file(
      path.join(this.context.extensionPath, 'media', 'icon.png')
    );

    this.panel.webview.html = this.getHtml();

    this.panel.webview.onDidReceiveMessage(async (msg: { type: string; payload?: unknown }) => {
      await this.handleMessage(msg);
    });

    this.panel.onDidDispose(() => { this.panel = null; });

    // Send initial state
    const state = this.getPlanningState();
    if (state) {
      this.postMessage('stateUpdate', this.buildWebviewState(state));
    } else {
      this.postMessage('computing');
      void this.triggerRefresh();
    }
  }

  updateState(state: PlanningState): void {
    if (!this.panel) return;
    this.postMessage('stateUpdate', this.buildWebviewState(state));
  }

  private async handleMessage(msg: { type: string; payload?: unknown }): Promise<void> {
    switch (msg.type) {
      case 'refresh':
        this.postMessage('computing');
        await this.triggerRefresh();
        break;
      case 'runPlanSprint':
        await this.runner.runSkill('plan-sprint');
        break;
      case 'runRiskReview':
        await this.runner.runSkill('risk-review');
        break;
      case 'pushToAdo':
        void vscode.commands.executeCommand('claudeWorkflow.syncMultiSourceItems');
        break;
      case 'pushToTrello':
        void vscode.commands.executeCommand('claudeWorkflow.syncToTrello');
        break;
      case 'openFile': {
        const p = (msg.payload as { path?: string }).path;
        if (p) void vscode.commands.executeCommand('vscode.open', vscode.Uri.file(path.join(this.workspaceRoot, p)));
        break;
      }
    }
  }

  private postMessage(type: string, payload?: unknown): void {
    void this.panel?.webview.postMessage({ type, payload });
  }

  private buildWebviewState(state: PlanningState): PlannerWebviewState {
    const adoCfg    = vscode.workspace.getConfiguration('claudeWorkflow.azureDevOps');
    const trelloCfg = vscode.workspace.getConfiguration('claudeWorkflow.trello');
    return {
      computedAt:       state.computedAt.toISOString(),
      velocity:         state.velocity,
      backlog:          state.backlog,
      readiness:        state.readiness,
      sprintPlanExists: state.sprintPlanExists,
      sprintPlanAgeDays: state.sprintPlanAgeDays,
      adoConfigured:    !!(adoCfg.get<string>('organization') && adoCfg.get<string>('project')),
      trelloConfigured: !!(trelloCfg.get<string>('boardId') && trelloCfg.get<string>('backlogListId')),
    };
  }

  private getHtml(): string {
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Sprint Planner</title>
<style nonce="${nonce}">
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-editor-foreground);
  background: var(--vscode-editor-background);
  padding: 0;
}

.planner {
  max-width: 960px;
  margin: 0 auto;
  padding: 24px 20px;
}

.planner-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--vscode-panel-border);
}

h1 {
  font-size: 1.4em;
  font-weight: 600;
  color: #FF6B35;
  flex: 1;
}

.computed-time {
  color: var(--vscode-descriptionForeground);
  font-size: 0.85em;
}

.btn {
  padding: 6px 14px;
  border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85em;
  font-family: var(--vscode-font-family);
}

.btn-primary {
  background: #FF6B35;
  color: white;
  border-color: #FF6B35;
}

.btn-secondary {
  background: var(--vscode-button-secondaryBackground, var(--vscode-input-background));
  color: var(--vscode-button-secondaryForeground, var(--vscode-editor-foreground));
}

.btn:hover { opacity: 0.85; }
.btn:disabled { opacity: 0.5; cursor: default; }

/* Metric cards */
.metrics-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 16px;
  margin-bottom: 20px;
}

.metric-card {
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 8px;
  padding: 20px;
  text-align: center;
}

.metric-card h3 {
  font-size: 0.75em;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--vscode-descriptionForeground);
  margin-bottom: 12px;
}

/* Gauge */
.gauge-wrap { position: relative; width: 80px; height: 80px; margin: 0 auto 8px; }
.gauge-wrap svg { transform: rotate(-90deg); }
.gauge-bg { fill: none; stroke: var(--vscode-panel-border); stroke-width: 8; }
.gauge-fg { fill: none; stroke-width: 8; stroke-linecap: round; transition: stroke-dashoffset 0.5s; }
.gauge-text { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.gauge-score { font-size: 1.4em; font-weight: 700; }
.gauge-grade { font-size: 0.75em; color: var(--vscode-descriptionForeground); }
.gauge-green { stroke: #22C55E; }
.gauge-amber { stroke: #F59E0B; }
.gauge-red   { stroke: #EF4444; }
.text-green { color: #22C55E; }
.text-amber { color: #F59E0B; }
.text-red   { color: #EF4444; }

.metric-big { font-size: 2.2em; font-weight: 700; line-height: 1; }
.metric-unit { font-size: 0.85em; color: var(--vscode-descriptionForeground); margin: 4px 0; }
.metric-trend { font-size: 0.9em; font-weight: 600; }
.metric-sub { font-size: 0.8em; color: var(--vscode-descriptionForeground); margin-top: 4px; }
.metric-breakdown { font-size: 0.8em; color: var(--vscode-descriptionForeground); margin-top: 8px; line-height: 1.6; }

/* Readiness breakdown */
.readiness-rows { margin-top: 10px; text-align: left; }
.readiness-row { display: flex; justify-content: space-between; font-size: 0.8em; padding: 2px 0; }
.readiness-label { color: var(--vscode-descriptionForeground); }

/* Backlog card */
.card {
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 16px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.card-header h2 {
  font-size: 1em;
  font-weight: 600;
}

.priority-group { margin-bottom: 12px; }
.priority-label {
  font-size: 0.75em;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 6px;
  padding: 2px 8px;
  border-radius: 3px;
  display: inline-block;
}
.priority-label.critical { background: rgba(239,68,68,0.15); color: #EF4444; }
.priority-label.high     { background: rgba(245,158,11,0.15); color: #F59E0B; }
.priority-label.medium   { background: rgba(99,102,241,0.15); color: #818CF8; }
.priority-label.low      { background: rgba(100,116,139,0.1); color: var(--vscode-descriptionForeground); }

.backlog-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 6px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9em;
}
.backlog-row:hover { background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.04)); }

.backlog-row input[type=checkbox] { width: 14px; height: 14px; cursor: pointer; flex-shrink: 0; }

.id-pill {
  font-size: 0.75em;
  font-family: var(--vscode-editor-font-family, monospace);
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--vscode-badge-background, rgba(255,107,53,0.15));
  color: var(--vscode-badge-foreground, #FF6B35);
  white-space: nowrap;
  flex-shrink: 0;
}

.item-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.source-badge {
  font-size: 0.7em;
  padding: 1px 6px;
  border-radius: 3px;
  white-space: nowrap;
  flex-shrink: 0;
}
.badge-tech-debt { background: rgba(99,102,241,0.15); color: #818CF8; }
.badge-dod       { background: rgba(239,68,68,0.15);  color: #EF4444; }
.badge-api       { background: rgba(245,158,11,0.15); color: #F59E0B; }
.badge-review    { background: rgba(34,197,94,0.12);  color: #4ADE80; }

.risk-wrap { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.risk-bar-bg { width: 48px; height: 4px; background: var(--vscode-panel-border); border-radius: 2px; }
.risk-bar-fg { height: 4px; border-radius: 2px; background: #FF6B35; }
.risk-val { font-size: 0.75em; color: var(--vscode-descriptionForeground); width: 24px; text-align: right; }

/* Sprint plan card */
#sprint-plan-card { display: none; }

.selected-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid var(--vscode-panel-border);
  font-size: 0.9em;
}
.selected-item:last-child { border-bottom: none; }
.rank { color: var(--vscode-descriptionForeground); width: 20px; flex-shrink: 0; }

.capacity-bar {
  margin: 12px 0;
  height: 6px;
  background: var(--vscode-panel-border);
  border-radius: 3px;
  overflow: hidden;
}
.capacity-fill { height: 100%; border-radius: 3px; background: #FF6B35; transition: width 0.3s; }
.capacity-label { font-size: 0.8em; color: var(--vscode-descriptionForeground); margin-bottom: 8px; }

.action-row { display: flex; gap: 10px; margin-top: 16px; flex-wrap: wrap; }

/* Footer */
.footer-bar {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--vscode-panel-border);
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 0.85em;
  color: var(--vscode-descriptionForeground);
}
.footer-bar a { color: #FF6B35; cursor: pointer; text-decoration: none; }
.footer-bar a:hover { text-decoration: underline; }

.empty-state { text-align: center; padding: 32px; color: var(--vscode-descriptionForeground); }
.spinner { animation: spin 1s linear infinite; display: inline-block; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<div class="planner">
  <div class="planner-header">
    <h1>&#128197; Sprint Planner</h1>
    <span class="computed-time" id="computed-time"></span>
    <button class="btn btn-secondary" id="btn-refresh">&#8634; Refresh</button>
  </div>

  <div id="loading-state" class="empty-state" style="display:none">
    <div class="spinner">&#10227;</div>&nbsp; Computing&hellip;
  </div>

  <div id="main-content" style="display:none">
    <div class="metrics-row">
      <!-- Release Readiness -->
      <div class="metric-card">
        <h3>Release Readiness</h3>
        <div class="gauge-wrap">
          <svg width="80" height="80" viewBox="0 0 80 80">
            <circle class="gauge-bg" cx="40" cy="40" r="32"/>
            <circle class="gauge-fg" id="gauge-fg" cx="40" cy="40" r="32"
              stroke-dasharray="201" stroke-dashoffset="201"/>
          </svg>
          <div class="gauge-text">
            <span class="gauge-score" id="readiness-score">0</span>
            <span class="gauge-grade" id="readiness-grade">F</span>
          </div>
        </div>
        <div class="readiness-rows">
          <div class="readiness-row"><span class="readiness-label">Definition of Done</span><span id="dod-score">0/25</span></div>
          <div class="readiness-row"><span class="readiness-label">API Coverage</span><span id="api-score">0/25</span></div>
          <div class="readiness-row"><span class="readiness-label">Tech Debt</span><span id="debt-score">0/25</span></div>
          <div class="readiness-row"><span class="readiness-label">UAT Currency</span><span id="uat-score">0/25</span></div>
        </div>
      </div>

      <!-- Velocity -->
      <div class="metric-card">
        <h3>Velocity</h3>
        <div class="metric-big" id="velocity-num">&mdash;</div>
        <div class="metric-unit">entries / week</div>
        <div class="metric-trend" id="velocity-trend"></div>
        <div class="metric-sub" id="velocity-cap"></div>
        <div class="metric-breakdown" id="velocity-breakdown"></div>
      </div>

      <!-- Backlog -->
      <div class="metric-card">
        <h3>Open Backlog</h3>
        <div class="metric-big" id="backlog-total">&mdash;</div>
        <div class="metric-unit">open items</div>
        <div class="metric-breakdown" id="backlog-breakdown"></div>
      </div>
    </div>

    <!-- Prioritised Backlog -->
    <div class="card">
      <div class="card-header">
        <h2>Prioritised Backlog</h2>
        <button class="btn btn-secondary" id="btn-select-critical">Select Critical + High</button>
      </div>
      <div id="backlog-list"></div>
    </div>

    <!-- Sprint Plan -->
    <div class="card" id="sprint-plan-card">
      <div class="card-header">
        <h2>Sprint Plan</h2>
        <span id="capacity-status" class="metric-unit"></span>
      </div>
      <div class="capacity-bar"><div class="capacity-fill" id="capacity-fill" style="width:0%"></div></div>
      <p class="capacity-label" id="capacity-label"></p>
      <div id="selected-list"></div>
      <div class="action-row">
        <button class="btn btn-primary" id="btn-plan">&#9889; Generate AI Sprint Plan</button>
        <button class="btn btn-secondary" id="btn-ado" style="display:none">&rarr; Azure DevOps</button>
        <button class="btn btn-secondary" id="btn-trello" style="display:none">&rarr; Trello</button>
      </div>
    </div>
  </div>

  <div class="footer-bar">
    <span id="dod-footer">No DoD run yet</span>
    <a id="dod-run-link">Run Done Check &rarr;</a>
  </div>
</div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
let state = null;
const selected = new Set();

window.addEventListener('message', e => {
  const { type, payload } = e.data;
  if (type === 'stateUpdate') { renderState(payload); }
  if (type === 'computing')   { showLoading(true); }
  if (type === 'error')       { showError(payload && payload.message); }
});

function showLoading(on) {
  document.getElementById('loading-state').style.display = on ? 'block' : 'none';
  document.getElementById('main-content').style.display  = on ? 'none'  : 'block';
}

function showError(msg) {
  showLoading(false);
  const el = document.getElementById('loading-state');
  el.style.display = 'block';
  el.textContent = 'Error: ' + (msg || 'Failed to compute planning state');
  document.getElementById('main-content').style.display = 'none';
}

function relTime(isoStr) {
  const d = new Date(isoStr);
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  return Math.floor(mins/60) + 'h ago';
}

function renderState(s) {
  state = s;
  showLoading(false);

  // Header
  document.getElementById('computed-time').textContent = 'Last computed: ' + relTime(s.computedAt);

  // Readiness gauge
  const score = s.readiness.score;
  const circumference = 2 * Math.PI * 32; // 201.06
  const offset = circumference - (score / 100) * circumference;
  const gaugeFg = document.getElementById('gauge-fg');
  gaugeFg.style.strokeDashoffset = offset.toString();
  const colClass = s.readiness.colour === 'green' ? 'gauge-green' : s.readiness.colour === 'amber' ? 'gauge-amber' : 'gauge-red';
  gaugeFg.className = 'gauge-fg ' + colClass;
  document.getElementById('readiness-score').textContent = score.toString();
  const gradeEl = document.getElementById('readiness-grade');
  gradeEl.textContent = 'Grade ' + s.readiness.grade;
  gradeEl.className = 'gauge-grade text-' + s.readiness.colour;

  const bd = s.readiness.breakdown;
  document.getElementById('dod-score').textContent  = bd.dodScore  + '/25';
  document.getElementById('api-score').textContent  = bd.apiScore  + '/25';
  document.getElementById('debt-score').textContent = bd.debtScore + '/25';
  document.getElementById('uat-score').textContent  = bd.uatScore  + '/25';

  // Velocity
  const v = s.velocity;
  document.getElementById('velocity-num').textContent = v.fourWeekAverage.toFixed(1);
  const trendArrow = v.trend === 'up' ? '\u2191' : v.trend === 'down' ? '\u2193' : '\u2192';
  const trendColour = v.trend === 'up' ? '#22C55E' : v.trend === 'down' ? '#EF4444' : '';
  const trendEl = document.getElementById('velocity-trend');
  trendEl.textContent = v.trendPercent > 0 ? (trendArrow + ' ' + v.trendPercent + '%') : '';
  trendEl.style.color = trendColour;
  document.getElementById('velocity-cap').textContent = '~' + v.sprintCapacity + ' items capacity / sprint';

  // Top type breakdown
  const topTypes = Object.entries(v.typeBreakdown).sort((a,b) => b[1]-a[1]).slice(0,3);
  document.getElementById('velocity-breakdown').textContent = topTypes.map(([k,n]) => k + ': ' + n).join(' \u00b7 ');

  // Backlog summary
  const total = s.backlog.length;
  const byCrit = s.backlog.filter(i => i.priority === 'Critical').length;
  const bySource = {};
  for (const i of s.backlog) bySource[i.source] = (bySource[i.source] || 0) + 1;
  document.getElementById('backlog-total').textContent = total.toString();
  const sourceLabels = { 'tech-debt': 'Tech Debt', 'dod': 'DoD', 'api': 'API', 'review': 'PIR' };
  document.getElementById('backlog-breakdown').innerHTML =
    Object.entries(bySource).map(([k,n]) => (sourceLabels[k]||k) + ': ' + n).join(' \u00b7 ') +
    (byCrit > 0 ? '<br><span style="color:#EF4444;font-weight:600">' + byCrit + ' critical</span>' : '');

  // Backlog list
  renderBacklog(s.backlog);

  // ADO/Trello buttons
  document.getElementById('btn-ado').style.display    = s.adoConfigured    ? '' : 'none';
  document.getElementById('btn-trello').style.display = s.trelloConfigured ? '' : 'none';

  // DoD footer
  const dodVerdict = s.readiness.lastDodVerdict;
  const dodAge = s.readiness.lastDodAgeHours;
  if (dodVerdict === 'unknown') {
    document.getElementById('dod-footer').textContent = 'No DoD run yet';
  } else {
    const ageStr = dodAge < 1 ? 'just now' : dodAge < 24 ? Math.round(dodAge) + 'h ago' : Math.floor(dodAge/24) + 'd ago';
    document.getElementById('dod-footer').textContent =
      'Last DoD: ' + dodVerdict + ' \u00b7 ' + ageStr;
    document.getElementById('dod-footer').style.color = dodVerdict === 'COMPLETE' ? '#22C55E' : '#EF4444';
  }
}

function renderBacklog(items) {
  const container = document.getElementById('backlog-list');
  const groups = { Critical: [], High: [], Medium: [], Low: [] };
  for (const item of items) {
    (groups[item.priority] || groups.Low).push(item);
  }

  let html = '';
  for (const [priority, group] of Object.entries(groups)) {
    if (!group.length) continue;
    html += '<div class="priority-group">';
    html += '<div class="priority-label ' + priority.toLowerCase() + '">' + priority + '</div>';
    for (const item of group) {
      const checked = selected.has(item.id) ? 'checked' : '';
      const risk10 = Math.min(10, item.riskScore);
      const riskPct = Math.round(risk10 / 10 * 100);
      const sourceBadgeClass = {
        'tech-debt': 'badge-tech-debt', 'dod': 'badge-dod',
        'api': 'badge-api', 'review': 'badge-review'
      }[item.source] || '';
      const sourceLabel = { 'tech-debt': 'Tech Debt', 'dod': 'DoD', 'api': 'API', 'review': 'PIR' }[item.source] || item.source;
      html += '<div class="backlog-row" onclick="toggleItem(\'' + esc(item.id) + '\', event)">' +
        '<input type="checkbox" class="item-check" data-id="' + esc(item.id) + '" ' + checked + ' onclick="event.stopPropagation(); toggleItem(\'' + esc(item.id) + '\', event)">' +
        '<span class="id-pill">' + esc(item.id) + '</span>' +
        '<span class="item-title" title="' + esc(item.title) + '">' + esc(item.title) + '</span>' +
        '<span class="source-badge ' + sourceBadgeClass + '">' + sourceLabel + '</span>' +
        '<span class="risk-wrap">' +
          '<span class="risk-bar-bg"><span class="risk-bar-fg" style="width:' + riskPct + '%"></span></span>' +
          '<span class="risk-val">' + risk10.toFixed(1) + '</span>' +
        '</span>' +
        '</div>';
    }
    html += '</div>';
  }
  if (!html) html = '<div class="empty-state">\u2713 No open backlog items found</div>';
  container.innerHTML = html;
}

function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function toggleItem(id, event) {
  if (event && event.target && event.target.type === 'checkbox') {
    if (event.target.checked) selected.add(id);
    else selected.delete(id);
  } else {
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
  }
  // Sync checkboxes
  document.querySelectorAll('.item-check').forEach(cb => {
    cb.checked = selected.has(cb.dataset.id);
  });
  updateSprintPlan();
}

function updateSprintPlan() {
  const card = document.getElementById('sprint-plan-card');
  if (selected.size === 0) { card.style.display = 'none'; return; }
  card.style.display = '';

  const capacity = state ? state.velocity.sprintCapacity : 0;
  const pct = capacity > 0 ? Math.min(100, Math.round(selected.size / capacity * 100)) : 0;
  document.getElementById('capacity-fill').style.width = pct + '%';
  document.getElementById('capacity-label').textContent =
    'Selected ' + selected.size + ' items (sprint capacity ~' + capacity + ')';

  // Render selected items sorted by risk
  const selItems = (state ? state.backlog : [])
    .filter(i => selected.has(i.id))
    .sort((a,b) => b.riskScore - a.riskScore);

  let html = '';
  selItems.forEach((item, idx) => {
    html += '<div class="selected-item">' +
      '<span class="rank">' + (idx + 1) + '.</span>' +
      '<span class="id-pill">' + esc(item.id) + '</span>' +
      '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(item.title) + '</span>' +
      '<span style="font-size:0.75em;color:var(--vscode-descriptionForeground)">' + item.priority + '</span>' +
      '</div>';
  });
  document.getElementById('selected-list').innerHTML = html;
}

document.getElementById('btn-refresh').addEventListener('click', () => {
  vscode.postMessage({ type: 'refresh' });
});

document.getElementById('btn-select-critical').addEventListener('click', () => {
  if (!state) return;
  for (const item of state.backlog) {
    if (item.priority === 'Critical' || item.priority === 'High') selected.add(item.id);
  }
  document.querySelectorAll('.item-check').forEach(cb => {
    cb.checked = selected.has(cb.dataset.id);
  });
  updateSprintPlan();
});

document.getElementById('btn-plan').addEventListener('click', () => {
  vscode.postMessage({ type: 'runPlanSprint' });
});

document.getElementById('btn-ado').addEventListener('click', () => {
  vscode.postMessage({ type: 'pushToAdo', payload: { itemIds: Array.from(selected) } });
});

document.getElementById('btn-trello').addEventListener('click', () => {
  vscode.postMessage({ type: 'pushToTrello', payload: { itemIds: Array.from(selected) } });
});

document.getElementById('dod-run-link').addEventListener('click', () => {
  vscode.postMessage({ type: 'openFile', payload: { path: '.claude/dod-result.md' } });
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
