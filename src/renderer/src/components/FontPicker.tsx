import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { colors, borderRadius, typography } from '../design/tokens'
import {
  ALL_FONT_OPTIONS,
  FONT_CATEGORIES,
  buildGoogleFontUrl,
  buildFontFamilyValue,
  type FontCategory,
  type GoogleFontEntry
} from '../design/google-fonts'

interface FontPickerProps {
  value: string
  onChange: (fontName: string) => void
  /** Lock the picker to a single font category (hides category tabs). */
  categoryFilter?: Exclude<FontCategory, 'all'>
}

/**
 * Searchable, categorized font picker with live preview.
 * Loads fonts on hover for lightweight previewing.
 */
export function FontPicker({ value, onChange, categoryFilter }: FontPickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<FontCategory>(categoryFilter ?? 'all')
  const [previewFont, setPreviewFont] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const filteredFonts = useMemo(() => {
    const query = search.toLowerCase()
    return ALL_FONT_OPTIONS.filter((f) => {
      if (categoryFilter && f.category !== categoryFilter) return false
      if (category !== 'all' && f.category !== category) return false
      if (query && !f.name.toLowerCase().includes(query)) return false
      return true
    })
  }, [search, category, categoryFilter])

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isOpen])

  // Focus search when opened
  useEffect(() => {
    if (isOpen) {
      searchRef.current?.focus()
      // Scroll to selected font
      requestAnimationFrame(() => {
        const selected = listRef.current?.querySelector('[data-selected="true"]')
        selected?.scrollIntoView({ block: 'center' })
      })
    } else {
      // Reset state when picker closes — cascading render is acceptable here
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSearch('')
      setCategory(categoryFilter ?? 'all')
    }
  }, [isOpen, categoryFilter])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false)
    }
  }, [])

  // Load a font for preview on hover
  const handleHover = useCallback((font: GoogleFontEntry) => {
    setPreviewFont(font.name)
    const url = buildGoogleFontUrl(font)
    if (!url) return

    // Check if already loaded
    const linkId = `te-preview-${font.name.replace(/ /g, '-')}`
    if (document.getElementById(linkId)) return

    const link = document.createElement('link')
    link.id = linkId
    link.rel = 'stylesheet'
    link.href = url
    document.head.appendChild(link)
  }, [])

  return (
    <div ref={containerRef} className="relative" onKeyDown={handleKeyDown}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between"
        style={{
          minWidth: 140,
          minHeight: 26,
          padding: '0 8px',
          gap: 6,
          backgroundColor: 'transparent',
          color: colors.text.primary,
          border: `0.5px solid ${colors.border.default}`,
          borderRadius: borderRadius.inline,
          fontFamily: typography.fontFamily.mono,
          fontSize: 12,
          letterSpacing: 0,
          cursor: 'pointer'
        }}
      >
        <span
          className="truncate"
          style={{ fontFamily: buildFontFamilyValue(value), fontSize: 12 }}
        >
          {value}
        </span>
        <svg width="9" height="9" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0 }}>
          <path
            d="M2.5 4L5 6.5L7.5 4"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div
          className="absolute right-0 top-full z-50 overflow-hidden"
          style={{
            marginTop: 4,
            width: 280,
            backgroundColor: colors.bg.elevated,
            border: `0.5px solid ${colors.border.strong}`,
            borderRadius: borderRadius.tool,
            boxShadow: '0 24px 48px rgba(0,0,0,0.6)'
          }}
        >
          {/* Search input */}
          <div
            style={{
              padding: 8,
              borderBottom: `0.5px solid ${colors.border.subtle}`
            }}
          >
            <input
              ref={searchRef}
              type="text"
              placeholder="Search fonts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full outline-none"
              style={{
                padding: '4px 8px',
                backgroundColor: 'transparent',
                color: colors.text.primary,
                border: `0.5px solid ${colors.border.default}`,
                borderRadius: borderRadius.inline,
                fontFamily: typography.fontFamily.mono,
                fontSize: 12
              }}
            />
          </div>

          {/* Category filters (hidden when locked to a single category) */}
          {!categoryFilter && (
            <div
              className="flex"
              style={{
                gap: 4,
                padding: '6px 8px',
                borderBottom: `0.5px solid ${colors.border.subtle}`
              }}
            >
              {FONT_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  className="transition-colors"
                  style={{
                    padding: '2px 6px',
                    borderRadius: borderRadius.inline,
                    fontFamily: typography.fontFamily.mono,
                    fontSize: typography.metadata.size,
                    letterSpacing: typography.metadata.letterSpacing,
                    textTransform: typography.metadata.textTransform,
                    backgroundColor: category === cat ? colors.accent.soft : 'transparent',
                    border: `0.5px solid ${category === cat ? colors.accent.default : 'transparent'}`,
                    color: category === cat ? colors.accent.default : colors.text.muted,
                    cursor: 'pointer'
                  }}
                >
                  {cat === 'all' ? 'All' : cat}
                </button>
              ))}
            </div>
          )}

          {/* Font list */}
          <div ref={listRef} className="overflow-y-auto" style={{ maxHeight: 240 }}>
            {filteredFonts.length === 0 ? (
              <div
                className="text-center"
                style={{
                  padding: '16px 12px',
                  fontSize: 12,
                  fontFamily: typography.fontFamily.mono,
                  color: colors.text.muted
                }}
              >
                No fonts match &ldquo;{search}&rdquo;
              </div>
            ) : (
              filteredFonts.map((font) => {
                const isSelected = font.name === value
                const isHovered = font.name === previewFont
                return (
                  <button
                    key={font.name}
                    type="button"
                    data-selected={isSelected}
                    onClick={() => {
                      onChange(font.name)
                      setIsOpen(false)
                    }}
                    onMouseEnter={() => handleHover(font)}
                    onMouseLeave={() => setPreviewFont(null)}
                    className="w-full text-left flex items-center justify-between transition-colors"
                    style={{
                      padding: '6px 12px',
                      borderBottom: `0.5px solid ${colors.border.subtle}`,
                      backgroundColor: isSelected
                        ? colors.accent.soft
                        : isHovered
                          ? 'color-mix(in srgb, var(--color-text-primary) 4%, transparent)'
                          : 'transparent',
                      color: isSelected ? colors.accent.default : colors.text.primary,
                      fontFamily:
                        isHovered || isSelected
                          ? buildFontFamilyValue(font.name)
                          : typography.fontFamily.mono,
                      fontSize: 12,
                      cursor: 'pointer'
                    }}
                  >
                    <span className="truncate">{font.name}</span>
                    <span
                      className="ml-2 flex-shrink-0"
                      style={{
                        color: colors.text.muted,
                        fontFamily: typography.fontFamily.mono,
                        fontSize: typography.metadata.size,
                        letterSpacing: typography.metadata.letterSpacing,
                        textTransform: typography.metadata.textTransform
                      }}
                    >
                      {font.category}
                    </span>
                  </button>
                )
              })
            )}
          </div>

          {/* Footer count */}
          <div
            style={{
              padding: '6px 12px',
              borderTop: `0.5px solid ${colors.border.subtle}`,
              color: colors.text.muted,
              fontFamily: typography.fontFamily.mono,
              fontSize: typography.metadata.size,
              letterSpacing: typography.metadata.letterSpacing,
              textTransform: typography.metadata.textTransform
            }}
          >
            {filteredFonts.length} font{filteredFonts.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}
    </div>
  )
}
