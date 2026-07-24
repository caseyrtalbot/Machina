/**
 * MCP server for Machina.
 *
 * Exposes workspace content via twelve tools: vault.read_file, search.query,
 * graph.get_neighbors, graph.get_ghosts, project.map_folder, canvas.get_snapshot
 * (reads); vault.write_file, vault.create_file, canvas.apply_plan (writes gated
 * by QueueHitlGate over the approval queue + WriteRateLimiter). The three vault.* tools are also
 * registered under workspace.* aliases (workstation step 1) — same handlers,
 * with the invoked name flowing into Spotlighting envelopes and gate prompts.
 * Read tools wrap content in Spotlighting trust markers. Write tools
 * require HITL gate approval before execution.
 * Uses stdio transport for Claude Desktop integration.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { VaultQueryFacade } from './vault-query-facade'
import type { HitlGate } from './hitl-gate'
import type { WriteRateLimiter } from './hitl-gate'
import type { CanvasFile } from '@shared/canvas-types'
import type { CanvasMutationPlan } from '@shared/canvas-mutation-types'
import { applyCanvasPlanToFile } from './canvas-apply'
import { DEFAULT_PROJECT_MAP_OPTIONS, isBinaryPath } from '@shared/engine/project-map-types'
import { buildProjectMapSnapshot, type FileInput } from '@shared/engine/project-map-analyzers'
import { wrapSpotlighting } from '@shared/spotlighting'

export interface McpServerOpts {
  readonly gate?: HitlGate
  readonly rateLimiter?: WriteRateLimiter
  readonly dispatchCanvasPlan?: (plan: CanvasMutationPlan, canvasPath: string) => void
}

export function createMcpServer(facade: VaultQueryFacade, opts?: McpServerOpts): McpServer {
  const server = new McpServer(
    { name: 'machina', version: '1.0.0' },
    { capabilities: { tools: {} } }
  )

  const gate = opts?.gate
  const rateLimiter = opts?.rateLimiter

  // -- Read-only tools --

  for (const toolName of ['vault.read_file', 'workspace.read_file'] as const) {
    server.registerTool(
      toolName,
      {
        description: 'Read a file from the workspace. Content is wrapped in trust markers.',
        inputSchema: { path: z.string().describe('Absolute path to file within the workspace') }
      },
      async ({ path }) => {
        const content = await facade.readFile(path)
        const wrapped = wrapSpotlighting(toolName, path, content)
        return { content: [{ type: 'text' as const, text: wrapped }] }
      }
    )
  }

  server.registerTool(
    'search.query',
    {
      description: 'Full-text search across vault notes.',
      inputSchema: {
        query: z.string().describe('Search query'),
        limit: z.number().optional().describe('Max results (default 20)')
      }
    },
    async ({ query, limit }) => {
      const results = facade.search(query, limit)
      return { content: [{ type: 'text' as const, text: JSON.stringify(results) }] }
    }
  )

  server.registerTool(
    'graph.get_neighbors',
    {
      description: 'Get neighboring nodes and edges for a given node in the knowledge graph.',
      inputSchema: { nodeId: z.string().describe('Node ID to find neighbors for') }
    },
    async ({ nodeId }) => {
      const result = facade.getNeighbors(nodeId)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
    }
  )

  server.registerTool(
    'graph.get_ghosts',
    {
      description:
        'List unresolved wikilink references (ghost nodes). Returns ideas referenced but not yet written, sorted by reference count.',
      inputSchema: {
        includeContext: z
          .boolean()
          .optional()
          .describe('Include sentence-level context for each reference (default true)')
      }
    },
    async ({ includeContext }) => {
      const ghosts = facade.getGhosts()
      const entries =
        includeContext === false
          ? ghosts.map((g) => ({
              ...g,
              references: g.references.map(({ sourceId, fileTitle }) => ({ sourceId, fileTitle }))
            }))
          : ghosts
      const json = JSON.stringify(entries)
      const wrapped = wrapSpotlighting('graph.get_ghosts', 'ghost-index', json)
      return { content: [{ type: 'text' as const, text: wrapped }] }
    }
  )

  // -- Project / Canvas read tools --

  server.registerTool(
    'project.map_folder',
    {
      description:
        'Recursively analyze a folder and return a ProjectMapSnapshot with file nodes, directory nodes, and edges (containment, imports, references).',
      inputSchema: {
        rootPath: z.string().describe('Absolute path to the folder to map'),
        expandDepth: z.number().optional().describe('Max directory depth to expand (default 2)'),
        maxNodes: z.number().optional().describe('Max nodes to return (default 200)')
      }
    },
    async ({ rootPath, expandDepth, maxNodes }) => {
      // Enforce the vault boundary + audit before any filesystem walk.
      const resolvedRoot = facade.assertReadable(rootPath, 'project.map_folder')
      const opts = {
        ...DEFAULT_PROJECT_MAP_OPTIONS,
        ...(expandDepth !== undefined ? { expandDepth } : {}),
        ...(maxNodes !== undefined ? { maxNodes } : {})
      }

      // Recursively walk the directory
      const fileInputs: FileInput[] = []

      async function walkDir(dir: string): Promise<void> {
        const entries = await readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          const fullPath = join(dir, entry.name)
          if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '.git') continue
            await walkDir(fullPath)
          } else {
            if (isBinaryPath(fullPath)) {
              fileInputs.push({ path: fullPath, content: null, error: 'binary-skipped' })
              continue
            }
            try {
              const content = await readFile(fullPath, 'utf-8')
              fileInputs.push({ path: fullPath, content })
            } catch {
              fileInputs.push({ path: fullPath, content: null, error: 'read-failed' })
            }
          }
        }
      }

      await walkDir(resolvedRoot)

      const snapshot = buildProjectMapSnapshot(resolvedRoot, fileInputs, opts)
      const json = JSON.stringify(snapshot)
      const wrapped = wrapSpotlighting('project.map_folder', resolvedRoot, json)
      return { content: [{ type: 'text' as const, text: wrapped }] }
    }
  )

  server.registerTool(
    'canvas.get_snapshot',
    {
      description:
        'Read a canvas file and return its contents with modification time for optimistic locking.',
      inputSchema: {
        canvasPath: z.string().describe('Absolute path to the .canvas JSON file')
      }
    },
    async ({ canvasPath }) => {
      const resolved = facade.assertReadable(canvasPath, 'canvas.get_snapshot')
      const raw = await readFile(resolved, 'utf-8')
      const file: CanvasFile = JSON.parse(raw)
      const stats = await stat(resolved)
      const result = { file, mtime: stats.mtime.toISOString() }
      const json = JSON.stringify(result)
      const wrapped = wrapSpotlighting('canvas.get_snapshot', resolved, json)
      return { content: [{ type: 'text' as const, text: wrapped }] }
    }
  )

  // -- Write tools (require HITL gate) --

  if (gate) {
    for (const writeToolName of ['vault.write_file', 'workspace.write_file'] as const) {
      server.registerTool(
        writeToolName,
        {
          description:
            'Write content to an existing file in the workspace. Requires HITL approval.',
          inputSchema: {
            path: z.string().describe('Absolute path to file within the workspace'),
            content: z.string().describe('New file content (with frontmatter)'),
            expectedMtime: z.string().optional().describe('Expected mtime for optimistic locking')
          }
        },
        async ({ path, content, expectedMtime }) => {
          // Capture mtime BEFORE the gate so a user edit during the approval wait
          // is detected as a conflict, even if the agent omitted expectedMtime.
          // write_file requires the file to already exist; reject otherwise.
          let preGateMtime: string
          try {
            const fileStat = await stat(path)
            preGateMtime = fileStat.mtime.toISOString()
          } catch {
            return {
              content: [{ type: 'text' as const, text: `File not found: ${path}` }],
              isError: true
            }
          }

          const rateExceeded = rateLimiter?.isExceeded() ?? false

          const decision = await gate.confirm({
            tool: writeToolName,
            path,
            description: rateExceeded
              ? 'Write rate limit exceeded. Confirm to continue.'
              : `Write to ${path}`,
            contentPreview: content.slice(0, 200)
          })

          if (!decision.allowed) {
            return {
              content: [{ type: 'text' as const, text: `Denied: ${decision.reason}` }],
              isError: true
            }
          }

          await facade.writeFile(path, content, {
            agentId: 'mcp-agent',
            expectedMtime: expectedMtime ?? preGateMtime
          })

          rateLimiter?.record()

          return {
            content: [{ type: 'text' as const, text: `Successfully wrote to ${path}` }]
          }
        }
      )
    }

    for (const createToolName of ['vault.create_file', 'workspace.create_file'] as const) {
      server.registerTool(
        createToolName,
        {
          description: 'Create a new file in the workspace. Always requires HITL approval.',
          inputSchema: {
            path: z.string().describe('Absolute path for the new file'),
            content: z.string().describe('File content (must include frontmatter with id:)')
          }
        },
        async ({ path, content }) => {
          const rateExceeded = rateLimiter?.isExceeded() ?? false

          const decision = await gate.confirm({
            tool: createToolName,
            path,
            description: rateExceeded
              ? 'Write rate limit exceeded. Confirm to continue.'
              : `Create new file at ${path}`,
            contentPreview: content.slice(0, 200)
          })

          if (!decision.allowed) {
            return {
              content: [{ type: 'text' as const, text: `Denied: ${decision.reason}` }],
              isError: true
            }
          }

          await facade.createFile(path, content, { agentId: 'mcp-agent' })

          rateLimiter?.record()

          return {
            content: [{ type: 'text' as const, text: `Successfully created ${path}` }]
          }
        }
      )
    }

    server.registerTool(
      'canvas.apply_plan',
      {
        description:
          'Apply a CanvasMutationPlan to a canvas file. Requires HITL approval. Uses optimistic locking via expectedMtime.',
        inputSchema: {
          canvasPath: z.string().describe('Absolute path to the .canvas JSON file'),
          expectedMtime: z
            .string()
            .describe('Expected mtime from a prior canvas.get_snapshot call'),
          plan: z.object({
            id: z.string(),
            operationId: z.string(),
            source: z.enum(['folder-map', 'agent', 'expand-folder']),
            ops: z.array(z.record(z.string(), z.unknown())),
            summary: z.object({
              addedNodes: z.number(),
              addedEdges: z.number(),
              movedNodes: z.number(),
              skippedFiles: z.number(),
              unresolvedRefs: z.number()
            })
          })
        }
      },
      async ({ canvasPath, expectedMtime, plan }) => {
        // Enforce the vault boundary + audit before prompting or touching disk.
        const resolved = facade.assertReadable(canvasPath, 'canvas.apply_plan')
        const rateExceeded = rateLimiter?.isExceeded() ?? false

        const decision = await gate.confirm({
          tool: 'canvas.apply_plan',
          path: resolved,
          description: rateExceeded
            ? 'Write rate limit exceeded. Confirm to continue.'
            : `Apply ${plan.summary.addedNodes} nodes + ${plan.summary.addedEdges} edges to ${resolved}`,
          contentPreview: JSON.stringify(plan.summary)
        })

        if (!decision.allowed) {
          return {
            content: [{ type: 'text' as const, text: `Denied: ${decision.reason}` }],
            isError: true
          }
        }

        // Converge on the shared applier: optimistic-lock check, validation, and
        // the read-modify-write all happen inside the per-file queue slot, so the
        // mtime check can't be split from the write by a racing writer, AND the
        // mutation now PERSISTS main-side (the old handler only dispatched to the
        // renderer — an accepted plan for a canvas the renderer had not loaded
        // was silently dropped).
        const typedPlan = plan as unknown as CanvasMutationPlan
        const applied = await applyCanvasPlanToFile(resolved, typedPlan, { expectedMtime })
        if (!applied.ok) {
          const text =
            applied.error === 'validation'
              ? `Validation failed: ${applied.message}`
              : applied.message
          return { content: [{ type: 'text' as const, text }], isError: true }
        }

        rateLimiter?.record()

        // Sync the renderer's in-memory canvas so its debounced autosave does not
        // later clobber the just-persisted disk state with stale nodes.
        opts?.dispatchCanvasPlan?.(typedPlan, resolved)

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ accepted: true, mtime: applied.mtime })
            }
          ]
        }
      }
    )
  }

  return server
}
