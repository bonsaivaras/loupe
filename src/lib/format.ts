export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const v = bytes / 1024 ** i
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

export function daysUntil(timestamp: number): number {
  return Math.ceil((timestamp - Date.now()) / 86_400_000)
}

export function formatExpiry(expiresAt: number): string {
  const d = daysUntil(expiresAt)
  if (d <= 0) return 'Expires today'
  if (d === 1) return 'Expires tomorrow'
  return `Expires in ${d} days`
}

export function formatShutter(seconds?: number): string | null {
  if (!seconds || !Number.isFinite(seconds)) return null
  if (seconds >= 1) return `${Number(seconds.toFixed(1))}s`
  return `1/${Math.round(1 / seconds)}s`
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}
