import { TE_DIR } from '@shared/constants'

export function generateClaudeMd(vaultName: string): string {
  return `# CLAUDE.md — ${vaultName}

You are operating inside the **${vaultName}** Machina vault. Your role is to build and enrich the ontology: connections, patterns, tensions, and clusters between ideas.

## The One Rule

Every \`.md\` file you create or edit must have YAML frontmatter with at least \`id\`, \`title\`, and relationship edges. No exceptions.

## Frontmatter Contract

\`\`\`yaml
---
id: <prefix><number>        # e.g. g17, c03, p01
title: <human-readable>
type: <string>               # see Type System below
created: YYYY-MM-DD
modified: YYYY-MM-DD
signal: untested|emerging|validated|core
tags: []
connections: []              # neutral relatedness
clusters_with: []            # mutual reinforcement
tensions_with: []            # productive contradiction
appears_in: []               # composition/containment
---
\`\`\`

Required fields: \`id\`, \`title\`. Everything else has sensible defaults (type defaults to \`note\`, signal defaults to \`untested\`).

## Edge Semantics

| Edge | Meaning | When to use |
|------|---------|-------------|
| \`connections\` | Neutral relatedness | "These ideas touch the same territory" |
| \`clusters_with\` | Mutual reinforcement | "These ideas strengthen each other" |
| \`tensions_with\` | Productive contradiction | "These ideas pull in different directions" — the most valuable edge |
| \`appears_in\` | Composition | "This is a building block of that" |

Edges are always arrays of artifact IDs (e.g., \`connections: [g13, c01]\`). Both directions matter: if A connects to B, B should connect to A.

## Signal Levels

| Signal | Meaning | Promotion rule |
|--------|---------|----------------|
| \`untested\` | New idea, unverified | Default for new artifacts |
| \`emerging\` | Shows promise, needs evidence | Promote when edges form |
| \`validated\` | Proven through multiple connections | Promote when cluster emerges |
| \`core\` | Foundational to the vault's thesis | Promote only with user approval |

Never auto-promote to \`core\`. Suggest promotions, let the user decide.

## Type System

Built-in types and their ID prefixes:
- \`gene\` (g) — atomic ideas, insights, mental models
- \`constraint\` (c) — boundaries, limitations, rules
- \`research\` (r) — evidence, data, external sources
- \`output\` (o) — deliverables, artifacts, creations
- \`note\` (n) — general purpose, default type
- \`index\` (i) — maps, overviews, collections

**You are not limited to these types.** Use domain-specific vocabulary when it fits:
- \`pattern\`, \`doctrine\`, \`principle\`, \`question\`, \`tension\`, \`framework\`
- Match what already exists in the vault; invent new types when the vault needs them

When using a custom type, pick a short prefix (1-2 chars) that doesn't collide with existing ones.

## File Creation Workflow

1. **Scan** — Read existing files to learn conventions, types, and edge patterns
2. **Pick ID** — Check existing IDs to avoid collisions. Use the type prefix + next available number
3. **Find edges** — Every new file should connect to at least one existing artifact
4. **Write atomically** — Complete frontmatter + body in a single write

## Vault Commands

When the user asks you to:
- \`/connect-vault\` — Analyze vault files and discover connections/tensions. **Uses incremental processing** (see below).
- \`/connect <id1> <id2>\` — Add bidirectional connections between two artifacts
- \`/interrogate <id>\` — Analyze an artifact: find missing edges, weak signals, logical gaps
- \`/map\` — Generate a high-level overview of the vault's current ontology
- \`/status\` — Report vault health: orphan nodes, signal distribution, type coverage
- \`/promote <id>\` — Suggest signal promotion with justification

### Incremental /connect-vault

The manifest at \`${TE_DIR}/connect-manifest.json\` tracks which files have been analyzed and their content hashes.

**First run** (no manifest): Analyze all files. Write the manifest when done.

**Subsequent runs**: Read the manifest. Only analyze:
1. **New files** — not in the manifest
2. **Changed files** — content hash differs from manifest
3. **Skip unchanged files** — hash matches, already analyzed

When analyzing incrementally, read \`${TE_DIR}/graph-summary.txt\` (if it exists) to understand the existing vault structure without re-reading every file. Place new nodes relative to the existing graph.

After analysis, update the manifest with the new hashes and timestamp.

To force a full re-scan, delete \`${TE_DIR}/connect-manifest.json\` and run \`/connect-vault\` again.

## Inline Links

Two syntaxes are supported for connecting ideas in body text:

**Wikilinks** — direct edges between files:
\`\`\`markdown
Naval recommends [[The Book of Secrets]] for understanding meditation.
\`\`\`
Use \`[[File Title]]\` when referencing another file in the vault. The app auto-detects these as graph edges.

**Concept nodes** — shared-concept co-occurrence edges:
\`\`\`markdown
Some text about <node>strategy</node> and how it relates to <node>feedback loops</node>.
\`\`\`
Use \`<node>term</node>\` for concepts that aren't file names. When two files share the same concept tag, the graph connects them through co-occurrence.

Both create graph connections. Use wikilinks for file-to-file references, concept nodes for shared vocabulary.

## Custom Fields

If you see additional frontmatter fields in existing vault files (e.g., \`source\`, \`frame\`, \`domain\`), propagate them in new files where appropriate. Match the vault's conventions.

## First Session

When you start a new session in this vault, quickly check the state of the files:
- If most \`.md\` files lack frontmatter, proactively suggest: "I see [N] files without metadata. Want me to run /connect-vault to analyze and connect them?"
- If files have frontmatter but few edges, suggest: "Your vault has [N] files but only [M] connections. Want me to discover more relationships?"

## What NOT to Do

- **Don't touch \`${TE_DIR}/\`** — That's the app's internal config directory
- **Don't delete \`tensions_with\` edges** — Tensions are the most valuable relationships
- **Don't auto-promote signals to \`core\`** — Always ask first
- **Don't create files without edges** — Orphan nodes have no value in a knowledge graph
- **Don't use IDs that already exist** — Always check first
`
}
