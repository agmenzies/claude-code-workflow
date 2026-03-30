/**
 * contextGenerator.ts
 *
 * Synthesises living docs into context files for AI coding tools.
 * Each tool reads context from a different file/format.
 * The generator watches for doc changes and regenerates automatically.
 *
 * Flow:
 *   Living docs change → contextGenerator.regenerate()
 *     → reads all living docs
 *     → builds a condensed context document
 *     → writes tool-specific files for each detected AI tool
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import type { ProjectProfile, AiToolId, AiToolDetection } from './envAssessment';

const MAX_SECTION_LINES = 40;  // cap per section to keep context compact

// ── Types ────────────────────────────────────────────────────────────────────

interface ContextSection {
  title: string;
  content: string;
}

export interface ContextGenResult {
  written: string[];       // tool names that got context files
  skipped: string[];       // tools not detected
  errors: string[];
}

// ── Public API ───────────────────────────────────────────────────────────────

export class ContextGenerator implements vscode.Disposable {
  private profile: ProjectProfile | null = null;
  private docWatchers: vscode.FileSystemWatcher[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly workspaceRoot: string) {}

  setProfile(profile: ProjectProfile): void {
    this.profile = profile;
    this.setupWatchers();
  }

  /** Generate context files for all detected AI tools. */
  async regenerate(): Promise<ContextGenResult> {
    if (!this.profile) {
      return { written: [], skipped: [], errors: ['No project profile available'] };
    }

    const config = vscode.workspace.getConfiguration('claudeWorkflow');
    const enabledTools = config.get<AiToolId[]>('contextTools', []);

    // Determine which tools to write for:
    // If user configured specific tools, use those. Otherwise, use all detected tools.
    const targetTools = enabledTools.length > 0
      ? this.profile.aiTools.filter(t => enabledTools.includes(t.id))
      : this.profile.aiTools.filter(t => t.detected);

    if (targetTools.length === 0) {
      return { written: [], skipped: ['No AI tools detected or configured'], errors: [] };
    }

    // Build the context
    const sections = this.buildSections();
    const result: ContextGenResult = { written: [], skipped: [], errors: [] };

    for (const tool of targetTools) {
      try {
        const content = this.formatForTool(tool, sections);
        const filePath = path.join(this.workspaceRoot, tool.contextFile);

        // Ensure directory exists
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        // For tools that already have a context file the user wrote,
        // we append under a managed section marker rather than overwriting
        if (tool.existingContextFile && tool.id !== 'claude-code') {
          this.appendManagedSection(filePath, content);
        } else {
          fs.writeFileSync(filePath, content, 'utf8');
        }

        result.written.push(tool.name);
      } catch (err) {
        result.errors.push(`${tool.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const skippedTools = this.profile.aiTools.filter(t => !targetTools.includes(t));
    result.skipped = skippedTools.map(t => t.name);

    return result;
  }

  dispose(): void {
    this.docWatchers.forEach(w => w.dispose());
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }

  // ── Section builders ──────────────────────────────────────────────────────

  private buildSections(): ContextSection[] {
    const sections: ContextSection[] = [];

    // 1. Project fingerprint
    if (this.profile) {
      sections.push({
        title: 'Project',
        content: [
          `Framework: ${this.profile.framework}`,
          `Package manager: ${this.profile.packageManager}`,
          `Test runner: ${this.profile.testRunner}${this.profile.testConfigPath ? ` (${this.profile.testConfigPath})` : ''}`,
          `Test command: \`${this.profile.testCommand}\``,
          this.profile.buildCommand ? `Build command: \`${this.profile.buildCommand}\`` : '',
          this.profile.lintCommand ? `Lint command: \`${this.profile.lintCommand}\`` : '',
          `Swagger format: ${this.profile.swaggerFormat}${this.profile.swaggerDir ? ` (${this.profile.swaggerDir})` : ''}`,
        ].filter(Boolean).join('\n'),
      });
    }

    // 2. Design standards (key rules only)
    const designDoc = this.readDoc('design-standards.md');
    if (designDoc) {
      const rules = this.extractSection(designDoc, 'Quick reference', 'mandatory rules');
      sections.push({ title: 'Design Standards', content: rules || this.truncate(designDoc) });
    }

    // 3. Active decisions (latest 5)
    const decisionDoc = this.readDoc('decision-log.md');
    if (decisionDoc) {
      const entries = decisionDoc.split(/^### DEC-/gm).slice(-5);
      const condensed = entries.map(e => {
        const lines = e.split('\n').slice(0, 8);
        return '### DEC-' + lines.join('\n');
      }).join('\n\n');
      sections.push({ title: 'Recent Decisions', content: condensed });
    }

    // 4. Code patterns
    const patternsDoc = this.readDoc('patterns-library.md');
    if (patternsDoc) {
      sections.push({ title: 'Code Patterns', content: this.truncate(patternsDoc) });
    }

    // 5. Failure modes (symptoms + fixes only)
    const failureDoc = this.readDoc('failure-modes.md');
    if (failureDoc) {
      const entries = failureDoc.split(/^### FM-/gm).slice(1);
      const condensed = entries.map(e => {
        const title = e.split('\n')[0] || '';
        const symptoms = this.extractField(e, 'Symptoms');
        const fix = this.extractField(e, 'Fix');
        return `- **FM-${title.trim()}**: ${symptoms} → ${fix}`;
      }).join('\n');
      sections.push({ title: 'Known Failure Modes', content: condensed || this.truncate(failureDoc) });
    }

    // 6. Tech debt (open items only)
    const debtDoc = this.readDoc('tech-debt.md');
    if (debtDoc) {
      const entries = debtDoc.split(/^### TD-/gm).slice(1);
      const openItems = entries
        .filter(e => !e.toLowerCase().includes('status**: resolved'))
        .map(e => {
          const title = e.split('\n')[0] || '';
          const trigger = this.extractField(e, 'Trigger for action');
          return `- **TD-${title.trim()}**: Trigger: ${trigger}`;
        });
      if (openItems.length > 0) {
        sections.push({ title: 'Active Tech Debt', content: openItems.join('\n') });
      }
    }

    // 7. API audit summary
    const auditPath = path.join(this.workspaceRoot, '.claude', 'api-audit.json');
    if (fs.existsSync(auditPath)) {
      try {
        const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
        const s = audit.summary;
        if (s) {
          sections.push({
            title: 'API Audit',
            content: [
              `Routes: ${s.totalRoutes} total`,
              `Swagger coverage: ${s.documented}/${s.totalRoutes}`,
              `Auth applied: ${s.withAuth}/${s.totalRoutes}`,
              `Rate limiting: ${s.withRateLimit}/${s.totalRoutes}`,
            ].join('\n'),
          });
        }
      } catch { /* malformed JSON */ }
    }

    return sections;
  }

  // ── Tool-specific formatters ──────────────────────────────────────────────

  private formatForTool(tool: AiToolDetection, sections: ContextSection[]): string {
    const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const header = `# Project Context (auto-generated by Claude Code Workflow)\n# Last updated: ${timestamp}\n# Do not edit manually — regenerated when living docs change.\n\n`;

    switch (tool.id) {
      case 'claude-code':
        return this.formatClaudeCode(sections, header);
      case 'copilot':
        return this.formatCopilot(sections, header);
      case 'cursor':
        return this.formatCursor(sections, header);
      case 'codex':
        return this.formatCodex(sections, header);
      default:
        return this.formatGeneric(sections, header);
    }
  }

  private formatClaudeCode(sections: ContextSection[], header: string): string {
    // Claude Code reads .claude/rules/*.md — use a direct, instructive tone
    let content = header;
    content += 'Follow these project standards when writing code.\n\n';
    for (const s of sections) {
      content += `## ${s.title}\n\n${s.content}\n\n`;
    }
    return content;
  }

  private formatCopilot(sections: ContextSection[], header: string): string {
    // Copilot reads .github/copilot-instructions.md — concise, rule-focused
    let content = header;
    for (const s of sections) {
      content += `## ${s.title}\n\n${s.content}\n\n`;
    }
    return content;
  }

  private formatCursor(sections: ContextSection[], header: string): string {
    // Cursor reads .cursorrules — typically a flat list of rules
    let content = header;
    content += 'You are working on this project. Follow these standards:\n\n';
    for (const s of sections) {
      content += `## ${s.title}\n\n${s.content}\n\n`;
    }
    return content;
  }

  private formatCodex(sections: ContextSection[], header: string): string {
    // Codex reads AGENTS.md — agent-oriented instructions
    let content = header;
    content += 'When working on this codebase, follow these project standards and constraints.\n\n';
    for (const s of sections) {
      content += `## ${s.title}\n\n${s.content}\n\n`;
    }
    return content;
  }

  private formatGeneric(sections: ContextSection[], header: string): string {
    let content = header;
    for (const s of sections) {
      content += `## ${s.title}\n\n${s.content}\n\n`;
    }
    return content;
  }

  // ── Managed section (for files that already have user content) ─────────

  private appendManagedSection(filePath: string, generatedContent: string): void {
    const MARKER_START = '<!-- CLAUDE-WORKFLOW-CONTEXT-START -->';
    const MARKER_END = '<!-- CLAUDE-WORKFLOW-CONTEXT-END -->';

    let existing = '';
    try { existing = fs.readFileSync(filePath, 'utf8'); } catch { /* */ }

    const startIdx = existing.indexOf(MARKER_START);
    const endIdx = existing.indexOf(MARKER_END);

    const managed = `${MARKER_START}\n${generatedContent}\n${MARKER_END}`;

    if (startIdx >= 0 && endIdx >= 0) {
      // Replace existing managed section
      const before = existing.slice(0, startIdx);
      const after = existing.slice(endIdx + MARKER_END.length);
      fs.writeFileSync(filePath, before + managed + after, 'utf8');
    } else {
      // Append managed section
      fs.writeFileSync(filePath, existing + '\n\n' + managed + '\n', 'utf8');
    }
  }

  // ── File watchers ─────────────────────────────────────────────────────────

  private setupWatchers(): void {
    // Dispose old watchers
    this.docWatchers.forEach(w => w.dispose());
    this.docWatchers = [];

    if (!this.profile) return;

    // Watch all living docs that exist
    for (const doc of [...this.profile.livingDocs, ...this.profile.extraDocs]) {
      if (!doc.actualPath) continue;
      const pattern = new vscode.RelativePattern(this.workspaceRoot, doc.actualPath);
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      watcher.onDidChange(() => this.scheduleRegenerate());
      this.docWatchers.push(watcher);
    }

    // Also watch api-audit.json
    const auditPattern = new vscode.RelativePattern(this.workspaceRoot, '.claude/api-audit.json');
    const auditWatcher = vscode.workspace.createFileSystemWatcher(auditPattern);
    auditWatcher.onDidChange(() => this.scheduleRegenerate());
    this.docWatchers.push(auditWatcher);
  }

  private scheduleRegenerate(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      void this.regenerate();
    }, 2000); // 2s debounce to batch rapid file saves
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private readDoc(name: string): string | null {
    if (!this.profile) return null;

    // Check living docs first (respects equivalences)
    const doc = this.profile.livingDocs.find(d => d.expectedName === name);
    const actualPath = doc?.actualPath;
    if (!actualPath) return null;

    try {
      return fs.readFileSync(path.join(this.workspaceRoot, actualPath), 'utf8');
    } catch {
      return null;
    }
  }

  private extractSection(content: string, ...keywords: string[]): string | null {
    const lines = content.split('\n');
    let capturing = false;
    const result: string[] = [];

    for (const line of lines) {
      if (!capturing) {
        if (keywords.some(k => line.toLowerCase().includes(k.toLowerCase()))) {
          capturing = true;
          result.push(line);
        }
      } else {
        if (line.startsWith('## ') && result.length > 2) break; // next section
        result.push(line);
      }
    }

    return result.length > 1 ? result.slice(0, MAX_SECTION_LINES).join('\n') : null;
  }

  private extractField(text: string, fieldName: string): string {
    const re = new RegExp(`\\*\\*${fieldName}\\*\\*:\\s*(.+)`, 'i');
    const match = text.match(re);
    return match ? match[1].trim() : '(not specified)';
  }

  private truncate(content: string): string {
    const lines = content.split('\n');
    if (lines.length <= MAX_SECTION_LINES) return content;
    return lines.slice(0, MAX_SECTION_LINES).join('\n') + '\n... (truncated)';
  }
}
