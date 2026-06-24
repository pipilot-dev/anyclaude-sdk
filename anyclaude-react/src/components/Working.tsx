export interface WorkingProps {
  /** Show the indicator. */
  active: boolean
  label?: string
  /** Shown when the run is paused mid-flight (survivor continuation). */
  paused?: boolean
  className?: string
}

/** A shimmering "Working…" indicator (CSS animation in styles.css). */
export function Working({ active, label = 'Working', paused, className }: WorkingProps) {
  if (!active) return null
  const text = paused ? 'Resuming' : label
  return (
    <div className={`ac-working${className ? ' ' + className : ''}`} role="status" aria-live="polite">
      <span className="ac-working-spinner" aria-hidden />
      <span className="ac-working-text">{text}…</span>
    </div>
  )
}
