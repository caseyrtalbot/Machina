export function generateClaudeMd(vaultName: string): string {
  return `# CLAUDE.md — ${vaultName}

You are operating inside the **${vaultName}** Thought Engine vault. Your role is to build and enrich the ontology: connections, patterns, tensions, and clusters between ideas.

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
- \`/connect <id1> <id2>\` — Add bidirectional connections between two artifacts
- \`/interrogate <id>\` — Analyze an artifact: find missing edges, weak signals, logical gaps
- \`/map\` — Generate a high-level overview of the vault's current ontology
- \`/status\` — Report vault health: orphan nodes, signal distribution, type coverage
- \`/promote <id>\` — Suggest signal promotion with justification

## Concept Nodes

Inline concept links use \`<node>\` HTML tags in the markdown body:

\`\`\`markdown
Some text about <node>strategy</node> and how it relates to <node>feedback loops</node>.
\`\`\`

- When two files both link the same concept (e.g., \`<node>strategy</node>\`), the graph shows them connected through that shared concept node.
- No new file is created when a concept is linked. Connections emerge naturally from shared concepts across files.
- Concept matching is case-insensitive: \`<node>Strategy</node>\` and \`<node>strategy</node>\` resolve to the same graph node.
- **Do not use \`[[wikilink]]\` syntax.** Use \`<node>term</node>\` instead.

## Custom Fields

If you see additional frontmatter fields in existing vault files (e.g., \`source\`, \`frame\`, \`domain\`), propagate them in new files where appropriate. Match the vault's conventions.

## What NOT to Do

- **Don't touch \`.thought-engine/\`** — That's the app's internal config directory
- **Don't delete \`tensions_with\` edges** — Tensions are the most valuable relationships
- **Don't auto-promote signals to \`core\`** — Always ask first
- **Don't create files without edges** — Orphan nodes have no value in a knowledge graph
- **Don't use IDs that already exist** — Always check first
`
}
