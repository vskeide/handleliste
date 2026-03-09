export const CHAIN_COLORS: Record<string, { primary: string; lightBg: string }> = {
  REMA: { primary: '#003DA5', lightBg: '#E8EFF8' },
  KIWI: { primary: '#00843D', lightBg: '#E6F4ED' },
  COOP_EXTRA: { primary: '#00205B', lightBg: '#E6EAF0' },
  COOP_MEGA: { primary: '#E4002B', lightBg: '#FDE8EC' },
  BUNNPRIS: { primary: '#1A1A1A', lightBg: '#FFF9E0' },
  SPAR: { primary: '#ED1C24', lightBg: '#FDE8E9' },
}

export const APP_COLORS = {
  background: '#FAFAFA',
  surface: '#FFFFFF',
  textPrimary: '#0F172A',
  textSecondary: '#64748B',
  textMuted: '#94A3B8',
  border: '#E2E8F0',
  borderLight: '#F1F5F9',
  success: '#10B981',
  warningBadge: '#D97706',
  warningBg: '#FEF3C7',
} as const

export const GRID_DEFAULTS = {
  cols: 12,
  rows: 14,
  minCols: 8,
  maxCols: 16,
  minRows: 8,
  maxRows: 20,
} as const

export const SESSION_COOKIE_NAME = 'handleliste_session'
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60 // 30 days in seconds
