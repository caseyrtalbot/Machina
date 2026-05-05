/**
 * Map common emojis the model emits in headings, lists, and prose to a
 * Lucide icon name. Keys are stripped of the U+FE0F variation selector so
 * both `⚠️` and `⚠` collapse to the same lookup. Unmapped emojis fall
 * through to their original character.
 */
export const EMOJI_TO_LUCIDE: Readonly<Record<string, string>> = {
  // Files & documents
  '📄': 'FileText',
  '📃': 'FileText',
  '📑': 'Files',
  '📝': 'PenLine',
  '📋': 'ClipboardList',
  '📁': 'Folder',
  '📂': 'FolderOpen',
  '📦': 'Package',
  '📚': 'BookOpen',
  '📖': 'BookOpen',
  // Visual / media
  '🖼': 'Image',
  '🎨': 'Palette',
  '📷': 'Camera',
  '🎥': 'Video',
  // Status & tone
  '⚠': 'AlertTriangle',
  '❗': 'AlertCircle',
  '❓': 'HelpCircle',
  '✅': 'CheckCircle2',
  '✔': 'Check',
  '☑': 'CheckSquare',
  '❌': 'XCircle',
  '✖': 'X',
  '⛔': 'Ban',
  '🚫': 'Ban',
  // Search / discovery
  '🔍': 'Search',
  '🔎': 'Search',
  '🔬': 'Microscope',
  // Insight / thought
  '💡': 'Lightbulb',
  '🧠': 'Brain',
  '💭': 'MessageCircle',
  '💬': 'MessageSquare',
  '🗣': 'Megaphone',
  // Action / momentum
  '🚀': 'Rocket',
  '⚡': 'Zap',
  '🔥': 'Flame',
  '🎯': 'Target',
  '🏁': 'Flag',
  // Time
  '⏰': 'AlarmClock',
  '⏱': 'Timer',
  '🕐': 'Clock',
  '📅': 'Calendar',
  '📆': 'CalendarDays',
  // Tools
  '🔧': 'Wrench',
  '🛠': 'Hammer',
  '⚙': 'Settings',
  '🔨': 'Hammer',
  // Charts / data
  '📊': 'BarChart3',
  '📈': 'TrendingUp',
  '📉': 'TrendingDown',
  // Navigation
  '🔗': 'Link2',
  '📌': 'Pin',
  '📍': 'MapPin',
  '🗺': 'Map',
  // Stars / favorites
  '⭐': 'Star',
  '🌟': 'Sparkle',
  '✨': 'Sparkles',
  '💫': 'Sparkles',
  // Security
  '🔒': 'Lock',
  '🔓': 'Unlock',
  '🔑': 'Key',
  '🛡': 'Shield',
  // Notifications / signals
  '🔔': 'Bell',
  '📣': 'Megaphone',
  '📢': 'Megaphone',
  // Misc common
  '👀': 'Eye',
  '👁': 'Eye',
  '🤖': 'Bot',
  '🧪': 'FlaskConical',
  '🧩': 'Puzzle',
  '🏷': 'Tag',
  '📎': 'Paperclip',
  '✏': 'Pencil',
  '🖊': 'PenLine',
  '🗑': 'Trash2'
}

/**
 * Match a single emoji codepoint cluster, including ZWJ and VS16 sequences.
 * Used for splitting text nodes during rehype walk.
 */
export const EMOJI_PATTERN = /(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)/gu

export function lookupLucideName(emojiCluster: string): string | null {
  const stripped = emojiCluster.replace(/️/g, '').replace(/‍/g, '')
  if (EMOJI_TO_LUCIDE[stripped]) return EMOJI_TO_LUCIDE[stripped]
  if (EMOJI_TO_LUCIDE[emojiCluster]) return EMOJI_TO_LUCIDE[emojiCluster]
  return null
}
