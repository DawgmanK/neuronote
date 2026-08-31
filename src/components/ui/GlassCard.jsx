import { motion } from 'framer-motion'

export default function GlassCard({ children, className = '', onClick, hoverable = true, animate = true, ...props }) {
  return (
    <motion.div
      className={`glass p-4 ${className}`}
      onClick={onClick}
      initial={animate ? { opacity: 0, y: 20 } : false}
      animate={animate ? { opacity: 1, y: 0 } : false}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      whileHover={hoverable ? { y: -2, boxShadow: '0 12px 40px rgba(220,38,38,0.15)' } : undefined}
      whileTap={onClick ? { scale: 0.98 } : undefined}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
      {...props}
    >
      {children}
    </motion.div>
  )
}
