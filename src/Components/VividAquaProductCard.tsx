import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';

interface VividAquaProductCardProps {
  title: string;
  ticketCount: number;
  subtitle: string;
  badge: string;
  onBuy: () => void;
  /** Optional promo image from /public (e.g. "10 Pack Indonesia.jpg") */
  packImage?: string;
}

export default function VividAquaProductCard({
  title,
  ticketCount,
  subtitle,
  badge,
  onBuy,
  packImage,
}: VividAquaProductCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  const borderGradient = useMemo(
    () => ({
      background: 'linear-gradient(45deg, rgba(11,59,145,0.5) 0%, rgba(10,102,178,0.4) 40%, rgba(18,201,205,0.5) 100%)',
    }),
    []
  );

  return (
    <motion.div
      className="relative rounded-3xl p-px shadow-2xl"
      style={borderGradient}
      onHoverStart={() => setIsHovered(true)}
      onHoverEnd={() => setIsHovered(false)}
      whileHover={{ y: -4, scale: 1.01 }}
      transition={{ type: 'spring', stiffness: 210, damping: 20 }}
    >
      <div
        className="relative overflow-hidden rounded-3xl px-5 py-5 text-white flex flex-col"
        style={{
          background: 'linear-gradient(160deg, #031738 0%, #07234b 65%, #0a2e5d 100%)',
          minHeight: packImage && !imageFailed ? '320px' : '280px',
        }}
      >
        {packImage && !imageFailed ? (
          <div
            className="relative z-10 -mx-5 -mt-5 mb-3 flex min-h-[120px] max-h-[160px] items-center justify-center overflow-hidden rounded-t-[22px] bg-black/15"
          >
            <img
              src={packImage}
              alt=""
              className="max-h-[150px] w-full object-contain object-center"
              loading="lazy"
              decoding="async"
              onError={() => setImageFailed(true)}
            />
          </div>
        ) : null}
        <div className="relative z-20 mb-4 flex items-start justify-between gap-3 flex-1">
          <div>
            <span
              className="inline-block rounded-full px-3 py-1 text-xs font-semibold"
              style={{ background: 'rgba(18, 201, 205, 0.24)', border: '1px solid rgba(18, 201, 205, 0.5)' }}
            >
              {badge}
            </span>
            <h3 className="mt-3 text-2xl font-extrabold tracking-tight">{title}</h3>
            <p className="mt-1 text-sm text-cyan-100/90">{subtitle}</p>
          </div>
          <div className="text-right">
            <p className="text-4xl font-black leading-none text-cyan-300">{ticketCount}</p>
            <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-cyan-100">Water Tickets</p>
          </div>
        </div>

        <motion.div
          className="relative z-20"
          style={{ marginTop: 'auto', paddingTop: 24 }}
          animate={{ boxShadow: ['0 0 0 rgba(18, 201, 205, 0.18)', '0 0 22px rgba(18, 201, 205, 0.42)', '0 0 0 rgba(18, 201, 205, 0.18)'] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
        >
          <button
            type="button"
            onClick={onBuy}
            className="w-full rounded-xl px-4 py-3 text-sm font-bold text-slate-900"
            style={{
              background: '#12c9cd',
              border: '1px solid rgba(255, 255, 255, 0.55)',
            }}
          >
            Buy This Package
          </button>
        </motion.div>

        <motion.div
          aria-hidden
          className="pointer-events-none absolute -left-12 top-16 h-24 w-64 rounded-full"
          style={{ background: 'linear-gradient(90deg, rgba(18,201,205,0), rgba(18,201,205,0.25), rgba(18,201,205,0))' }}
          animate={isHovered ? { x: ['-15%', '120%'], opacity: [0, 0.4, 0] } : { x: '-20%', opacity: 0 }}
          transition={{ duration: 1.4, repeat: isHovered ? Infinity : 0, ease: 'easeInOut' }}
        />

        <motion.div
          aria-hidden
          className="pointer-events-none absolute -right-8 bottom-8 h-20 w-56 rounded-full"
          style={{ background: 'linear-gradient(90deg, rgba(18,201,205,0), rgba(18,201,205,0.18), rgba(18,201,205,0))' }}
          animate={isHovered ? { x: ['20%', '-120%'], opacity: [0, 0.3, 0] } : { x: '20%', opacity: 0 }}
          transition={{ duration: 1.6, repeat: isHovered ? Infinity : 0, ease: 'easeInOut', delay: 0.2 }}
        />
      </div>
    </motion.div>
  );
}
