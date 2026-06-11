// @vitest-environment node
/**
 * EmbedderService (3.11): store round-trip, corrupt-store fallback,
 * incremental re-embedding, and opt-in inertness. The model is faked with
 * deterministic basis vectors so tests stay offline and instant.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SearchEngine } from '@shared/engine/search-engine'
import { EMBEDDING_DIM, parseManifest } from '@shared/engine/embeddings'
import { EmbedderService, type EmbedFn } from '../embedder-service'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'te-embed-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** Basis vector along axis i, normalized by construction. */
function basis(i: number): Float32Array {
  const v = new Float32Array(EMBEDDING_DIM)
  v[i] = 1
  return v
}

/** Deterministic fake model: keyword → basis axis. Records every call. */
function fakeEmbedder(): { embedFn: EmbedFn; calls: string[][] } {
  const calls: string[][] = []
  const embedFn: EmbedFn = (texts) => {
    calls.push([...texts])
    return Promise.resolve(
      texts.map((t) =>
        t.includes('ocean') ? basis(0) : t.includes('desert') ? basis(1) : basis(2)
      )
    )
  }
  return { embedFn, calls }
}

function corpusEngine(): SearchEngine {
  const engine = new SearchEngine()
  engine.upsert({
    id: 'note-ocean',
    title: 'Tides',
    tags: [],
    body: 'the ocean moves with the moon',
    path: '/v/tides.md'
  })
  engine.upsert({
    id: 'pdf:/v/dunes.pdf#p2',
    title: 'dunes.pdf',
    tags: ['pdf'],
    body: 'desert sand stretches forever',
    path: '/v/dunes.pdf',
    page: 2
  })
  return engine
}

function makeService(embedFn: EmbedFn, debounceMs = 5): EmbedderService {
  return new EmbedderService({
    storageDir: dir,
    loadEmbedder: () => Promise.resolve(embedFn),
    debounceMs
  })
}

describe('EmbedderService', () => {
  it('stays fully inert until enabled: no embeds, no storage writes', async () => {
    const { embedFn, calls } = fakeEmbedder()
    const storage = join(dir, 'store')
    const service = new EmbedderService({
      storageDir: storage,
      loadEmbedder: () => Promise.resolve(embedFn),
      debounceMs: 0
    })
    const engine = corpusEngine()
    service.attach(engine)
    engine.upsert({ id: 'x', title: 'X', tags: [], body: 'more', path: '/v/x.md' })
    await new Promise((r) => setTimeout(r, 20))

    expect(calls).toHaveLength(0)
    expect(await service.search('ocean', 5)).toEqual([])
    await expect(access(join(storage, 'manifest.json'))).rejects.toThrow()
    expect(service.status()).toMatchObject({ enabled: false, state: 'off', docCount: 0 })
  })

  it('embeds the corpus on enable and answers cosine top-K with semantic-marked hits', async () => {
    const { embedFn } = fakeEmbedder()
    const service = makeService(embedFn)
    service.attach(corpusEngine())
    await service.setEnabled(true)

    const hits = await service.search('waves on the ocean', 1)
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({
      id: 'note-ocean',
      path: '/v/tides.md',
      title: 'Tides',
      semantic: true
    })
    expect(hits[0].snippet).toContain('ocean moves')

    const pdfHits = await service.search('desert heat', 1)
    expect(pdfHits[0]).toMatchObject({ id: 'pdf:/v/dunes.pdf#p2', page: 2, semantic: true })
    expect(service.status()).toMatchObject({ enabled: true, state: 'ready', docCount: 2 })
  })

  it('round-trips the store: a fresh service reloads vectors without re-embedding docs', async () => {
    const first = fakeEmbedder()
    const service = makeService(first.embedFn)
    service.attach(corpusEngine())
    await service.setEnabled(true)
    service.dispose()

    const manifest = parseManifest(await readFile(join(dir, 'manifest.json'), 'utf-8'))
    expect(manifest.ok).toBe(true)
    if (manifest.ok) expect(manifest.value.entries).toHaveLength(2)

    const second = fakeEmbedder()
    const reloaded = makeService(second.embedFn)
    reloaded.attach(corpusEngine())
    await reloaded.setEnabled(true)

    // Hashes match the persisted manifest: only the query gets embedded.
    expect(second.calls).toHaveLength(0)
    const hits = await reloaded.search('ocean', 1)
    expect(hits[0].id).toBe('note-ocean')
    expect(second.calls).toEqual([['ocean']])
  })

  it('discards a corrupt manifest (lexical-only) and rebuilds from the live corpus', async () => {
    const first = fakeEmbedder()
    const service = makeService(first.embedFn)
    service.attach(corpusEngine())
    await service.setEnabled(true)
    service.dispose()

    await writeFile(join(dir, 'manifest.json'), '{corrupt!!', 'utf-8')

    // With an empty corpus the discarded store stays empty: semantic search
    // returns nothing and callers fall back to lexical results.
    const empty = fakeEmbedder()
    const emptyService = makeService(empty.embedFn)
    emptyService.attach(new SearchEngine())
    await emptyService.setEnabled(true)
    expect(emptyService.status().docCount).toBe(0)
    expect(await emptyService.search('ocean', 5)).toEqual([])
    emptyService.dispose()

    // With a live corpus the rebuild re-embeds every doc and recovers.
    await writeFile(join(dir, 'manifest.json'), '{corrupt!!', 'utf-8')
    const rebuilt = fakeEmbedder()
    const rebuiltService = makeService(rebuilt.embedFn)
    rebuiltService.attach(corpusEngine())
    await rebuiltService.setEnabled(true)
    expect(rebuilt.calls.flat()).toHaveLength(2)
    expect((await rebuiltService.search('ocean', 1))[0]?.id).toBe('note-ocean')
  })

  it('discards the store when vector bytes do not match the manifest entry count', async () => {
    const first = fakeEmbedder()
    const service = makeService(first.embedFn)
    service.attach(corpusEngine())
    await service.setEnabled(true)
    service.dispose()

    await writeFile(join(dir, 'vectors.f32'), Buffer.from([1, 2, 3]))

    const rebuilt = fakeEmbedder()
    const reloaded = makeService(rebuilt.embedFn)
    reloaded.attach(corpusEngine())
    await reloaded.setEnabled(true)
    // Full re-embed: both docs, not zero.
    expect(rebuilt.calls.flat()).toHaveLength(2)
  })

  it('discards a same-length corrupted vector file via checksum and rebuilds', async () => {
    const first = fakeEmbedder()
    const service = makeService(first.embedFn)
    service.attach(corpusEngine())
    await service.setEnabled(true)
    service.dispose()

    // Flip bits without changing the byte count: the length check alone
    // would accept this; only the manifest checksum catches it.
    const bytes = await readFile(join(dir, 'vectors.f32'))
    bytes[0] = bytes[0] ^ 0xff
    await writeFile(join(dir, 'vectors.f32'), bytes)

    const rebuilt = fakeEmbedder()
    const reloaded = makeService(rebuilt.embedFn)
    reloaded.attach(corpusEngine())
    await reloaded.setEnabled(true)
    // Store discarded → full re-embed of both docs, not zero.
    expect(rebuilt.calls.flat()).toHaveLength(2)
    expect((await reloaded.search('ocean', 1))[0]?.id).toBe('note-ocean')
  })

  it('updates the stored path on a metadata-only rename without re-embedding', async () => {
    const { embedFn, calls } = fakeEmbedder()
    const service = makeService(embedFn, 5)
    const engine = corpusEngine()
    service.attach(engine)
    await service.setEnabled(true)
    const callsAfterEnable = calls.length

    // Watcher-style rename with a stable frontmatter id: same id, same
    // title/body (same content hash), new path.
    engine.remove('note-ocean')
    engine.upsert({
      id: 'note-ocean',
      title: 'Tides',
      tags: [],
      body: 'the ocean moves with the moon',
      path: '/v/renamed/tides.md'
    })

    await vi.waitFor(async () => {
      const manifest = parseManifest(await readFile(join(dir, 'manifest.json'), 'utf-8'))
      const entry = manifest.ok
        ? manifest.value.entries.find((e) => e.id === 'note-ocean')
        : undefined
      expect(entry?.path).toBe('/v/renamed/tides.md')
    })
    // Content hash unchanged: the vector is reused, nothing re-embedded.
    expect(calls.length).toBe(callsAfterEnable)
    expect((await service.search('ocean', 1))[0]).toMatchObject({
      id: 'note-ocean',
      path: '/v/renamed/tides.md'
    })
  })

  it('drops non-finite cosine scores instead of returning bogus hits', async () => {
    const embedFn: EmbedFn = (texts) =>
      Promise.resolve(
        // Doc embeds are valid; the query embed degenerates to NaN.
        texts.map((t) => (t === 'nan-query' ? new Float32Array(EMBEDDING_DIM).fill(NaN) : basis(0)))
      )
    const service = makeService(embedFn)
    service.attach(corpusEngine())
    await service.setEnabled(true)

    expect(await service.search('nan-query', 5)).toEqual([])
  })

  it('re-embeds only changed docs after a debounced index change', async () => {
    const { embedFn, calls } = fakeEmbedder()
    const service = makeService(embedFn, 5)
    const engine = corpusEngine()
    service.attach(engine)
    await service.setEnabled(true)
    const callsAfterEnable = calls.length

    engine.upsert({
      id: 'note-ocean',
      title: 'Tides',
      tags: [],
      body: 'the ocean now has storms',
      path: '/v/tides.md'
    })

    await vi.waitFor(() => {
      expect(calls.length).toBeGreaterThan(callsAfterEnable)
    })
    const newCalls = calls.slice(callsAfterEnable).flat()
    expect(newCalls).toHaveLength(1)
    expect(newCalls[0]).toContain('storms')
    expect(service.status().docCount).toBe(2)
  })

  it('drops removed docs from the store on reindex', async () => {
    const { embedFn } = fakeEmbedder()
    const service = makeService(embedFn, 5)
    const engine = corpusEngine()
    service.attach(engine)
    await service.setEnabled(true)

    engine.remove('note-ocean')
    await vi.waitFor(() => {
      expect(service.status().docCount).toBe(1)
    })
    expect(await service.search('ocean', 5)).not.toContainEqual(
      expect.objectContaining({ id: 'note-ocean' })
    )
  })

  it('setEnabled(false) detaches: subsequent index changes trigger no embeds', async () => {
    const { embedFn, calls } = fakeEmbedder()
    const service = makeService(embedFn, 5)
    const engine = corpusEngine()
    service.attach(engine)
    await service.setEnabled(true)
    await service.setEnabled(false)
    const frozen = calls.length

    engine.upsert({ id: 'late', title: 'Late', tags: [], body: 'late doc', path: '/v/late.md' })
    await new Promise((r) => setTimeout(r, 30))
    expect(calls.length).toBe(frozen)
    expect(service.status()).toMatchObject({ enabled: false, state: 'off' })
  })
})
