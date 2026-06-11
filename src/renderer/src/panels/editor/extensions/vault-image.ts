import Image, { type ImageOptions } from '@tiptap/extension-image'
import type { MarkdownToken, MarkdownTokenizer } from '@tiptap/core'

/**
 * Image node with vault-aware loading and Obsidian-style `![[file]]` embeds.
 *
 * - Standard `![alt](src)` markdown round-trips through the base extension's
 *   token shape; vault-relative `src` values are resolved to displayable blob
 *   URLs via the `resolveSrc` option (IPC binary read) without ever touching
 *   the serialized `src` attribute.
 * - `![[file]]` embeds get their own tokenizer (the wikilink tokenizer only
 *   matched `[[`, leaving a stray `!` in the doc). Image targets become image
 *   nodes carrying `embedTarget` so they serialize back to `![[file]]`;
 *   non-image targets (e.g. PDFs) fall back to a wikilink node with
 *   `embed: true` so the `!` survives the round-trip.
 */

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|ico|bmp|avif)$/i

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif'
}

const REMOTE_SRC_RE = /^(https?:|data:|blob:|file:)/

export function isImagePath(path: string): boolean {
  return IMAGE_EXT_RE.test(path)
}

export function mimeFromPath(path: string): string {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase()
  return MIME_BY_EXT[ext] ?? 'image/png'
}

/**
 * Try each candidate absolute path via the binary-read IPC; return a blob URL
 * for the first one that exists, or null. Caller owns revoking the URL.
 */
export async function resolveVaultImageUrl(candidates: readonly string[]): Promise<string | null> {
  for (const path of candidates) {
    try {
      const base64 = await window.api.fs.readBinary(path)
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
      return URL.createObjectURL(new Blob([bytes], { type: mimeFromPath(path) }))
    } catch {
      // Not readable at this candidate -- try the next one
    }
  }
  return null
}

interface VaultImageOptions extends ImageOptions {
  /** Resolve a vault-relative src to a displayable URL (blob/data). */
  resolveSrc?: (src: string) => Promise<string | null>
}

type EmbedToken = MarkdownToken & { embedTarget?: string; embedAlias?: string | null }

export const VaultImage = Image.extend<VaultImageOptions>({
  addOptions() {
    // parent always exists at runtime (extending Image); the cast covers the
    // optional chain so the spread keeps ImageOptions' required fields.
    const parent = this.parent?.() ?? ({} as VaultImageOptions)
    return {
      ...parent,
      // Inline so `![alt](src)` inside a paragraph keeps a valid schema and
      // serializes back onto the same line.
      inline: true,
      resolveSrc: undefined
    }
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      // Set when the node came from `![[file]]`; drives embed serialization.
      embedTarget: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-embed-target'),
        renderHTML: (attributes) =>
          attributes.embedTarget ? { 'data-embed-target': attributes.embedTarget as string } : {}
      }
    }
  },

  // Tokenize `![[file]]` / `![[file|alias]]`. Emits tokens of type 'image' so
  // they route to this extension's parseMarkdown alongside standard images.
  markdownTokenizer: {
    name: 'vaultImageEmbed',
    level: 'inline',
    start(src: string) {
      const idx = src.indexOf('![[')
      return idx >= 0 ? idx : -1
    },
    tokenize(src: string) {
      const match = src.match(/^!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/)
      if (!match) return undefined
      return {
        type: 'image',
        raw: match[0],
        embedTarget: match[1],
        embedAlias: match[2] || null
      }
    }
  } satisfies MarkdownTokenizer,

  parseMarkdown(token) {
    const { embedTarget, embedAlias } = token as EmbedToken
    if (embedTarget) {
      if (isImagePath(embedTarget)) {
        return {
          type: 'image',
          attrs: { src: embedTarget, alt: embedAlias ?? null, embedTarget }
        }
      }
      // Non-image embed (e.g. a PDF): fall back to an embed-flagged wikilink
      return {
        type: 'wikilink',
        attrs: { target: embedTarget, alias: embedAlias ?? null, embed: true }
      }
    }
    // Standard markdown image token from marked
    return {
      type: 'image',
      attrs: { src: token.href ?? '', alt: token.text || null, title: token.title || null }
    }
  },

  renderMarkdown(node) {
    const attrs = node.attrs ?? {}
    const embedTarget = (attrs.embedTarget as string | null) ?? null
    if (embedTarget) {
      const alias = (attrs.alt as string | null) ?? null
      return alias ? `![[${embedTarget}|${alias}]]` : `![[${embedTarget}]]`
    }
    const src = (attrs.src as string | null) ?? ''
    const alt = (attrs.alt as string | null) ?? ''
    const title = (attrs.title as string | null) ?? ''
    return title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`
  },

  addNodeView() {
    const resolveSrc = this.options.resolveSrc
    return ({ node }) => {
      const img = document.createElement('img')
      img.className = 'te-editor-image'
      img.draggable = false
      img.style.maxWidth = '100%'
      const alt = node.attrs.alt as string | null
      const title = node.attrs.title as string | null
      if (alt) img.alt = alt
      if (title) img.title = title

      const src = (node.attrs.src as string | null) ?? ''
      let destroyed = false
      let blobUrl: string | null = null

      if (REMOTE_SRC_RE.test(src)) {
        img.src = src
      } else if (src && resolveSrc) {
        resolveSrc(src)
          .then((url) => {
            if (!url) return
            if (destroyed) {
              if (url.startsWith('blob:')) URL.revokeObjectURL(url)
              return
            }
            if (url.startsWith('blob:')) blobUrl = url
            img.src = url
          })
          .catch(() => {
            // Unresolvable src: leave the alt text visible
          })
      }

      return {
        dom: img,
        destroy() {
          destroyed = true
          if (blobUrl) URL.revokeObjectURL(blobUrl)
        }
      }
    }
  }
})
