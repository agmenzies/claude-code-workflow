/**
 * planningEngine.ts
 *
 * Computes forward-looking planning state from project living docs.
 * Reads instruction-history.toon for velocity, aggregates open backlog
 * items from four sources, and scores release readiness.
 * Non-blocking: yields event loop before heavy I/O via setImmediate.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
  parseDebtFile,
  parseDoDFile,
  parseApiAuditFile,
  parsePostReviewFile,
} from './workItemSync';

// ── Types ────────────────────────────────────────────────────────────────────

export interface WeeklyBucket {
  weekLabel: string;   // e.g. "W13 2026"
  isoWeek: string;     // e.g. "2026-W13"
  count: number;
}

export interface VelocityData {
  fourWeekAverage: number;
  priorFourWeekAverage: number;
  trend: 'up' | 'down' | 'flat';
  trendPercent: number;
  trendDirection: 1 | -1 | 0;
  typeBreakdown: Record<string, number>;
  sprintCapacity: number;
  weeklyData: WeeklyBucket[];
}

export type BacklogSource   = 'tech-debt' | 'dod' | 'api' | 'review';
export type BacklogPriority = 'Critical' | 'High' | 'Medium' | 'Low';

export interface BacklogItem {
  id: string;
  title: string;
  priority: BacklogPriority;
  source: BacklogSource;
  riskScore: number;
  description: string;
  ageDays: number;
}

export interface ReadinessBreakdown {
  dodScore:  number;
  apiScore:  number;
  debtScore: number;
  uatScore:  number;
}

export interface ReleaseReadiness {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  colour: 'green' | 'amber' | 'red';
  breakdown: ReadinessBreakdown;
  lastDodVerdict: 'COMPLETE' | 'INCOMPLETE' | 'unknown';
  lastDodAgeHours: number;
}

export interface PlanningState {
  computedAt: Date;
  velocity: VelocityData;
  backlog: BacklogItem[];
  readiness: ReleaseReadiness;
  sprintPlanExists: boolean;
  sprintPlanAgeDays: number;
}

// ── ISO week helper ──────────────────────────────────────────────────────────

function getISOWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

function isoWeekKey(date: Date): string {
  const { year, week } = getISOWeek(date);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function isoWeekLabel(key: string): string {
  const [year, wPart] = key.split('-W');
  return `W${wPart} ${year}`;
}

function addWeeks(date: Date, n: number): Date {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + n * 7);
  return d;
}

function getLastNISOWeekKeys(n: number): string[] {
  const now = new Date();
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    keys.push(isoWeekKey(addWeeks(now, -i)));
  }
  return keys;
}

// ── Velocity computation ─────────────────────────────────────────────────────

interface HistoryEntry {
  date: string;
  category: string;
}

function parseHistoryEntries(filePath: string): HistoryEntry[] {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  // Split on entry boundaries: lines that are exactly "  -"
  const blocks = content.split(/\n  -(?:\s*)$/m);
  const entries: HistoryEntry[] = [];
  for (const block of blocks) {
    const dateMatch     = block.match(/^\s+date:\s*(\d{4}-\d{2}-\d{2})/m);
    const categoryMatch = block.match(/^\s+category:\s*(.+)/m);
    if (dateMatch) {
      entries.push({
        date:     dateMatch[1].trim(),
        category: categoryMatch ? categoryMatch[1].trim() : 'Unknown',
      });
    }
  }
  return entries;
}

function computeVelocity(entries: HistoryEntry[]): VelocityData {
  // Build 12-week history (need 8 to display + 4 prior for comparison)
  const last12Keys = getLastNISOWeekKeys(12);
  const counts     = new Map<string, number>();
  const typeMap    = new Map<string, Map<string, number>>();

  for (const key of last12Keys) {
    counts.set(key, 0);
    typeMap.set(key, new Map());
  }

  const last12Set = new Set(last12Keys);

  for (const entry of entries) {
    try {
      const d   = new Date(`${entry.date}T12:00:00Z`);
      const key = isoWeekKey(d);
      if (!last12Set.has(key)) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      const tm = typeMap.get(key)!;
      tm.set(entry.category, (tm.get(entry.category) ?? 0) + 1);
    } catch { /* skip malformed dates */ }
  }

  // weeklyData = last 8 weeks (oldest first)
  const displayKeys  = last12Keys.slice(4);   // weeks [4..11] = last 8
  const priorKeys    = last12Keys.slice(0, 4); // weeks [0..3] = prior 4

  const weeklyData: WeeklyBucket[] = displayKeys.map(key => ({
    weekLabel: isoWeekLabel(key),
    isoWeek:   key,
    count:     counts.get(key) ?? 0,
  }));

  const currentCounts = displayKeys.slice(4).map(k => counts.get(k) ?? 0); // last 4 of display
  const priorCounts   = priorKeys.map(k => counts.get(k) ?? 0);

  const sum   = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
  const avg   = (arr: number[]) => arr.length === 0 ? 0 : sum(arr) / arr.length;

  const fourWeekAverage      = Math.round(avg(currentCounts) * 10) / 10;
  const priorFourWeekAverage = Math.round(avg(priorCounts)   * 10) / 10;

  const delta    = fourWeekAverage - priorFourWeekAverage;
  const baseline = Math.max(priorFourWeekAverage, 1);
  const pct      = Math.abs(Math.round((delta / baseline) * 100));
  const trend: VelocityData['trend'] =
    pct < 5 ? 'flat' : delta > 0 ? 'up' : 'down';

  // typeBreakdown over last 8 display weeks
  const typeBreakdown: Record<string, number> = {};
  for (const key of displayKeys) {
    const tm = typeMap.get(key);
    if (!tm) continue;
    for (const [cat, n] of tm.entries()) {
      typeBreakdown[cat] = (typeBreakdown[cat] ?? 0) + n;
    }
  }

  return {
    fourWeekAverage,
    priorFourWeekAverage,
    trend,
    trendPercent:    pct,
    trendDirection:  trend === 'up' ? 1 : trend === 'down' ? -1 : 0,
    typeBreakdown,
    sprintCapacity:  Math.max(1, Math.round(fourWeekAverage * 2)),
    weeklyData,
  };
}

// ── Release readiness ────────────────────────────────────────────────────────

function fileAgeDays(filePath: string): number {
  try {
    const mtime = fs.statSync(filePath).mtime;
    return Math.floor((Date.now() - mtime.getTime()) / 86400000);
  } catch { return 9999; }
}

function fileAgeHours(filePath: string): number {
  try {
    const mtime = fs.statSync(filePath).mtime;
    return (Date.now() - mtime.getTime()) / 3600000;
  } catch { return 9999; }
}

function computeReadiness(workspaceRoot: string): ReleaseReadiness {
  // DoD score
  const dodPath   = path.join(workspaceRoot, '.claude', 'dod-result.md');
  let dodScore    = 0;
  let lastDodVerdict: ReleaseReadiness['lastDodVerdict'] = 'unknown';
  let lastDodAgeHours = -1;
  if (fs.existsSync(dodPath)) {
    const content = fs.readFileSync(dodPath, 'utf8');
    lastDodAgeHours = fileAgeHours(dodPath);
    if (/COMPLETE\b/.test(content) && !/INCOMPLETE/.test(content)) {
      lastDodVerdict = 'COMPLETE';
      dodScore = lastDodAgeHours < 24 ? 25 : 12;
    } else if (/INCOMPLETE/.test(content)) {
      lastDodVerdict = 'INCOMPLETE';
      dodScore = 0;
    }
  }

  // API score
  let apiScore = 0;
  const auditPath = path.join(workspaceRoot, '.claude', 'api-audit.json');
  if (fs.existsSync(auditPath)) {
    try {
      const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8')) as {
        summary?: { totalRoutes?: number; documented?: number; withAuth?: number; withRateLimit?: number };
      };
      const s     = audit.summary ?? {};
      const total = Math.max(s.totalRoutes ?? 0, 1);
      const authP = (s.withAuth ?? 0)    / total;
      const docP  = (s.documented ?? 0)  / total;
      const rlP   = (s.withRateLimit ?? 0) / total;
      apiScore = Math.round((authP * 0.4 + docP * 0.4 + rlP * 0.2) * 25);
    } catch { /* leave 0 */ }
  }

  // Debt score
  let debtScore = 25;
  const debtEntries = parseDebtFile(workspaceRoot);
  const openEntries = debtEntries.filter(e => !e.status.toLowerCase().includes('resolved'));
  const criticalOpen = openEntries.filter(e => e.priority.toLowerCase() === 'critical').length;
  const highOpen     = openEntries.filter(e => e.priority.toLowerCase() === 'high').length;
  debtScore = Math.max(0, 25 - criticalOpen * 5 - highOpen * 2);

  // UAT score
  let uatScore = 0;
  const uatPaths  = ['UAT.md', 'uat.md', 'docs/UAT.md', 'acceptance-tests.md'];
  let uatDays     = 9999;
  for (const p of uatPaths) {
    const full = path.join(workspaceRoot, p);
    if (fs.existsSync(full)) {
      uatDays = fileAgeDays(full);
      break;
    }
  }
  if (uatDays <= 7)        uatScore = 25;
  else if (uatDays <= 30)  uatScore = 15;
  else if (uatDays <= 90)  uatScore = 5;

  const score = dodScore + apiScore + debtScore + uatScore;
  const grade: ReleaseReadiness['grade'] =
    score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 50 ? 'C' : score >= 25 ? 'D' : 'F';
  const colour: ReleaseReadiness['colour'] =
    score >= 70 ? 'green' : score >= 40 ? 'amber' : 'red';

  return {
    score, grade, colour,
    breakdown: { dodScore, apiScore, debtScore, uatScore },
    lastDodVerdict,
    lastDodAgeHours,
  };
}

// ── Backlog aggregation ──────────────────────────────────────────────────────

const PRIORITY_WEIGHT: Record<string, number> = {
  critical: 4, high: 3, medium: 2, low: 1,
};
const SOURCE_WEIGHT: Record<BacklogSource, number> = {
  dod: 1.5, api: 1.4, 'tech-debt': 1.2, review: 1.0,
};

function priorityNorm(raw: string): BacklogPriority {
  const s = raw.toLowerCase();
  if (s === 'critical') return 'Critical';
  if (s === 'high')     return 'High';
  if (s === 'medium')   return 'Medium';
  return 'Low';
}

function riskScore(priority: BacklogPriority, source: BacklogSource, ageDays: number): number {
  const pw  = PRIORITY_WEIGHT[priority.toLowerCase()] ?? 1;
  const sw  = SOURCE_WEIGHT[source];
  const age = Math.max(ageDays / 30, 0.1);
  return Math.min(10, Math.round(pw * sw * age * 10) / 10);
}

function sourceFileMtime(workspaceRoot: string, source: BacklogSource): number {
  const paths: Record<BacklogSource, string> = {
    'tech-debt': 'tech-debt.md',
    dod:         '.claude/dod-result.md',
    api:         '.claude/api-audit.json',
    review:      'post-reviews.md',
  };
  return fileAgeDays(path.join(workspaceRoot, paths[source]));
}

function aggregateBacklog(workspaceRoot: string): BacklogItem[] {
  const items: BacklogItem[] = [];

  // Tech debt
  const debtAge = sourceFileMtime(workspaceRoot, 'tech-debt');
  for (const e of parseDebtFile(workspaceRoot)) {
    if (e.status.toLowerCase().includes('resolved')) continue;
    const priority = priorityNorm(e.priority);
    items.push({
      id: e.id, title: e.title, priority, source: 'tech-debt',
      riskScore: riskScore(priority, 'tech-debt', debtAge),
      description: e.description.slice(0, 200),
      ageDays: debtAge,
    });
  }

  // DoD failures
  const dodAge = sourceFileMtime(workspaceRoot, 'dod');
  parseDoDFile(workspaceRoot).forEach((title, i) => {
    items.push({
      id: `DOD-${String(i + 1).padStart(3, '0')}`, title, priority: 'High', source: 'dod',
      riskScore: riskScore('High', 'dod', dodAge),
      description: title, ageDays: dodAge,
    });
  });

  // API issues
  const apiAge = sourceFileMtime(workspaceRoot, 'api');
  parseApiAuditFile(workspaceRoot).forEach((issue, i) => {
    const priority = issue.severity === 'critical' ? 'Critical' : 'High';
    items.push({
      id: `API-${String(i + 1).padStart(3, '0')}`,
      title: `${issue.method} ${issue.apiPath}: ${issue.rule}`,
      priority, source: 'api',
      riskScore: riskScore(priority, 'api', apiAge),
      description: issue.message, ageDays: apiAge,
    });
  });

  // Post-review actions
  const reviewAge = sourceFileMtime(workspaceRoot, 'review');
  parsePostReviewFile(workspaceRoot).forEach((title, i) => {
    items.push({
      id: `PIR-${String(i + 1).padStart(3, '0')}`, title, priority: 'Medium', source: 'review',
      riskScore: riskScore('Medium', 'review', reviewAge),
      description: title, ageDays: reviewAge,
    });
  });

  // Sort by risk score descending
  return items.sort((a, b) => b.riskScore - a.riskScore);
}

// ── PlanningEngine ────────────────────────────────────────────────────────────

export class PlanningEngine implements vscode.Disposable {
  private state: PlanningState | null = null;
  private computing = false;
  private readonly _onDidChange = new vscode.EventEmitter<PlanningState>();
  readonly onDidChange = this._onDidChange.event;
  private readonly watchers: vscode.FileSystemWatcher[] = [];

  constructor(private readonly workspaceRoot: string) {
    const watchFiles = [
      'tech-debt.md',
      '.claude/dod-result.md',
      '.claude/api-audit.json',
      'post-reviews.md',
      'instruction-history.toon',
    ];
    for (const rel of watchFiles) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(workspaceRoot, rel)
      );
      const recompute = () => { void this.compute(); };
      watcher.onDidChange(recompute);
      watcher.onDidCreate(recompute);
      watcher.onDidDelete(recompute);
      this.watchers.push(watcher);
    }
  }

  async compute(): Promise<PlanningState> {
    if (this.computing) return this.state ?? this.emptyState();
    this.computing = true;

    // Yield event loop before heavy synchronous I/O
    await new Promise<void>(resolve => setImmediate(resolve));

    try {
      const historyPath = path.join(this.workspaceRoot, 'instruction-history.toon');
      const entries     = parseHistoryEntries(historyPath);
      const velocity    = computeVelocity(entries);
      const readiness   = computeReadiness(this.workspaceRoot);
      const backlog     = aggregateBacklog(this.workspaceRoot);

      const sprintPlanPath = path.join(this.workspaceRoot, '.claude', 'sprint-plan.md');
      const sprintPlanExists = fs.existsSync(sprintPlanPath);
      const sprintPlanAgeDays = sprintPlanExists ? fileAgeDays(sprintPlanPath) : -1;

      this.state = { computedAt: new Date(), velocity, readiness, backlog, sprintPlanExists, sprintPlanAgeDays };
      this._onDidChange.fire(this.state);
      return this.state;
    } finally {
      this.computing = false;
    }
  }

  getState(): PlanningState | null { return this.state; }
  isComputing(): boolean { return this.computing; }

  private emptyState(): PlanningState {
    return {
      computedAt: new Date(),
      velocity: {
        fourWeekAverage: 0, priorFourWeekAverage: 0,
        trend: 'flat', trendPercent: 0, trendDirection: 0,
        typeBreakdown: {}, sprintCapacity: 0, weeklyData: [],
      },
      backlog: [],
      readiness: {
        score: 0, grade: 'F', colour: 'red',
        breakdown: { dodScore: 0, apiScore: 0, debtScore: 0, uatScore: 0 },
        lastDodVerdict: 'unknown', lastDodAgeHours: -1,
      },
      sprintPlanExists: false, sprintPlanAgeDays: -1,
    };
  }

  dispose(): void {
    this._onDidChange.dispose();
    for (const w of this.watchers) w.dispose();
  }
}
