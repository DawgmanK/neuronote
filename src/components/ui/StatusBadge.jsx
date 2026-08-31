export default function StatusBadge({ status }) {
  const configs = {
    online: { color: 'bg-green-500', label: 'ONLINE', pulseClass: 'dot-pulse' },
    offline: { color: 'bg-gray-400', label: 'OFFLINE', pulseClass: '' },
    recording: { color: 'bg-red-500', label: 'RECORDING', pulseClass: 'dot-pulse-fast' }
  }

  const config = configs[status] || configs.online

  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <div className={`w-2 h-2 rounded-full ${config.color} ${config.pulseClass}`} />
      </div>
      <span className={`font-mono uppercase text-[10px] tracking-wider font-medium ${status === 'recording' ? 'text-red' : 'text-muted'}`}>
        {config.label}
      </span>
    </div>
  )
}
