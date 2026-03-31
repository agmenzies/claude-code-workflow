<p align="center">
  <img src="media/icon.png" width="128" height="128" alt="Claude Code Workflow">
</p>

<h1 align="center">Claude Code Workflow</h1>

<p align="center">
  <strong>Ship faster, forget less.</strong><br>
  A delivery cadence toolkit for AI-powered development.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.7.0-orange" alt="Version">
  <img src="https://img.shields.io/badge/VS%20Code-1.85%2B-blue" alt="VS Code">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
</p>

---

## What it does

Claude Code Workflow is a VS Code extension that captures anything that prevents you from thinking the same thought twice, debugging the same issue twice, or explaining the same context twice.

It does three things:

1. **Maintains living docs** — decision log, patterns library, failure modes, tech debt register, release notes, and more — updated by Claude Code skills you invoke as you work
2. **Injects context into AI tools** — when a living doc changes, the extension regenerates context files that Claude Code, Copilot, Cursor, and Codex read automatically, so every AI tool knows your standards before writing code
3. **Syncs to your team** — pushes living docs to Azure DevOps Wiki and creates work items from tech debt entries, so the team sees everything without cloning the repo

---

## Quick start

### Install

```bash
# From VSIX
code --install-extension claude-code-workflow-0.7.0.vsix

# Or from source
git clone https://github.com/agmenzies/claude-code-workflow.git
cd claude-code-workflow
npm install && npm run compile
npx vsce package
code --install-extension claude-code-workflow-0.7.0.vsix
```

### First run

1. Open any project that has a `.claude/` directory (skills, agents, or settings)
2. The **setup wizard** opens automatically on first activation
3. Step 1 scans your project and shows what already exists (test runner, swagger format, existing docs, AI tools)
4. Step 2 connects Azure DevOps (optional)
5. Step 3 scaffolds only the skills that are missing — existing custom skills are never overwritten
6. Done

### Or scaffold manually

```
Cmd+Shift+P → "Claude Workflow: Scaffold All Skills"
```

---

## Environment assessment

On activation, the extension scans your workspace in ~2 seconds and builds a project profile. Every feature adapts to what it finds rather than assuming a fixed structure.

| Detected | How |
|----------|-----|
| **Package manager** | Checks for `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`, `package-lock.json` |
| **Framework** | Reads `package.json` dependencies — Express, Next.js, Nest.js, Fastify, Hono, Koa |
| **Test runner + config** | Finds Jest, Vitest, Mocha, Playwright configs at any path (e.g. `config/jest.config.ts`) |
| **Test directories** | Globs for `*.test.ts` and extracts parent dirs — no hardcoded paths |
| **Swagger format** | YAML, JSON, or TypeScript code-first (scans `server/swagger/` for `.ts` files) |
| **CI/CD** | Azure Pipelines, GitHub Actions, GitLab CI |
| **Existing skills** | Checks each `.claude/skills/*.md` — marks as present, custom, or missing |
| **Agent structure** | Single `agent-playbooks.md` vs `.claude/agents/` directory with individual files |
| **Living docs** | Exact match, equivalent name (e.g. `CHANGELOG.md` for `release-notes.md`), or missing |
| **Extra docs** | Discovers `architecture-*.md`, `*-notes.md`, `test-plan-*.md`, etc. |
| **AI tools** | Detects Claude Code, Copilot, Cursor, Codex, Aider, Windsurf from their config files |

The profile is used everywhere: sidebar checklist, skill templates, API auditor, wiki sync, and context generation.

---

## Skills (14 total)

Skills are Claude Code prompts in `.claude/skills/` that you invoke from the command palette, sidebar, or keyboard shortcut. The extension ships 10 template prompts and scaffolds them into your project, adapted to your detected stack.

### Workflow

| Skill | What it does | Shortcut |
|-------|-------------|----------|
| `/update-tests` | Generate tests from instruction history | `Cmd+Shift+Alt+T` |
| `/update-uat` | Regenerate UAT.md from history | |
| `/regression` | Run Jest + TypeScript + lint + UAT checklist | `Cmd+Shift+Alt+R` |
| `/sync-design` | Scan codebase, update design-standards.md | |
| `/done-check` | 25-point Definition of Done gate | `Cmd+Shift+Alt+D` |

### API

| Skill | What it does | Shortcut |
|-------|-------------|----------|
| `/audit-api` | Check routes for auth, rate limits, validation, Swagger | `Cmd+Shift+Alt+A` |
| `/sync-api-docs` | Generate Swagger for undocumented routes | |

### Capture

| Skill | What it does | Living doc |
|-------|-------------|------------|
| `/log-decision` | Record what was decided, why, alternatives, trade-offs | `decision-log.md` |
| `/capture-pattern` | Extract a reusable code pattern | `patterns-library.md` |
| `/log-failure` | Document symptoms, diagnosis, fix, prevention | `failure-modes.md` |
| `/log-debt` | Track debt with impact, effort, trigger for action | `tech-debt.md` |

### Generate

| Skill | What it does | Living doc |
|-------|-------------|------------|
| `/release-notes` | Generate release notes from history | `release-notes.md` |
| `/post-review` | Capture what slowed you down, what was missing | `post-reviews.md` |
| `/update-playbooks` | Update agent prompt templates and patterns | `agent-playbooks.md` |

---

## AI context injection

When a living doc changes, the extension regenerates a condensed context file that AI coding tools read automatically.

```
Living doc updated → contextGenerator watches for change
                   → reads all living docs
                   → builds condensed ~2-5KB context
                   → writes tool-specific file
                   → AI tool picks it up on next prompt
```

### Supported tools

| Tool | Context file written | Auto-detected by |
|------|---------------------|-----------------|
| **Claude Code** | `.claude/rules/living-context.md` | `.claude/settings.json` |
| **GitHub Copilot** | `.github/copilot-instructions.md` | existing instructions file |
| **Cursor** | `.cursorrules` | existing rules file |
| **OpenAI Codex** | `AGENTS.md` | existing file |
| **Aider** | `.aider.conf.yml` | existing config |
| **Windsurf** | `.windsurfrules` | existing rules file |

### What the AI sees

| Section | Source | What's included |
|---------|--------|----------------|
| Project | Assessment profile | Framework, test command, swagger format |
| Design Standards | `design-standards.md` | Mandatory rules table |
| Recent Decisions | `decision-log.md` | Last 5 decisions with trade-offs |
| Code Patterns | `patterns-library.md` | Templates + anti-patterns |
| Failure Modes | `failure-modes.md` | Symptom to fix (one-liners) |
| Active Tech Debt | `tech-debt.md` | Open items with trigger conditions |
| API Audit | `.claude/api-audit.json` | Coverage and compliance stats |

For files that already have user content (e.g. your own `.cursorrules`), the extension appends a managed section between `<!-- CLAUDE-WORKFLOW-CONTEXT-START -->` markers instead of overwriting.

### Configuration

```jsonc
// Auto-detect which tools are present (default)
"claudeWorkflow.contextTools": []

// Or specify explicitly
"claudeWorkflow.contextTools": ["claude-code", "cursor", "copilot"]
```

---

## API auditing

Two-tier analysis: a fast regex scan runs on every route file save (no AI needed), and a deep Claude-powered audit writes structured results.

### Quick scan (automatic)

- Finds route handlers via regex (`router.get`, `app.post`, etc.)
- Reads Swagger paths from YAML, JSON, or TypeScript code-first files
- Shows missing-swagger diagnostics as inline squiggles in VS Code

### Deep audit (`/audit-api` skill)

Claude checks every route for:
- Authentication middleware
- Rate limiting
- Input validation (Zod, Joi, express-validator)
- Consistent error response format
- OpenAPI documentation
- Tenant scoping (`company_id`)

Results are written to `.claude/api-audit.json`, which the extension reads to show diagnostics and populate the API Health panel.

---

## Azure DevOps integration

### Wiki sync

Push all living docs to Azure DevOps Wiki pages — on demand or automatically via pipeline.

```
Cmd+Shift+P → "Claude Workflow: Sync Living Docs to Wiki"
```

Each doc maps to a wiki page under a configurable root path (default: `/Claude Workflow/`). The sync uses the profile to push docs at their actual paths, including equivalents and discovered extras.

### Work item creation

Parse `tech-debt.md` entries and create Azure DevOps work items with priority mapping and `claude-workflow-tech-debt` tags for duplicate detection.

```
Cmd+Shift+P → "Claude Workflow: Sync Tech Debt to Work Items"
```

### Automated pipeline

Copy `templates/azure-pipelines-wiki-sync.yml` to your project. It syncs living docs to the wiki on every push to main, triggered only when doc files change.

### Configuration

```jsonc
"claudeWorkflow.azureDevOps.organization": "your-org",
"claudeWorkflow.azureDevOps.project": "your-project"
// PAT stored in VS Code SecretStorage — never in settings
```

---

## Sidebar panel

The **Claude Code Workflow** panel appears in the Explorer sidebar when the extension is active. It has four sections:

### Session Checklist

Green/red indicators for: history updated, tests updated, UAT current, API audit current, design standards synced, Definition of Done run. Uses the project profile for accurate detection (e.g. finds tests at `config/jest.config.ts`, not just the 5 default paths).

### Skills

Organised into four categories (Workflow, API, Capture, Generate). Click any skill to run it. Missing skills show "(scaffold to create)" and link to the scaffold command.

### API Health

Coverage stats from the last audit: Swagger coverage, auth applied, rate limiting. Each shows a percentage with green/amber/red indicator.

### Living Docs

Quick-open links for every discovered doc, including equivalents (shown with actual filename) and extras discovered by the assessment.

---

## Status bar

Shows `✓ Claude History (1919)` in green when the instruction history is recent, or `⚠ Claude History` in amber when it hasn't been updated for the configured threshold (default: 8 hours). Click to open the sidebar.

After each git commit, a notification reminds you to update the history if it looks stale.

---

## All commands

| Command | Palette title | Shortcut |
|---------|--------------|----------|
| `claudeWorkflow.updateTests` | Update Tests from History | `Cmd+Shift+Alt+T` |
| `claudeWorkflow.updateUAT` | Update UAT Spec | |
| `claudeWorkflow.regression` | Run Regression Suite | `Cmd+Shift+Alt+R` |
| `claudeWorkflow.syncDesign` | Sync Design Standards | |
| `claudeWorkflow.doneCheck` | Definition of Done Check | `Cmd+Shift+Alt+D` |
| `claudeWorkflow.auditApi` | Audit API | `Cmd+Shift+Alt+A` |
| `claudeWorkflow.syncApiDocs` | Sync API Docs | |
| `claudeWorkflow.logDecision` | Log Decision | `Cmd+Shift+Alt+L` |
| `claudeWorkflow.capturePattern` | Capture Pattern | |
| `claudeWorkflow.logFailure` | Log Failure Mode | |
| `claudeWorkflow.logDebt` | Log Tech Debt | |
| `claudeWorkflow.releaseNotes` | Generate Release Notes | |
| `claudeWorkflow.postReview` | Post-Implementation Review | |
| `claudeWorkflow.updatePlaybooks` | Update Agent Playbooks | |
| `claudeWorkflow.scaffoldSkills` | Scaffold All Skills | |
| `claudeWorkflow.syncToWiki` | Sync Living Docs to Wiki | |
| `claudeWorkflow.syncDebtToWorkItems` | Sync Tech Debt to Work Items | |
| `claudeWorkflow.regenerateContext` | Regenerate AI Context | |
| `claudeWorkflow.appendHistory` | Append to Instruction History | |
| `claudeWorkflow.openSetup` | Open Setup Wizard | |
| `claudeWorkflow.refresh` | Refresh | |

---

## All settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `claudeWorkflow.claudePath` | string | `"claude"` | Path to Claude Code CLI |
| `claudeWorkflow.historyFile` | string | `"instruction-history.toon"` | Instruction history file |
| `claudeWorkflow.autoRemindAfterCommit` | boolean | `true` | Reminder after git commits |
| `claudeWorkflow.staleThresholdHours` | number | `8` | Hours before history shows amber |
| `claudeWorkflow.routeGlobs` | array | `["server/routes/**/*.ts", ...]` | Route file patterns for API scan |
| `claudeWorkflow.swaggerGlobs` | array | `["server/swagger/**/*.yaml", ...]` | Swagger file patterns |
| `claudeWorkflow.publicRoutePrefixes` | array | `["/health", "/api/health", ...]` | Routes where auth is not required |
| `claudeWorkflow.contextTools` | array | `[]` | AI tools for context injection (empty = auto-detect) |
| `claudeWorkflow.azureDevOps.organization` | string | `""` | Azure DevOps org name |
| `claudeWorkflow.azureDevOps.project` | string | `""` | Azure DevOps project name |
| `claudeWorkflow.azureDevOps.wikiRootPath` | string | `"/Claude Workflow"` | Wiki root path |
| `claudeWorkflow.azureDevOps.wikiId` | string | `""` | Wiki ID (empty = auto-discover) |
| `claudeWorkflow.azureDevOps.debtWorkItemType` | string | `"Task"` | Work item type for tech debt |

---

## Architecture

```
src/
├── extension.ts          Entry point — registers commands, starts services
├── envAssessment.ts      Project scanning — 14 detectors build ProjectProfile
├── contextGenerator.ts   Synthesises docs → AI tool context files
├── setupWizard.ts        Multi-step webview wizard
├── workflowPanel.ts      Explorer sidebar tree view
├── statusBar.ts          Status bar item
├── historyTracker.ts     Watches instruction-history.toon
├── skillRunner.ts        Runs Claude Code skills via terminal
├── skillTemplates.ts     10 bundled skill prompts + adaptive scaffolding
├── apiAuditor.ts         Route scanner + Swagger coverage checker
├── apiDiagnostics.ts     VS Code diagnostics from audit results
├── azureDevOps.ts        REST client for wiki + work items
├── wikiSync.ts           Pushes docs to Azure DevOps Wiki
└── workItemSync.ts       Creates work items from tech-debt.md
```

---

## Version history

| Version | What changed |
|---------|-------------|
| **0.7.0** | AI context injection — auto-generates context files for Claude Code, Copilot, Cursor, Codex, Aider, Windsurf from living docs |
| **0.6.0** | Environment assessment — scans project before scaffolding, adapts to what exists |
| **0.5.0** | Bold orange icon, setup wizard webview, VS Code walkthrough |
| **0.4.0** | Azure DevOps integration — wiki sync, work items, pipeline template |
| **0.3.0** | 14 skills across 4 categories — decision log, DoD, patterns, failure modes, tech debt, release notes, post-review, playbooks |
| **0.2.0** | API auditing, inline diagnostics, skill scaffolding |
| **0.1.0** | Sidebar panel, status bar, 4 skills, history watcher |

---

## Contributing

```bash
git clone https://github.com/agmenzies/claude-code-workflow.git
cd claude-code-workflow
npm install
npm run watch    # recompile on change
# Press F5 in VS Code to launch Extension Development Host
```

---

## License

MIT
