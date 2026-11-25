/**
 * v2.8 — the header status light. Green means ready, red means the mic is
 * live, grey means offline. Each colour carries its own soft glow so the state
 * reads at a glance on the black header.
 */
export default function StatusBadge({ status }) {
  const configs = {
    online: { dot: '#2dff9a', label: 'Ready', pulseClass: 'dot-pulse', text: 'text-muted' },
    offline: { dot: '#6c727d', label: 'Offline', pulseClass: '', text: 'text-muted' },
    recording: { dot: '#ff2d55', label: 'Recording', pulseClass: 'dot-pulse-fast', text: 'text-rec' }
  }

  const config = configs[status] || configs.online

  return (
    <div className="flex items-center gap-2 pl-2.5 pr-3 py-1 rounded-full border border-white/10 bg-white/[0.04]">
      <span
        className={`w-2 h-2 rounded-full ${config.pulseClass}`}
        style={{ background: config.dot, boxShadow: `0 0 8px ${config.dot}` }}
      />
      <span className={`font-mono text-xs font-medium ${config.text}`}>
        {config.label}
      </span>
    </div>
  )
}
