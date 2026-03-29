# Session Audit Report — 2026-03-29

## Scope

7 commits, 17 files changed, 3 features:
1. Terminal Dock (center-float canvas status bar)
2. Ghost MCP (`graph.get_ghosts` tool)
3. Canvas lazy-creation bugfix

## Integration Verification: PASS

| Check | Result |
|-------|--------|
| `npm run lint` | 0 errors, 1 pre-existing warning |
| `npm run typecheck` (node + web) | Clean |
| `npm test` | 1221/1221 passed, 0 failed |
| `npm run build` | Clean (main 201ms, preload 6ms, renderer 5.95s) |

## Quality Audit: PASS (after fixes)

**Spec compliance**: Both Terminal Dock and Ghost MCP implementations match their specs.

**Issues found and resolved**:
1. Idle dot color used hardcoded `'#3dca8d'` instead of `colors.semantic.cluster` token — fixed
2. Test description said "3 read-only tools" but assertion expected 4 — fixed

**Deferred suggestions** (cosmetic, not blocking):
- Collapsed pill lacks explicit 28px height (derived from content)
- Expanded bar padding is 8px not 4px (likely intentional for visual balance)
- FileTree.tsx glow effect is unrelated scope creep from a prior commit

## Security Audit: MEDIUM RISK

### Findings

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| H1 | HIGH | SessionId flows unvalidated into tmux `-t` flag. Polling enlarges the attack window. | **Pre-existing** — not introduced this session, but polling makes it more prominent. Fix recommended. |
| M1 | MEDIUM | Ghost context snippets could carry prompt injection fragments. Spotlighting mitigates but defense-in-depth sanitization recommended. | Acknowledged — Spotlighting is primary defense. |
| M2 | MEDIUM | `GhostReference.filePath` field name is misleading (holds ghost ID, not a real path). | Acknowledged — naming issue, not a vulnerability. |
| M3 | MEDIUM | Canvas lazy-write constructs path via string interpolation without absolute-path check. PathGuard catches it at IPC layer. | Defense-in-depth gap. |
| L1 | LOW | localStorage key lacks namespace convention consistency. | No action needed. |
| L2 | LOW | `mcp-cli.ts` vault path not validated as directory before indexing. | Minor UX improvement. |

### Confirmed Safe

- `graph.get_ghosts` is verified read-only (no write path)
- Spotlighting boundary escape prevention is correct
- Terminal Dock polling uses existing IPC surface (no new channels)
- No hardcoded secrets, no XSS vectors, no SQL injection

### Recommended Priority Fixes

1. **H1**: Add sessionId format validation (`/^[a-zA-Z0-9_-]{1,64}$/`) in `shell.ts` IPC handler
2. **M1**: Add context snippet sanitization in `buildGhostIndex` (defense-in-depth)
3. **M3**: Add absolute-path guard before canvas file creation

## Summary

| Category | Verdict |
|----------|---------|
| Integration | **PASS** — 1221 tests, build clean |
| Quality | **PASS** — spec compliant, 2 minor fixes applied |
| Security | **MEDIUM** — 1 high (pre-existing, amplified), 3 medium (defense-in-depth). No critical vulnerabilities. |

**Overall**: PASS with security follow-ups recommended.
