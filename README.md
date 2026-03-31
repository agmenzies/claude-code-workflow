<p align="center">
  <img src="media/icon.png" width="128" height="128" alt="Claude Code Workflow">
</p>

<h1 align="center">Claude Code Workflow</h1>

<p align="center">
  <strong>Ship faster, forget less.</strong><br>
  A delivery cadence toolkit for AI-powered development.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.9.0-orange" alt="Version">
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

## Skills (15 total)

Skills are Claude Code prompts in `.claude/skills/` that you invoke from the command palette, sidebar, or keyboard shortcut. The extension ships all 15 prompts and scaffolds them into your project, adapted to your detected stack.

### Workflow

| Skill | What it does | Shortcut |
|-------|-------------|----------|
| `/update-tests` | Generate tests from instruction history | `Cmd+Shift+Alt+T` |
| `/update-uat` | Regenerate UAT.md from history | |
| `/regression` | Run TypeScript + lint + tests + UAT checklist | `Cmd+Shift+Alt+R` |
| `/sync-design` | Scan codebase, update design-standards.md | |
| `/done-check` | 25-point Definition of Done gate | `Cmd+Shift+Alt+D` |
| `/update-observability` | Update observability-expectations.md — logging, metrics, alerting | |

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
| Observability | `observability-expectations.md` | Log levels, alert thresholds |
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

### Work item creation — multi-source

Create Azure DevOps work items from any combination of sources in a single command:

```
Cmd+Shift+P → "Claude Workflow: Create Work Items (Multi-Source)"
```

A QuickPick shows all open items from:
- `tech-debt.md` — open TD entries
- `.claude/dod-result.md` — failed DoD checklist items
- `.claude/api-audit.json` — Critical and High severity API issues
- `post-reviews.md` — unchecked `- [ ]` action items

Select any combination, all are created as work items in one pass. Critical/High items are pre-selected.

### Bidirectional board status sync

When items are closed on the Azure DevOps board, sync that status back to the living docs:

```
Cmd+Shift+P → "Claude Workflow: Sync Board Status"
```

Queries all `claude-workflow` tagged work items, finds those in Closed/Resolved/Done state, and updates the corresponding `tech-debt.md` entries to `Status: Resolved (YYYY-MM-DD)`.

### Automated pipeline

Copy `templates/azure-pipelines-wiki-sync.yml` to your project. It syncs living docs to the wiki on every push to main, triggered only when doc files change.

### Configuration

```jsonc
"claudeWorkflow.azureDevOps.organization": "your-org",
"claudeWorkflow.azureDevOps.project": "your-project"
// PAT stored in VS Code SecretStorage — never in settings
```

---

## Trello integration

Connect a Trello board in one step — the wizard walks you through board and list selection:

```
Cmd+Shift+P → "Claude Workflow: Connect Trello Board"
```

You will be prompted to select your project board and map three lists (Backlog, In Progress, Done). API key and token are stored in VS Code SecretStorage.

Once connected, create cards from the same multi-source picker:

```
Cmd+Shift+P → "Claude Workflow: Sync Items to Trello"
```

The Board section in the sidebar shows your In Progress cards in real time. Click any card to open it in Trello.

---

## Sidebar panel

The **Claude Code Workflow** panel appears in the Explorer sidebar when the extension is active. It has five sections:

### Session Checklist

Green/red indicators for: history updated, tests updated, UAT current, API audit current, design standards synced, Definition of Done run. Uses the project profile for accurate detection.

### Skills

Organised into four categories (Workflow, API, Capture, Generate). Click any skill to run it. Missing skills show "(scaffold to create)" and link to the scaffold command.

### API Health

Coverage stats from the last audit: Swagger coverage, auth applied, rate limiting. Each shows a percentage with green/amber/red indicator.

### Artifacts

Every living doc discovered in the project with a real-time activity view:

- **Age badge** — "today", "yesterday", "3d ago", "last week", "stale" — colour coded green → amber → red
- **Open items count** — tech-debt shows open item count, failure-modes shows total entries, post-reviews shows unchecked action count, decision log shows total decisions, instruction history shows entry count
- **Missing docs** shown as grey placeholders — click to scaffold

### Board

Live view of your Azure DevOps sprint and/or Trello in-progress cards:

- **Azure DevOps** — current sprint name, up to 8 active work items with state indicators, direct links
- **Trello** — In Progress cards with click-to-open links
- **Create Work Items** / **Create Cards** action buttons (multi-source picker)
- **Sync Board Status** button (bidirectional — updates living docs from closed items)
- **Refresh** button with last-loaded time

The Board section only appears when ADO or Trello is configured. When neither is set up, it shows connect prompts instead.

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
| `claudeWorkflow.updateObservability` | Update Observability Expectations | |
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
| `claudeWorkflow.syncMultiSourceItems` | Create Work Items (Multi-Source) | |
| `claudeWorkflow.syncBoardStatus` | Sync Board Status | |
| `claudeWorkflow.refreshBoard` | Refresh Board | |
| `claudeWorkflow.connectTrello` | Connect Trello Board | |
| `claudeWorkflow.syncToTrello` | Sync Items to Trello | |
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
| `claudeWorkflow.trello.boardId` | string | `""` | Trello board ID (set by Connect wizard) |
| `claudeWorkflow.trello.boardName` | string | `""` | Trello board display name |
| `claudeWorkflow.trello.backlogListId` | string | `""` | Trello Backlog list ID |
| `claudeWorkflow.trello.inProgressListId` | string | `""` | Trello In Progress list ID |
| `claudeWorkflow.trello.doneListId` | string | `""` | Trello Done list ID |

---

## Architecture

```
src/
├── extension.ts          Entry point — registers commands, starts services
├── envAssessment.ts      Project scanning — 14 detectors build ProjectProfile
├── contextGenerator.ts   Synthesises docs → AI tool context files (incl. sprint)
├── setupWizard.ts        Multi-step webview wizard
├── workflowPanel.ts      Explorer sidebar — Checklist, Skills, API Health, Artifacts, Board
├── statusBar.ts          Status bar item
├── historyTracker.ts     Watches instruction-history.toon
├── skillRunner.ts        Runs Claude Code skills via terminal
├── skillTemplates.ts     15 bundled skill prompts + adaptive scaffolding
├── apiAuditor.ts         Route scanner + Swagger coverage checker
├── apiDiagnostics.ts     VS Code diagnostics from audit results
├── azureDevOps.ts        REST client — wiki, work items, sprint items
├── wikiSync.ts           Pushes docs to Azure DevOps Wiki
├── workItemSync.ts       Multi-source work item creation + bidirectional sync
├── trelloClient.ts       REST client for Trello API (no npm deps)
└── trelloSync.ts         Trello board connection wizard + card creation
```

---

## Version history

| Version | What changed |
|---------|-------------|
| **0.9.0** | Trello integration (connect wizard, card creation, in-progress sidebar view); ADO multi-source work item creation from 4 sources; bidirectional board status sync; sprint context injection into AI tools; Artifacts sidebar with age badges + open item counts; Board sidebar with live sprint/card view |
| **0.8.0** | Full skill coverage — all 15 skills now ship with generic templates; new `/update-observability` skill and living doc; DoD check writes result file for sidebar; Codex circular-detection fix |
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
