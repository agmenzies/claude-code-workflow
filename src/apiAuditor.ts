/**
 * apiAuditor.ts
 *
 * Two-tier API analysis:
 *  1. Quick scan  — pure regex, runs on every route-file save. Finds routes and
 *     compares them against Swagger paths. Produces coverage diagnostics with no
 *     network or AI calls.
 *  2. Deep audit  — reads `.claude/api-audit.json` written by the `/audit-api`
 *     Claude skill. Produces auth/rate-limit/validation diagnostics. The JSON
 *     file is the contract between Claude and the extension.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// ── Types ────────────────────────────────────────────────────────────────────

export type AuditSeverity = 'error' | 'warning' | 'info';

export type AuditRule =
  | 'missing-auth'
  | 'missing-rate-limit'
  | 'missing-validation'
  | 'missing-swagger'
  | 'no-error-handler'
  | 'inconsistent-response';

export interface ApiIssue {
  file: string;       // relative to workspace root
  line: number;       // 1-based
  method: string;     // GET, POST, etc.
  path: string;       // e.g. /api/users/:id
  rule: AuditRule;
  severity: AuditSeverity;
  message: string;
}

export interface AuditResult {
  auditedAt: string;
  issues: ApiIssue[];
  summary: AuditSummary;
}

export interface AuditSummary {
  totalRoutes: number;
  documented: number;
  withAuth: number;
  withRateLimit: number;
}

export interface RouteRef {
  file: string;       // absolute path
  line: number;       // 1-based
  method: string;
  routePath: string;
}

// ── Regex patterns ────────────────────────────────────────────────────────────

// Matches: router.get('/path', ...) | app.post('/path', ...) | Router().delete('/path', ...)
const ROUTE_RE =
  /(?:^|[^.\w])(?:router|app|Router\(\))\s*\.\s*(get|post|put|patch|delete|all)\s*\(\s*['"`]([^'"`]+)['"`]/gim;

// Swagger YAML: lines under `paths:` that start with exactly 2-space indent + /
const SWAGGER_PATH_YAML_RE = /^  (\/[^\s:]+)\s*:/gm;

// Swagger JSON path keys
const SWAGGER_PATH_JSON_RE = /"(\/[^"]+)"\s*:/g;

// ── Quick scan ────────────────────────────────────────────────────────────────

/**
 * Find all route handlers in the workspace using regex.
 */
export async function findRoutes(workspaceRoot: string): Promise<RouteRef[]> {
  const config = vscode.workspace.getConfiguration('claudeWorkflow');
  const globs = config.get<string[]>('routeGlobs', [
    'server/routes/**/*.ts',
    'src/routes/**/*.ts',
    'routes/**/*.ts',
    'app/routes/**/*.ts',
    'server/routes/**/*.js',
  ]);

  const refs: RouteRef[] = [];

  for (const pattern of globs) {
    const uris = await vscode.workspace.findFiles(
      new vscode.RelativePattern(workspaceRoot, pattern),
      '**/node_modules/**'
    );

    for (const uri of uris) {
      const content = fs.readFileSync(uri.fsPath, 'utf8');
      const lines = content.split('\n');

      let match: RegExpExecArray | null;
      ROUTE_RE.lastIndex = 0;

      while ((match = ROUTE_RE.exec(content)) !== null) {
        const charIndex = match.index;
        let lineNum = 0;
        let accumulated = 0;
        for (let i = 0; i < lines.length; i++) {
          accumulated += lines[i].length + 1; // +1 for newline
          if (accumulated > charIndex) {
            lineNum = i + 1;
            break;
          }
        }
        refs.push({
          file: uri.fsPath,
          line: lineNum,
          method: match[1].toUpperCase(),
          routePath: match[2],
        });
      }
    }
  }

  return refs;
}

/**
 * Extract documented paths from all Swagger / OpenAPI files.
 */
export async function findSwaggerPaths(workspaceRoot: string): Promise<Set<string>> {
  const config = vscode.workspace.getConfiguration('claudeWorkflow');
  const globs = config.get<string[]>('swaggerGlobs', [
    'server/swagger/**/*.yaml',
    'server/swagger/**/*.yml',
    'server/swagger/**/*.json',
    'swagger/**/*.yaml',
    'swagger/**/*.yml',
    'openapi/**/*.yaml',
    'docs/api/**/*.yaml',
  ]);

  const documented = new Set<string>();

  for (const pattern of globs) {
    const uris = await vscode.workspace.findFiles(
      new vscode.RelativePattern(workspaceRoot, pattern),
      '**/node_modules/**'
    );

    for (const uri of uris) {
      const content = fs.readFileSync(uri.fsPath, 'utf8');
      const isJson = uri.fsPath.endsWith('.json');

      const re = isJson ? SWAGGER_PATH_JSON_RE : SWAGGER_PATH_YAML_RE;
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        documented.add(normaliseSwaggerPath(m[1]));
      }
    }
  }

  return documented;
}

/**
 * Quick coverage scan — no AI needed.
 * Returns issues only for routes without Swagger documentation.
 */
export async function quickCoverageScan(
  workspaceRoot: string
): Promise<ApiIssue[]> {
  const [routes, swaggerPaths] = await Promise.all([
    findRoutes(workspaceRoot),
    findSwaggerPaths(workspaceRoot),
  ]);

  const config = vscode.workspace.getConfiguration('claudeWorkflow');
  const publicPrefixes = config.get<string[]>('publicRoutePrefixes', [
    '/health',
    '/api/health',
    '/api/public',
    '/api/auth/login',
    '/api/auth/register',
  ]);

  const issues: ApiIssue[] = [];

  for (const route of routes) {
    const normalised = normaliseRoutePath(route.routePath);
    const isPublic = publicPrefixes.some(p => route.routePath.startsWith(p));

    if (!swaggerPaths.has(normalised) && swaggerPaths.size > 0) {
      issues.push({
        file: path.relative(workspaceRoot, route.file),
        line: route.line,
        method: route.method,
        path: route.routePath,
        rule: 'missing-swagger',
        severity: isPublic ? 'info' : 'warning',
        message: `${route.method} ${route.routePath} has no Swagger documentation`,
      });
    }
  }

  return issues;
}

// ── Deep audit (Claude-written results) ──────────────────────────────────────

export function loadDeepAuditResults(workspaceRoot: string): AuditResult | null {
  const auditPath = path.join(workspaceRoot, '.claude', 'api-audit.json');
  if (!fs.existsSync(auditPath)) return null;

  try {
    const raw = fs.readFileSync(auditPath, 'utf8');
    return JSON.parse(raw) as AuditResult;
  } catch {
    return null;
  }
}

export function getAuditSummary(workspaceRoot: string): AuditSummary | null {
  return loadDeepAuditResults(workspaceRoot)?.summary ?? null;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Normalise Express-style route params (:id) to OpenAPI style ({id})
 * so they can be compared against swagger paths.
 */
function normaliseSwaggerPath(p: string): string {
  return p.replace(/\{[^}]+\}/g, ':param');
}

function normaliseRoutePath(p: string): string {
  return p.replace(/:[^/]+/g, ':param');
}

export function auditResultAge(workspaceRoot: string): number | null {
  const auditPath = path.join(workspaceRoot, '.claude', 'api-audit.json');
  if (!fs.existsSync(auditPath)) return null;
  try {
    const stat = fs.statSync(auditPath);
    return Date.now() - stat.mtime.getTime();
  } catch {
    return null;
  }
}
