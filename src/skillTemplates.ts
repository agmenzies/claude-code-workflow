/**
 * skillTemplates.ts
 *
 * Template content for the two API skills.
 * Written to .claude/skills/ when the user runs "Scaffold API Skills".
 * Generic enough to work with any Express/Node project.
 * Projects can customise the written files after scaffolding.
 */

export const AUDIT_API_SKILL = `---
name: audit-api
description: Audit all API routes for standards compliance — authentication, rate limiting, input validation, consistent error format, and OpenAPI documentation coverage. Writes results to .claude/api-audit.json so the VS Code extension can show inline diagnostics.
---

You are auditing the API routes in this codebase for standards compliance.

## Steps

1. **Find all route files** — Look in the most likely locations:
   \`server/routes/\`, \`src/routes/\`, \`routes/\`, \`app/routes/\`
   List every file found.

2. **Find authentication middleware** — Identify what the project uses for auth:
   - Common names: \`authenticate\`, \`authenticateToken\`, \`requireAuth\`, \`verifyJWT\`, \`protect\`
   - Check server/index.ts, server/routes.ts, or equivalent for global middleware
   - Note any router-level auth applied in the route files

3. **Find rate limiting middleware** — Identify the rate limiter:
   - Common names: \`rateLimit\`, \`limiter\`, \`rateLimiter\`, \`slowDown\`, \`apiLimiter\`
   - Note if it's applied globally or per-route

4. **Find input validation** — Identify the validation approach:
   - Zod: \`.parse(\`, \`.safeParse(\`, \`z.object(\`
   - Joi/Celebrate: \`celebrate(\`, \`Joi.object\`
   - express-validator: \`body(\`, \`validationResult\`

5. **Find OpenAPI/Swagger docs** — Look in \`server/swagger/\`, \`swagger/\`, \`openapi/\`, \`docs/api/\`

6. **Audit each route** — For each route handler found, check:
   - [ ] Authentication middleware present (or intentionally public)
   - [ ] Rate limiting applied (especially on auth endpoints and public-facing routes)
   - [ ] Input validation on POST/PUT/PATCH routes
   - [ ] Consistent error response format (e.g. \`{ error: string }\` or \`{ message: string }\`)
   - [ ] Documented in Swagger/OpenAPI
   - [ ] company_id scoping if this is a multi-tenant app

7. **Write results** — Write the audit results to \`.claude/api-audit.json\` with this exact structure:

\`\`\`json
{
  "auditedAt": "<ISO 8601 UTC timestamp>",
  "issues": [
    {
      "file": "server/routes/users.ts",
      "line": 15,
      "method": "GET",
      "path": "/api/users",
      "rule": "missing-auth",
      "severity": "error",
      "message": "Route has no authentication middleware"
    }
  ],
  "summary": {
    "totalRoutes": 0,
    "documented": 0,
    "withAuth": 0,
    "withRateLimit": 0
  }
}
\`\`\`

**Valid rule values**: \`missing-auth\`, \`missing-rate-limit\`, \`missing-validation\`, \`missing-swagger\`, \`no-error-handler\`, \`inconsistent-response\`
**Valid severity values**: \`error\`, \`warning\`, \`info\`

8. **Report** — After writing the file, summarise:
   - Total routes found
   - Issues by severity
   - Top 3 most urgent fixes

## Standards

- Auth endpoints (/login, /register, /forgot-password) → auth not required, but rate limiting IS required
- Public read endpoints → auth not required, document why
- All other endpoints → auth required
- POST/PUT/PATCH on any endpoint → input validation required
- Any endpoint callable by unauthenticated users → rate limiting required

## Notes
- Do not auto-fix issues — report them only
- If a route is intentionally public, note it as \`severity: "info"\` not \`"error"\`
- The JSON file is read by the Claude Code Workflow VS Code extension to show inline diagnostics
`;

export const SYNC_API_DOCS_SKILL = `---
name: sync-api-docs
description: Generate or update Swagger/OpenAPI documentation for routes that are missing coverage. Reads existing docs to match style, then adds missing path entries. Run after adding new API routes.
---

You are the API documentation maintainer. Your job is to ensure every route is documented in the project's Swagger/OpenAPI files.

## Steps

1. **Discover route files** — Find all route handlers in the codebase:
   - \`server/routes/\`, \`src/routes/\`, \`routes/\`, \`app/routes/\`
   - List each file and the routes it defines (method + path)

2. **Read existing Swagger docs** — Find and read all files in:
   - \`server/swagger/\`, \`swagger/\`, \`openapi/\`, \`docs/api/\`
   - Note which paths are already documented
   - Note the style used (YAML or JSON, OpenAPI 3.x vs Swagger 2.x, indentation, component ref style)

3. **Load deep audit results** (if present) — Read \`.claude/api-audit.json\` and use the \`missing-swagger\` issues as the priority list.

4. **Identify gaps** — List every route that:
   - Has no corresponding path entry in any swagger file
   - Or has a path entry but is missing request body / response schemas

5. **Generate documentation** — For each undocumented route:
   - Match the style and file structure of existing docs
   - Add \`summary\`, \`description\`, \`parameters\` (path params, query params), \`requestBody\` (for POST/PUT/PATCH), and \`responses\` (at minimum 200 and 401 for auth-required routes, 200 and 400 for validation routes)
   - Use \`$ref\` to reference shared schemas from \`components/schemas\` where patterns already exist
   - Add appropriate \`tags\` matching existing tag names

6. **Write updated files** — Update the swagger files in-place. Do not create new files unless no swagger directory exists yet. If no swagger directory exists, create \`swagger/paths/\` and \`swagger/openapi.yaml\`.

7. **Verify** — After writing, list which routes are now documented and which (if any) still need manual attention (e.g. routes with complex dynamic behaviour).

8. **Update audit file** — If \`.claude/api-audit.json\` exists, update the \`documented\` count in the summary and remove resolved \`missing-swagger\` issues.

## Standards

- Use **OpenAPI 3.x** format unless the project already uses Swagger 2.x
- Security schemes: document auth-required routes with \`security: [{ bearerAuth: [] }]\`
- Error responses must document \`400\` (validation error), \`401\` (not authenticated), \`403\` (not authorised), \`404\` (not found) where applicable
- Response schemas should use proper types — never \`object\` with no properties
- Rate-limited endpoints: add a note in \`description\` if the endpoint has rate limiting

## Output

End with a summary table:
| Route | Method | Status |
|-------|--------|--------|
| /api/... | GET | Documented |
| /api/... | POST | Needs manual schema — too complex |
`;
