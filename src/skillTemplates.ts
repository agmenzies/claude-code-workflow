/**
 * skillTemplates.ts
 *
 * Template content for every skill the extension can scaffold into a project.
 * Written to .claude/skills/ when the user runs "Scaffold Skills".
 * Generic — works with any Express / Node / React codebase.
 */

// ── Workflow skills ──────────────────────────────────────────────────────────

export const UPDATE_TESTS_SKILL = `---
name: update-tests
description: Generate or update unit and integration tests based on recent instruction-history entries. Identifies new behaviour, bug fixes, and edge cases that currently lack test coverage.
---

You are the test maintainer. Your job is to ensure the test suite accurately covers what has been built.

## Steps

1. **Read recent history** — Read the last 10 entries in \`instruction-history.toon\`. Identify:
   - New features added (type: Feature addition)
   - Bug fixes (type: Bug fix) — these always need a regression test
   - Behaviour changes (type: Enhancement, Update)

2. **Run the current test suite** — Run \`npm run test\` to see what passes and fails.

3. **Find gaps** — For each recent change:
   - Does a test file exist for the changed module?
   - Are the new code paths covered? (check for the new function/route/component names)
   - Is the bug fix scenario covered? (the exact condition that caused the bug)

4. **Write tests** — Follow the existing test patterns in the project:
   - Mirror the directory structure: \`server/routes/foo.ts\` → \`server/routes/__tests__/foo.test.ts\`
   - Use the existing test helpers and factories
   - Test happy path + error paths + edge cases

5. **Run tests again** — Confirm all new tests pass: \`npm run test\`

6. **Report** — List what was added: test file, test cases, and what behaviour they cover.

## Test writing guidelines
- One \`describe\` per module/function
- Test names: "should [behaviour] when [condition]"
- Arrange → Act → Assert pattern
- Mock external dependencies (database, email, SMS) — test business logic, not infrastructure
- Edge cases to always cover: null/undefined inputs, empty arrays, boundary values, unauthenticated requests
- For API routes: test 200, 400, 401/403, and 500 responses
`;

export const UPDATE_UAT_SKILL = `---
name: update-uat
description: Regenerate UAT.md from instruction-history.toon. Keeps the user acceptance test specification in sync with what has been built.
---

You are maintaining the living UAT specification. This is the document QA and stakeholders use to verify the system works as intended from a user perspective.

## Steps

1. **Read existing UAT.md** — Note the current structure and any sections that are recent and accurate.

2. **Read instruction-history.toon** — Find all entries since the last UAT update (look for a timestamp at the top of UAT.md, or go back 20 entries).

3. **Identify user-facing changes**:
   - Feature additions and enhancements that changed UI or API behaviour
   - Bug fixes that changed observable behaviour
   - Skip: refactoring, configuration changes, internal changes with no user impact

4. **Update UAT.md** — For each feature area touched, add or update scenarios:

\`\`\`markdown
## [Feature area]
_Last updated: YYYY-MM-DD_

### Scenario: [user action]
**Given**: [precondition — user is logged in as X, record exists, etc.]
**When**: [the action the user takes]
**Then**: [the expected observable outcome]

| Check | Expected | Pass/Fail |
|-------|----------|-----------|
| [specific thing to verify] | [exact expected value/state] | |
\`\`\`

5. **Update the header**:
\`\`\`markdown
# UAT Specification
_Generated from instruction-history.toon — last updated YYYY-MM-DD, entries #NNN–#NNN_
\`\`\`

6. **Preserve** existing passing scenarios — only update sections where behaviour changed.

## Notes
- Write from the user's perspective — "the user clicks", not "the component renders"
- Each scenario should be runnable by a non-developer
- Include both happy paths and error scenarios (invalid input, unauthorised access, empty state)
- For API changes, include a curl example in the scenario
`;

export const REGRESSION_SKILL = `---
name: regression
description: Run the full regression suite. Executes TypeScript type-check, linter, tests, and reviews the UAT checklist. Reports all failures with context.
---

You are running the project's regression suite. This is the full quality check — run before merging, after a bug fix, or as an ad-hoc quality check.

## Steps

1. **TypeScript check** — Run \`npm run check\`. Report any type errors. Fix obvious ones; note complex ones.

2. **Lint** — Run \`npm run lint\`. Fix any errors before proceeding.

3. **Tests** — Run \`npm run test\`. Note:
   - Which test files failed?
   - What is the error message?
   - Is this a new failure or pre-existing?

4. **UAT review** — Read \`UAT.md\`. For the last 5 features/fixes in \`instruction-history.toon\`, manually walk through the UAT scenarios and verify they still hold.

5. **API audit check** — Check \`.claude/api-audit.json\` if it exists. Note any Critical or High severity issues.

6. **Report** — Write a structured summary:

\`\`\`
## Regression Report — YYYY-MM-DD HH:MM

### TypeScript
Status: PASS / FAIL (N errors)
[list of errors if any]

### Lint
Status: PASS / FAIL (N warnings, N errors)

### Tests
Status: PASS / FAIL
Passed: N | Failed: N
[list of failed tests with error summary]

### UAT
Status: PASS / PARTIAL / NOT CHECKED
[any scenarios that fail or need investigation]

### API Audit
Status: No issues / N critical, N high issues
[top issues if any]

### Overall
PASS — safe to merge
  OR
FAIL — N issues require attention
[numbered list of actions required]
\`\`\`

## Notes
- Fix TypeScript and lint errors before running tests — they may be related
- If tests fail, check if it is a test environment issue before blaming the code
- A clean regression report is the minimum bar before any merge
`;

export const SYNC_DESIGN_SKILL = `---
name: sync-design
description: Scan the codebase for UI and code conventions and update design-standards.md. Captures component patterns, naming conventions, colour tokens, layout rules, and interaction standards.
---

You are maintaining the project's design standards. This is the reference every developer and AI agent reads before writing UI code.

## Steps

1. **Read existing design-standards.md** — Note what is already documented. You will UPDATE, not replace.

2. **Scan the codebase for patterns** — Look at:
   - \`client/src/components/\` — component structure and naming
   - \`client/src/pages/\` — page layout patterns
   - Tailwind classes in use — spacing, colours, typography
   - Form, table, modal, and loading state patterns
   - Icon usage (which icons map to which actions)

3. **Identify the canonical patterns** — Where the same pattern appears in 3+ places, that is the standard.

4. **Update design-standards.md** with these sections:

\`\`\`markdown
# Design Standards
_Last updated: YYYY-MM-DD_

## Quick reference — mandatory rules
| Rule | Do | Don't |
|------|-----|-------|
| Edit action | Use \`<Pencil />\` icon | Custom icons |
| Delete action | Use \`<Trash2 />\` icon | Unlabelled X |
| ... | ... | ... |

## Component conventions
[How components are structured, named, composed]

## Layout patterns
[Page layout, sidebar, content area, spacing conventions]

## Colour and typography
[Token names used in practice, heading hierarchy, status colours]

## Form patterns
[Schema definition → form component → mutation → toast feedback]

## Data display patterns
[Table, list, card conventions — sorting, pagination, filtering]

## Loading and error states
[Skeleton, spinner, empty state, toast, error boundary conventions]

## Icon standards
| Action | Icon | Do not use |
|--------|------|-----------|
| Edit | \`<Pencil />\` | Pen, Edit, Write |
| Delete | \`<Trash2 />\` | X, Remove |
| View | \`<Eye />\` | Search |
| Add | \`<Plus />\` | Add, New |

## Interaction patterns
[Modal, drawer, confirmation dialog, tooltip conventions]
\`\`\`

5. **Save** updates to \`design-standards.md\`.

## Notes
- Look at the most-used, most-recent components — they reflect current standards
- The "Quick reference — mandatory rules" table is injected into AI tool context — keep it concise
- Update after any UI sprint, after adding new components, or when onboarding a new agent
`;

// ── Observability ─────────────────────────────────────────────────────────────

export const UPDATE_OBSERVABILITY_SKILL = `---
name: update-observability
description: Update observability-expectations.md — the project's standard for what to log, what to measure, what to alert on, and how to trace requests. Run after any new service, job, or integration is added.
---

You are maintaining the project's observability standards. This document defines what production visibility looks like so every new feature ships with the right logging, metrics, and alerting built in.

## Steps

1. **Read existing observability-expectations.md** — Note what is already documented. You will UPDATE, not replace.

2. **Read recent history** — Read the last 10 entries in \`instruction-history.toon\`. Identify new services, jobs, integrations, or critical paths added.

3. **Review logging in changed files** — Check:
   - Are key operations logged at the right level?
   - Are error paths logging enough context to diagnose in production?
   - Is sensitive data absent from log messages?
   - Are correlation/trace IDs propagated?

4. **Update observability-expectations.md** with these sections:

\`\`\`markdown
# Observability Expectations
_Last updated: YYYY-MM-DD_

## Logging standards

### Log levels
| Level | Use for |
|-------|---------|
| \`error\` | Unhandled exceptions, failed external calls, data integrity issues |
| \`warn\` | Recoverable errors, retries, deprecated usage, config anomalies |
| \`info\` | Key business events (user created, payment processed, job completed) |
| \`debug\` | Diagnostic detail — disabled in production |

### Required log fields
Every log entry must include: \`timestamp\`, \`level\`, \`service\`, \`message\`.
Business events must also include: \`companyId\`, \`userId\` (where available), \`correlationId\`.

### What to always log
- Service startup and shutdown with config summary (no secrets)
- External API calls: service name, endpoint, status code, duration
- Database errors: query context, error message (no data)
- Auth events: login, logout, token refresh, permission denial
- Job start/completion/failure with duration
- Webhook receipt and dispatch

### What never to log
- Passwords, tokens, or credentials
- Full request/response bodies containing PII
- Credit card numbers, national insurance numbers, bank details

## Metrics

### Key metrics to track
| Metric | Type | Description |
|--------|------|-------------|
| http_request_duration_ms | histogram | Per route, per status code |
| job_duration_ms | histogram | Per job type |
| external_api_errors_total | counter | Per service, per error type |
| active_users | gauge | Current authenticated sessions |

## Alerting

### Alert thresholds
| Alert | Condition | Severity |
|-------|-----------|----------|
| Error rate spike | >5% of requests returning 5xx in 5 min window | Critical |
| Job failure | Any scheduled job fails 3 times consecutively | High |
| External API down | >3 consecutive failures to a critical integration | High |
| Slow response | p95 latency >2s for any route over 5 min window | Medium |

## Tracing

### Correlation IDs
- \`X-Correlation-ID\` header passed through from API gateway
- Generated at request entry point if absent
- Included in all downstream calls and log entries
- Returned in error responses for support use

## Service-specific expectations

[Add a subsection per service/integration as the project grows]
\`\`\`

5. **Save** to \`observability-expectations.md\`.

## When to run this skill
- After adding a new service or background job
- After integrating a new third-party service
- After a production incident caused by missing observability
- At the start of any performance or reliability sprint

## Notes
- "What to always log" is the minimum bar — new services must meet it before shipping
- Alert thresholds should be reviewed quarterly — too many alerts causes alert fatigue
- Every critical business transaction should be traceable end-to-end via correlation ID
`;

// ── API skills (from v0.2.0) ─────────────────────────────────────────────────

export const AUDIT_API_SKILL = `---
name: audit-api
description: Audit all API routes for standards compliance — authentication, rate limiting, input validation, consistent error format, and OpenAPI documentation coverage. Writes results to .claude/api-audit.json so the VS Code extension can show inline diagnostics.
---

You are auditing the API routes in this codebase for standards compliance.

## Steps

1. **Find all route files** — Look in \`server/routes/\`, \`src/routes/\`, \`routes/\`, \`app/routes/\`.
2. **Find authentication middleware** — Identify what the project uses for auth.
3. **Find rate limiting middleware** — Identify the rate limiter.
4. **Find input validation** — Identify the validation approach (Zod, Joi, express-validator, etc.).
5. **Find OpenAPI/Swagger docs** — Look in \`server/swagger/\`, \`swagger/\`, \`openapi/\`.
6. **Audit each route** — For each handler check:
   - [ ] Authentication middleware present (or intentionally public)
   - [ ] Rate limiting applied (especially on auth and public-facing routes)
   - [ ] Input validation on POST/PUT/PATCH
   - [ ] Consistent error response format
   - [ ] Documented in Swagger/OpenAPI
   - [ ] company_id / tenant scoping if multi-tenant

7. **Write results** to \`.claude/api-audit.json\`:
\`\`\`json
{
  "auditedAt": "<ISO 8601>",
  "issues": [{ "file": "", "line": 0, "method": "", "path": "", "rule": "", "severity": "", "message": "" }],
  "summary": { "totalRoutes": 0, "documented": 0, "withAuth": 0, "withRateLimit": 0 }
}
\`\`\`
Valid rules: \`missing-auth\`, \`missing-rate-limit\`, \`missing-validation\`, \`missing-swagger\`, \`no-error-handler\`, \`inconsistent-response\`.

8. **Report** — Summarise: total routes, issues by severity, top 3 most urgent fixes.
`;

export const SYNC_API_DOCS_SKILL = `---
name: sync-api-docs
description: Generate or update Swagger/OpenAPI documentation for routes that are missing coverage. Reads existing docs to match style, then adds missing path entries.
---

You are the API documentation maintainer. Ensure every route is documented in the project's Swagger/OpenAPI files.

## Steps

1. **Discover route files** and list each method + path.
2. **Read existing Swagger docs** — note style (YAML/JSON, OpenAPI 3.x vs 2.x).
3. **Load .claude/api-audit.json** if present — use \`missing-swagger\` issues as priority list.
4. **Identify gaps** — routes with no path entry or missing request body / response schemas.
5. **Generate documentation** — match existing style. Include \`summary\`, \`parameters\`, \`requestBody\`, \`responses\` (200, 400, 401 minimum).
6. **Write updated files** — in-place. If no swagger dir exists, create \`swagger/paths/\` + \`swagger/openapi.yaml\`.
7. **Update audit file** — remove resolved \`missing-swagger\` issues.
`;

// ── Decision log ─────────────────────────────────────────────────────────────

export const LOG_DECISION_SKILL = `---
name: log-decision
description: Append a decision to decision-log.md. Captures what was decided, what alternatives were considered, why this option won, trade-offs accepted, and what would trigger revisiting.
---

You are maintaining the project's decision log. This captures architectural and implementation decisions so they don't get re-litigated and so AI agents have the context they need.

## Steps

1. **Understand the decision** — Ask yourself (or read from context):
   - What was decided?
   - What prompted the decision?
   - What alternatives were considered?

2. **Read existing log** — Read \`decision-log.md\` if it exists. You will APPEND, not replace.

3. **Write the entry** using this format:

\`\`\`markdown
### DEC-NNN: [Short title]
**Date**: YYYY-MM-DD
**Status**: Accepted | Superseded by DEC-XXX | Revisiting
**Context**: [What prompted this decision — 1-3 sentences]

**Options considered**:
| Option | Pros | Cons |
|--------|------|------|
| A: ... | ... | ... |
| B: ... | ... | ... |

**Decision**: [Which option was chosen and why — 1-3 sentences]
**Trade-offs accepted**: [What you're knowingly giving up]
**Revisit when**: [Conditions that would cause you to reconsider]
**Related**: [links to other decisions, history entries, or files]
\`\`\`

4. **Number sequentially** — Read the last DEC-NNN entry and increment.
5. **Save** — Append to \`decision-log.md\`. If it doesn't exist, create it with a header.

## Trigger
Run this skill when you've made a non-obvious choice — framework selection, architecture pattern, library choice, data model design, permission model, third-party integration approach, or any decision someone might later ask "why did we do it this way?"

## Notes
- Keep entries concise — this is a reference, not a narrative
- "Revisit when" is critical — it prevents premature re-evaluation
- Link to instruction-history.toon entries where relevant
`;

// ── Definition of done ──────────────────────────────────────────────────────

export const DONE_CHECK_SKILL = `---
name: done-check
description: Run the Definition of Done checklist against recent work. Checks code, tests, docs, security, observability, edge cases, and rollout readiness. Reports what's complete and what's missing.
---

You are running the project's Definition of Done checklist. This is the quality gate before work is considered complete.

## Steps

1. **Identify recent work** — Read the last 5 entries in \`instruction-history.toon\`. Identify what feature, fix, or change was implemented.

2. **Run through the checklist** — For each item below, check the codebase and report PASS / FAIL / N/A with evidence:

### Code quality
- [ ] Code written and compiles (\`npm run check\`)
- [ ] Linter passes (\`npm run lint\`)
- [ ] No \`any\` typing introduced
- [ ] No hardcoded role checks
- [ ] API client rules followed (authenticatedFetch, not raw fetch)

### Tests
- [ ] Unit/integration tests added or updated for new behaviour
- [ ] Existing tests still pass (\`npm run test\`)
- [ ] Edge cases have test coverage (empty inputs, null, boundary values)

### Documentation
- [ ] instruction-history.toon updated
- [ ] Swagger/OpenAPI updated if API changed
- [ ] UAT.md updated if user-facing behaviour changed
- [ ] design-standards.md updated if UI patterns changed

### Security & permissions
- [ ] New routes have authentication middleware
- [ ] Permission key defined if new functional area
- [ ] company_id / tenant scoping on new queries
- [ ] No secrets in code, logs, or comments

### Observability
- [ ] Key operations have logging (at appropriate level)
- [ ] Error paths log enough context to diagnose
- [ ] No sensitive data in log messages

### User experience
- [ ] Works on mobile / responsive layouts (if UI change)
- [ ] Loading states present
- [ ] Error states handled gracefully (toast, retry, etc.)
- [ ] Empty states handled

### Rollout readiness
- [ ] Database migration idempotent (azure-schema-sync.sql if applicable)
- [ ] No breaking API changes without versioning
- [ ] Feature can be rolled back without data loss
- [ ] Environment variables documented if new ones added

3. **Report** — Write a structured summary and save it to \`.claude/dod-result.md\`:

\`\`\`markdown
## Definition of Done — [Feature/Fix name]
Date: YYYY-MM-DD

### Results
| Category | Pass | Fail | N/A |
|----------|------|------|-----|
| Code quality | X | Y | Z |
| Tests | ... | ... | ... |
| Documentation | ... | ... | ... |
| Security & permissions | ... | ... | ... |
| Observability | ... | ... | ... |
| User experience | ... | ... | ... |
| Rollout readiness | ... | ... | ... |

### Failures requiring action
1. [item] — [what needs to happen]
2. ...

### Verdict
COMPLETE — all items pass or N/A
  OR
INCOMPLETE — N items require action before this is done
\`\`\`

4. **Write the result file** — Save the full report above to \`.claude/dod-result.md\`. The VS Code extension reads this file to show green/amber status in the sidebar checklist.

## Notes
- N/A is valid — not every change touches UI or API
- A bug fix may not need swagger updates — mark N/A with reason
- If the project has a custom .claude/definition-of-done.json, use those items instead of the defaults above
`;

// ── Capture pattern ─────────────────────────────────────────────────────────

export const CAPTURE_PATTERN_SKILL = `---
name: capture-pattern
description: Extract a reusable pattern from the codebase and add it to patterns-library.md. Covers API endpoints, form handling, auth, async jobs, error responses, and more.
---

You are maintaining the project's patterns library — a reference of "this is how we do X" that prevents reinvention and improves consistency.

## Steps

1. **Identify the pattern** — Look at recent work (last 5 instruction-history entries) or scan the area the user specifies. Find a pattern worth documenting:
   - API endpoint pattern (route + validation + handler + response)
   - Form handling (schema + form + mutation + toast)
   - Auth and permission checks
   - Async job handling
   - Retry and idempotency
   - Audit logging
   - Error response format
   - Data fetching (useQuery pattern)
   - File upload handling
   - Webhook handling
   - Scheduled job pattern
   - Test writing pattern

2. **Read existing library** — Read \`patterns-library.md\` if it exists. Check this pattern isn't already documented.

3. **Write the pattern** using this format:

\`\`\`markdown
### PAT-NNN: [Pattern name]
**Category**: API | UI | Data | Auth | Jobs | Testing | Integration
**Added**: YYYY-MM-DD
**Example source**: [file path where this pattern is well-implemented]

**When to use**: [1-2 sentences on when this pattern applies]

**Template**:
\\\`\\\`\\\`typescript
// Minimal working example with comments on what to customise
\\\`\\\`\\\`

**Key rules**:
- [rule 1]
- [rule 2]

**Anti-patterns** (don't do this):
- [what to avoid and why]
\`\`\`

4. **Number sequentially** and save to \`patterns-library.md\`.

## Notes
- Keep examples minimal — show the pattern, not a full feature
- Always include an "anti-patterns" section — this is where the most value is
- Reference design-standards.md for UI patterns; this file is for code patterns
- If you find an existing pattern that's outdated, update it (add "Updated: date")
`;

// ── Log failure mode ────────────────────────────────────────────────────────

export const LOG_FAILURE_SKILL = `---
name: log-failure
description: Add an entry to failure-modes.md — the "when X happens, check Y first" troubleshooting guide. Captures deployment failures, env issues, auth breakages, cache problems, and more.
---

You are maintaining the project's failure modes guide — the first place anyone should look when something breaks.

## Steps

1. **Identify the failure** — From recent work, a bug fix, or the user's description. What went wrong and what was the root cause?

2. **Read existing guide** — Read \`failure-modes.md\` if it exists. Check this failure isn't already documented.

3. **Write the entry** using this format:

\`\`\`markdown
### FM-NNN: [Short symptom description]
**Category**: Deployment | Environment | Auth | Frontend | Backend | Database | Queue/Jobs | Email/Webhook | Cache | External Service
**Severity**: Critical | High | Medium | Low
**Added**: YYYY-MM-DD
**Last seen**: YYYY-MM-DD

**Symptoms**: [What the user/developer sees — error messages, broken UI, etc.]

**Root cause**: [What actually goes wrong underneath]

**Diagnosis steps**:
1. Check [specific thing] first
2. Look at [specific log/file/service]
3. Verify [specific config/env var]

**Fix**:
\\\`\\\`\\\`bash
# Exact commands or steps to resolve
\\\`\\\`\\\`

**Prevention**: [How to stop this happening again — config, test, alert]
**Related**: [links to decisions, history entries, or other failure modes]
\`\`\`

4. **Number sequentially** and save to \`failure-modes.md\`.

## When to run this skill
- After fixing any bug that took more than 15 minutes to diagnose
- After a deployment issue
- After discovering an environment or config problem
- When you find yourself saying "oh, this again"

## Notes
- "Diagnosis steps" is the most valuable part — optimise for speed of diagnosis
- Include exact error messages in "Symptoms" so people can search for them
- "Prevention" should be actionable — a specific test, alert, or config change
`;

// ── Release notes ───────────────────────────────────────────────────────────

export const RELEASE_NOTES_SKILL = `---
name: release-notes
description: Generate release notes from recent instruction-history.toon entries. Covers user-visible changes, config requirements, migrations, feature flags, and rollback steps.
---

You are generating release notes for the next deployment.

## Steps

1. **Find the range** — Read \`instruction-history.toon\`. Find all entries since the last release (look for the last \`release-notes\` entry or ask the user for the starting entry ID).

2. **Read release-notes.md** if it exists — understand the format used for previous releases.

3. **Categorise changes** from the history entries:
   - **New features** (type: Feature addition)
   - **Improvements** (type: Enhancement, Update)
   - **Bug fixes** (type: Bug fix)
   - **Breaking changes** (anything that changes API contracts, env vars, or data models)
   - **Internal** (Refactoring, Configuration — may not be user-facing)

4. **Check for operational requirements**:
   - New environment variables? (grep for \`process.env.\` or \`import.meta.env.\` in changed files)
   - Database migrations? (check azure-schema-sync.sql for recent additions)
   - Feature flags? (grep for feature flag patterns)
   - Third-party config changes? (new Twilio numbers, Stripe keys, etc.)

5. **Write the release entry** using this format:

\`\`\`markdown
## Release YYYY-MM-DD
**Entries**: #NNN – #NNN
**Deploy type**: Standard | Migration required | Config change required

### User-visible changes
- [change description — written for a product person, not a developer]

### Bug fixes
- [what was broken → what is fixed]

### Breaking changes
- [what changed and what action is needed]

### Operational requirements
| Requirement | Detail |
|-------------|--------|
| Env vars | [new/changed vars] |
| Migrations | [SQL to run — or "none"] |
| Config | [any config changes] |
| Feature flags | [flags to enable/disable] |

### Rollback plan
- [specific steps to revert if something goes wrong]
- [data considerations — can you roll back without data loss?]

### Post-deploy verification
- [ ] [specific thing to check after deploy]
- [ ] [another check]
\`\`\`

6. **Prepend** to \`release-notes.md\` (newest at top).

## Notes
- Write user-visible changes for a product audience, not developers
- Always include rollback steps — even if it's "revert the commit"
- If migration is required, specify whether it's backwards-compatible
`;

// ── Log tech debt ────────────────────────────────────────────────────────────

export const LOG_DEBT_SKILL = `---
name: log-debt
description: Add an entry to tech-debt.md — a specific register of technical debt with impact, effort, and trigger for when it must be addressed.
---

You are maintaining the project's technical debt register — not a vague backlog but a specific, actionable list.

## Steps

1. **Identify the debt** — From recent work, a shortcut taken, or a pattern that's degrading. Be specific.

2. **Read existing register** — Read \`tech-debt.md\` if it exists. Check this item isn't already tracked.

3. **Write the entry** using this format:

\`\`\`markdown
### TD-NNN: [Short description]
**Category**: Architecture | Code quality | Testing | Performance | Security | Dependencies | Infrastructure
**Added**: YYYY-MM-DD
**Priority**: Critical | High | Medium | Low
**Status**: Open | In progress | Resolved (YYYY-MM-DD)

**Why it exists**: [The reason this shortcut was taken — deadline, scope, complexity]
**Current impact**: [What pain does this cause right now? Slow builds? Fragile tests? Manual work?]
**Risk if left**: [What happens if this is never addressed? Data loss? Security? Scaling failure?]
**Effort to fix**: [T-shirt size: S/M/L/XL + rough description of what's involved]
**Trigger for action**: [When must this be fixed? "Before we add a 3rd payment provider" / "When we exceed 100 tenants"]
**Files affected**: [specific paths]
**Related decisions**: [DEC-NNN if a decision created this debt]
\`\`\`

4. **Number sequentially** and save to \`tech-debt.md\`.

## When to run this skill
- When you take a known shortcut to meet a deadline
- When you see a pattern that will break at scale
- When a library is outdated and blocking upgrades
- When tests are fragile or flaky
- After a bug fix that was harder than it should have been

## Notes
- "Trigger for action" is the key field — it turns vague debt into a decision point
- Update status when debt is resolved — don't delete entries, mark them resolved
- Review quarterly — if a debt item has been Low/Open for 6 months, either fix it or delete it
`;

// ── Post-implementation review ──────────────────────────────────────────────

export const POST_REVIEW_SKILL = `---
name: post-review
description: Capture a post-implementation review after meaningful work. Records what slowed you down, what caused ambiguity, what was missing, and what should become standard next time.
---

You are conducting a lightweight post-implementation review. This captures learnings that compound delivery speed over time.

## Steps

1. **Identify the work** — Read the last 10 entries in \`instruction-history.toon\`. Identify the feature or fix being reviewed.

2. **Read existing reviews** — Read \`post-reviews.md\` if it exists.

3. **Analyse the work** — Look at:
   - How many instruction-history entries did this feature span?
   - Were there bug fixes immediately after the feature? (indicates gaps)
   - Were there multiple attempts at the same thing? (indicates ambiguity)
   - What files were touched most? (indicates complexity hotspots)

4. **Write the review** using this format:

\`\`\`markdown
### PIR-NNN: [Feature/fix name]
**Date**: YYYY-MM-DD
**Entries**: #NNN – #NNN
**Elapsed**: [how many sessions/days this spanned]

**What went well**:
- [thing that worked smoothly]

**What slowed us down**:
- [specific blocker or friction point]

**What caused ambiguity**:
- [unclear requirement, missing spec, conflicting patterns]

**What was missing from docs/process**:
- [a pattern that should have been documented]
- [a failure mode that should have been in the guide]

**What should become standard**:
- [ ] [action: add pattern to patterns-library.md]
- [ ] [action: add failure mode to failure-modes.md]
- [ ] [action: update definition of done]
- [ ] [action: add to agent playbooks]

**Metrics**:
- Sessions: N
- Bug fixes immediately after: N
- Files touched: N
- Tests added: N
\`\`\`

5. **Save** to \`post-reviews.md\`.
6. **Action the "should become standard" items** — If any are clear and quick, do them now. Otherwise, note them for the next session.

## When to run this skill
- After completing any feature that took more than 3 sessions
- After a bug fix that was harder than expected
- After any work where you thought "this should have been easier"

## Notes
- Keep it honest and specific — "it was hard" is not useful; "the permission system was undocumented so I had to read 4 files" is useful
- The "should become standard" section is where compounding happens
`;

// ── Update agent playbooks ──────────────────────────────────────────────────

export const UPDATE_PLAYBOOKS_SKILL = `---
name: update-playbooks
description: Update agent-playbooks.md — the reference for how to use AI agents effectively in this project. Covers prompt templates, expected outputs, agent selection, context needs, and validation steps.
---

You are maintaining the project's AI agent playbooks — the guide for getting consistent, high-quality results from AI tools.

## Steps

1. **Read existing playbooks** — Read \`agent-playbooks.md\` if it exists.

2. **Read recent history** — Look at the last 20 entries in \`instruction-history.toon\` to identify:
   - Which agents were used (type: agent_task)
   - What patterns worked well
   - What failed or needed retry

3. **Read agent definitions** — If \`.claude/agents/\` exists, read the agent files to understand what's available.

4. **Update the playbooks** covering these sections:

\`\`\`markdown
# Agent Playbooks
_Last updated: YYYY-MM-DD_

## Agent selection guide
| Task type | Best agent | Why |
|-----------|-----------|-----|
| ... | ... | ... |

## Standard prompt templates

### Template: [name]
**Use for**: [when to use this template]
**Agent**: [which agent to use]
\\\`\\\`\\\`
[The actual prompt template with {{placeholders}}]
\\\`\\\`\\\`
**Expected output**: [what good output looks like]
**Validation**: [how to check the output is correct]

## Context each agent needs
| Agent | Must read first | Must know |
|-------|----------------|-----------|
| ... | ... | ... |

## Common failure patterns
| Symptom | Cause | Fix |
|---------|-------|-----|
| Agent changes wrong file | Missing context | Provide file path explicitly |
| ... | ... | ... |

## Validation checklist for AI-produced work
- [ ] Code compiles
- [ ] No \`any\` typing introduced
- [ ] company_id scoping on queries
- [ ] Tests still pass
- [ ] No hardcoded role checks
- [ ] Follows patterns-library.md
\`\`\`

5. **Save** to \`agent-playbooks.md\`.

## Notes
- Keep prompt templates practical — include the actual prompt text, not just a description
- "Common failure patterns" is high-ROI — every pattern saved here prevents a retry
- Update after any session where an agent produced wrong output
`;

// ── All skill templates for scaffolding ──────────────────────────────────────

export interface SkillTemplate {
  name: string;
  category: 'workflow' | 'api' | 'capture' | 'generate';
  content: string;
}

export const ALL_SKILL_TEMPLATES: SkillTemplate[] = [
  // Workflow
  { name: 'update-tests',       category: 'workflow', content: UPDATE_TESTS_SKILL },
  { name: 'update-uat',         category: 'workflow', content: UPDATE_UAT_SKILL },
  { name: 'regression',         category: 'workflow', content: REGRESSION_SKILL },
  { name: 'sync-design',        category: 'workflow', content: SYNC_DESIGN_SKILL },
  { name: 'done-check',         category: 'workflow', content: DONE_CHECK_SKILL },
  { name: 'update-observability', category: 'workflow', content: UPDATE_OBSERVABILITY_SKILL },

  // API
  { name: 'audit-api',     category: 'api', content: AUDIT_API_SKILL },
  { name: 'sync-api-docs', category: 'api', content: SYNC_API_DOCS_SKILL },

  // Capture
  { name: 'log-decision',    category: 'capture', content: LOG_DECISION_SKILL },
  { name: 'capture-pattern', category: 'capture', content: CAPTURE_PATTERN_SKILL },
  { name: 'log-failure',     category: 'capture', content: LOG_FAILURE_SKILL },
  { name: 'log-debt',        category: 'capture', content: LOG_DEBT_SKILL },

  // Generate
  { name: 'release-notes',    category: 'generate', content: RELEASE_NOTES_SKILL },
  { name: 'post-review',      category: 'generate', content: POST_REVIEW_SKILL },
  { name: 'update-playbooks', category: 'generate', content: UPDATE_PLAYBOOKS_SKILL },
];

/** Only templates that ship content (workflow skills are project-specific). */
export function getScaffoldableTemplates(): SkillTemplate[] {
  return ALL_SKILL_TEMPLATES.filter(t => t.content.length > 0);
}

// ── Profile-adaptive scaffolding ─────────────────────────────────────────────

import type { ProjectProfile } from './envAssessment';

/**
 * Adapt template content based on project profile.
 * Replaces generic references with project-specific values.
 */
export function adaptContent(content: string, profile: ProjectProfile): string {
  let result = content;

  // 1. Package manager commands
  if (profile.testCommand && profile.testCommand !== 'npm test') {
    result = result.replace(/`npm run test`/g, `\`${profile.testCommand}\``);
    result = result.replace(/`npm test`/g, `\`${profile.testCommand}\``);
    result = result.replace(/\bnpm run test\b/g, profile.testCommand);
  }
  if (profile.checkCommand) {
    result = result.replace(/`npm run check`/g, `\`${profile.checkCommand}\``);
  }
  if (profile.lintCommand) {
    result = result.replace(/`npm run lint`/g, `\`${profile.lintCommand}\``);
  }

  // 2. Swagger format
  if (profile.swaggerFormat === 'typescript' && profile.swaggerDir) {
    result = result.replace(
      /note style \(YAML\/JSON, OpenAPI 3\.x vs 2\.x\)/g,
      `note style (TypeScript code-first in \`${profile.swaggerDir}/\`)`
    );
    result = result.replace(
      /create `swagger\/paths\/` \+ `swagger\/openapi\.yaml`/g,
      `add TypeScript path modules to \`${profile.swaggerDir}/paths/\``
    );
    result = result.replace(
      /YAML or JSON/g,
      'TypeScript code-first'
    );
  }

  // 3. Agent structure — directory vs single file
  if (profile.agentStructure === 'directory' && profile.existingAgents.length > 0) {
    result = result.replace(
      /Save to `agent-playbooks\.md`/g,
      'Update the relevant agent file in `.claude/agents/`'
    );
    result = result.replace(
      /Read `agent-playbooks\.md` if it exists/g,
      'Read agent definitions from `.claude/agents/` directory'
    );
    result = result.replace(
      /If `\.claude\/agents\/` exists, read the agent files/g,
      `Read the ${profile.existingAgents.length} agent files in \`.claude/agents/\``
    );
  }

  // 4. Release notes → CHANGELOG equivalence
  const changelogDoc = profile.livingDocs.find(
    d => d.expectedName === 'release-notes.md' && d.status === 'equivalent'
  );
  if (changelogDoc?.actualPath) {
    const filename = changelogDoc.actualPath;
    result = result.replace(/release-notes\.md/g, filename);
    result = result.replace(/`release-notes\.md`/g, `\`${filename}\``);
  }

  // 5. Test config path
  if (profile.testConfigPath) {
    result = result.replace(
      /jest\.config\.\*/g,
      profile.testConfigPath
    );
  }

  return result;
}

/**
 * Returns adapted templates filtered to only skills that are missing.
 * Custom skills (content differs from template) are never overwritten.
 */
export function getScaffoldableForProfile(profile: ProjectProfile): SkillTemplate[] {
  const missingNames = new Set(
    profile.existingSkills
      .filter(s => s.status === 'missing')
      .map(s => s.name)
  );

  return getScaffoldableTemplates()
    .filter(t => missingNames.has(t.name))
    .map(t => ({
      ...t,
      content: adaptContent(t.content, profile),
    }));
}
