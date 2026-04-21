import { useState, useMemo, useCallback } from 'react'
import { FileText } from '@phosphor-icons/react'
import { colors } from '../../design/tokens'
import { SectionLabel } from '../../design/components/SectionLabel'
import { useSettingsStore } from '../../store/settings-store'
import { useVaultStore } from '../../store/vault-store'
import { extractDailyNoteDates, localDateStr, dailyNotePath } from '../../utils/daily-notes'

interface DailyNoteSectionProps {
  onOpenDate: (dateStr: string) => void
  activeFilePath: string | null
  onFileSelect: (path: string) => void
  onContextMenu?: (e: React.MouseEvent, path: string, isDirectory: boolean) => void
}

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

function formatMonthYear(year: number, month: number): string {
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec'
  ]
  return `${months[month]} ${year}`
}

export function DailyNoteSection({
  onOpenDate,
  activeFilePath,
  onFileSelect,
  onContextMenu
}: DailyNoteSectionProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [viewDate, setViewDate] = useState(() => new Date())

  const vaultPath = useVaultStore((s) => s.vaultPath)
  const files = useVaultStore((s) => s.files)
  const dailyNoteFolder = useSettingsStore((s) => s.dailyNoteFolder)

  const noteDates = useMemo(
    () =>
      vaultPath ? extractDailyNoteDates(files, vaultPath, dailyNoteFolder) : new Set<string>(),
    [files, vaultPath, dailyNoteFolder]
  )

  const todayStr = localDateStr()

  // Daily note files for the viewed month, pinned below calendar
  const pinnedNotes = useMemo(() => {
    if (!vaultPath) return []
    return Array.from(noteDates)
      .filter((d) => {
        const y = viewDate.getFullYear()
        const m = viewDate.getMonth()
        const prefix = `${y}-${String(m + 1).padStart(2, '0')}-`
        return d.startsWith(prefix)
      })
      .sort()
      .reverse()
      .map((d) => ({ dateStr: d, path: dailyNotePath(vaultPath, dailyNoteFolder, d) }))
  }, [noteDates, vaultPath, dailyNoteFolder, viewDate])

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const totalDays = daysInMonth(year, month)
  const firstDayOfWeek = new Date(year, month, 1).getDay()

  const prevMonth = useCallback(() => {
    setViewDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))
  }, [])

  const nextMonth = useCallback(() => {
    setViewDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))
  }, [])

  const goToToday = useCallback(() => {
    setViewDate(new Date())
    onOpenDate(todayStr)
  }, [onOpenDate, todayStr])

  const handleDayClick = useCallback(
    (day: number) => {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      onOpenDate(dateStr)
    },
    [year, month, onOpenDate]
  )

  // Build calendar grid cells
  const cells: (number | null)[] = []
  for (let i = 0; i < firstDayOfWeek; i++) cells.push(null)
  for (let d = 1; d <= totalDays; d++) cells.push(d)

  return (
    <div className="px-3 pt-1 pb-2">
      {/* Header */}
      <button
        className="flex items-center gap-1.5 w-full text-left mb-1"
        style={{
          color: colors.text.secondary,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0
        }}
        onClick={() => setCollapsed((c) => !c)}
      >
        <span
          className="text-[9px] transition-transform"
          style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
        >
          ▼
        </span>
        <SectionLabel style={{ color: 'inherit' }}>Daily Notes</SectionLabel>
      </button>

      {!collapsed && (
        <div>
          {/* Month navigation */}
          <div className="flex items-center justify-between mb-1">
            <button
              onClick={prevMonth}
              aria-label="Previous month"
              style={{
                background: 'none',
                border: 'none',
                color: colors.text.muted,
                cursor: 'pointer',
                fontSize: '11px',
                padding: '2px 4px'
              }}
            >
              ‹
            </button>
            <span style={{ color: colors.text.secondary, fontSize: '11px', fontWeight: 500 }}>
              {formatMonthYear(year, month)}
            </span>
            <button
              onClick={nextMonth}
              aria-label="Next month"
              style={{
                background: 'none',
                border: 'none',
                color: colors.text.muted,
                cursor: 'pointer',
                fontSize: '11px',
                padding: '2px 4px'
              }}
            >
              ›
            </button>
          </div>

          {/* Weekday labels */}
          <div className="grid grid-cols-7 gap-0 mb-0.5">
            {WEEKDAY_LABELS.map((label, i) => (
              <div
                key={i}
                className="text-center"
                style={{ color: colors.text.secondary, fontSize: '9px', lineHeight: '16px' }}
              >
                {label}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-0">
            {cells.map((day, i) => {
              if (day === null) {
                return <div key={`empty-${i}`} />
              }

              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
              const hasNote = noteDates.has(dateStr)
              const isToday = dateStr === todayStr

              return (
                <button
                  key={dateStr}
                  onDoubleClick={() => handleDayClick(day)}
                  style={{
                    background: isToday ? '#ffffff' : 'none',
                    border: 'none',
                    borderRadius: '4px',
                    color: isToday
                      ? '#0a0a0c'
                      : hasNote
                        ? 'var(--color-text-primary)'
                        : colors.text.secondary,
                    cursor: 'pointer',
                    fontSize: '10px',
                    fontWeight: hasNote || isToday ? 600 : 400,
                    lineHeight: '20px',
                    padding: 0,
                    textAlign: 'center' as const,
                    position: 'relative' as const
                  }}
                >
                  {day}
                  {hasNote && !isToday && (
                    <span
                      style={{
                        position: 'absolute',
                        bottom: '1px',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        width: '3px',
                        height: '3px',
                        borderRadius: '50%',
                        backgroundColor: 'var(--color-accent-default)'
                      }}
                    />
                  )}
                </button>
              )
            })}
          </div>

          {/* Today button */}
          <button
            onClick={goToToday}
            className="w-full mt-1.5"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.14)',
              borderRadius: '4px',
              color: colors.text.secondary,
              cursor: 'pointer',
              fontSize: '10px',
              padding: '3px 0',
              textAlign: 'center'
            }}
          >
            Today
          </button>

          {/* Pinned daily note files for viewed month */}
          {vaultPath && pinnedNotes.length > 0 && (
            <div className="mt-1.5">
              {pinnedNotes.map(({ dateStr: d, path }) => {
                const isActive = activeFilePath === path
                return (
                  <button
                    key={d}
                    type="button"
                    className="file-row-hover flex items-center gap-1.5 w-full text-left py-[2px]"
                    data-active={isActive || undefined}
                    onClick={() => onFileSelect(path)}
                    onContextMenu={(e) => onContextMenu?.(e, path, false)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      paddingLeft: 24,
                      fontSize: 'var(--env-sidebar-font-size)'
                    }}
                  >
                    <FileText size={14} color="#56b6c2" weight="duotone" />
                    <span
                      style={{
                        color: isActive ? colors.text.primary : colors.text.secondary,
                        fontSize: 'var(--env-sidebar-font-size)'
                      }}
                    >
                      {d}
                    </span>
                    <span className="file-name-text__ext">.md</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
