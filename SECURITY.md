# Security

Machina runs agents and terminal commands with the current user's OS privileges.
Its approval queue provides review and attribution; it is not an OS sandbox for
third-party CLIs. Only open trusted workspaces and run trusted harnesses.

Do not put credentials, private vault content, or exploit instructions in public
issues. Arrange private disclosure with the repository maintainer before sharing
sensitive details. There is no guaranteed response SLA.

## Verification

Use Node.js 24 and `npm ci`. Run `npm run check`, `npm run build`, and
`npm audit --audit-level=high` before release. The security workflow runs these
checks on pushes, pull requests, and weekly. Dependabot checks npm dependencies
and pinned GitHub Actions weekly. The workflow must land on the default branch
before its scheduled runs become active.

## Security baseline — 2026-11-11

This hardening batch:

- Updates Electron to 45.3.0 and refreshes vulnerable dependencies. The npm audit
  snapshot fell from 52 affected packages (including two critical and 22 high)
  to 14 (two low, 12 moderate; zero high or critical). Counts describe dependency
  advisories, not confirmed exploitable application vulnerabilities.
- Applies the MCP SDK's opt-in 10,000-element tool-input budget and a 1 MiB HTTP
  request-body limit. Oversized requests fail before tool execution.
- Checks each folder-map descendant through the path guard; skips symlinks and
  special files. Sensitive names are denied case-insensitively, and both the
  requested path and resolved symlink target are checked.
- Blocks document-initiated navigation and redirects, including `file:`, `data:`,
  and custom protocols. External HTTP(S) links still open through the OS browser.

The remaining audit findings are minimatch and affected build/lint dependents
(12 moderate), plus KaTeX and Mermaid (two low). They remain visible in audit
output. The CI threshold fails on high/critical findings; it does not suppress
lower-severity findings. Resolve these through compatible upstream upgrades or
separately verified migrations; do not force unrelated transitive major versions.

Verification for this batch: lint and both TypeScript checks passed; 4,144 tests
passed across 337 files; the production build passed. An isolated-profile smoke
check launched Electron 45.3.0, rendered onboarding, blocked a local-file link,
and spawned a native PTY successfully. This is not a full packaged-app regression
or a signed release test.

## Next security work

1. Remove worker Node integration and migrate the main preload to the sandbox's
   supported API subset. Validate graph, parsing, terminal, and PDF workers in
   the packaged app. The main window currently has `sandbox: false`.
2. Authenticate IPC senders and validate runtime request shapes, with separate
   capabilities for the main renderer and terminal webview. Typed IPC alone is
   not a runtime security boundary. Validate the webview source as well as preload.
3. Make filesystem operations resistant to concurrent symlink replacement. The
   path guard's check followed by asynchronous I/O is not an atomic OS boundary.
   Revalidate canvas writes after approvals and within their serialization queue.
4. Bound folder-map traversal depth, file count, and bytes read; output node limits
   currently do not bound the filesystem scan. Add MCP session quotas/expiry.
5. Verify signed/notarized distribution, updater policy, Electron fuses, and
   permission handlers before promoting a public desktop release.

## Agent-native direction

Keep agent actions behind explicit capabilities with inspectable inputs,
provenance, resource budgets, cancellation, and reversible changes. Close the
security boundaries above before adding more autonomous tools. Keep local files
portable and the headless MCP surface read-only until it has an approval authority.

References: [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security),
[MCP input-budget advisory](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-46jr-4wx8-v453).
