import { useState, useMemo, useCallback } from 'react'
import { FileText } from 'lucide-react'
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

const COLLAPSED_STORAGE_KEY = 'te.daily-notes-collapsed'

function readDailyNotesCollapsed(): boolean {
  try {
    // Absent key (first run) reads as collapsed — the calendar is opt-in.
    return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) !== '0'
  } catch {
    return true
  }
}

function persistDailyNotesCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0')
  } catch {
    /* localStorage unavailable; non-fatal */
  }
}

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
  // Collapsed by default: the expanded calendar costs ~230px of a panel whose
  // primary job is the file tree. The user's choice persists per machine.
  const [collapsed, setCollapsed] = useState(() => readDailyNotesCollapsed())
  const [viewDate, setViewDate] = useState(() => new Date())

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      persistDailyNotesCollapsed(!prev)
      return !prev
    })
  }, [])

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
    <div className="te-dailynote">
      {/* Header */}
      <button
        className="te-dailynote-toggle"
        data-collapsed={collapsed ? 'true' : undefined}
        onClick={toggleCollapsed}
      >
        <span className="te-dailynote-caret">▼</span>
        {/* Console section header: muted mono 10px / 0.14em uppercase. */}
        <SectionLabel>Daily Notes</SectionLabel>
      </button>

      {!collapsed && (
        <div>
          {/* Month navigation */}
          <div className="te-dailynote-nav">
            <button onClick={prevMonth} aria-label="Previous month" className="te-dailynote-navbtn">
              ‹
            </button>
            {/* Mono numeric/month label — sits visually with the rest of the
                console chrome instead of looking like sentence text. */}
            <span className="te-dailynote-month">{formatMonthYear(year, month)}</span>
            <button onClick={nextMonth} aria-label="Next month" className="te-dailynote-navbtn">
              ›
            </button>
          </div>

          {/* Weekday labels */}
          <div className="te-dailynote-weekdays">
            {WEEKDAY_LABELS.map((label, i) => (
              <div key={i} className="te-dailynote-weekday">
                {label}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="te-dailynote-grid">
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
                  className="te-dailynote-day"
                  data-today={isToday ? 'true' : undefined}
                  data-hasnote={hasNote ? 'true' : undefined}
                >
                  {day}
                  {hasNote && !isToday && <span className="te-dailynote-dot" />}
                </button>
              )
            })}
          </div>

          {/* Today button */}
          <button onClick={goToToday} className="te-dailynote-today">
            Today
          </button>

          {/* Pinned daily note files for viewed month */}
          {vaultPath && pinnedNotes.length > 0 && (
            <div className="te-dailynote-pinned">
              {pinnedNotes.map(({ dateStr: d, path }) => {
                const isActive = activeFilePath === path
                return (
                  <button
                    key={d}
                    type="button"
                    className="te-dailynote-pinned-row"
                    data-active={isActive || undefined}
                    onClick={() => onFileSelect(path)}
                    onContextMenu={(e) => onContextMenu?.(e, path, false)}
                  >
                    <FileText size={14} color={colors.text.muted} strokeWidth={1.5} />
                    <span className="te-dailynote-pinned-name">{d}</span>
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
