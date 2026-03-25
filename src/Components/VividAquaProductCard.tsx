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
  /** ~20% shorter layout for home promo slideshow */
  compact?: boolean;
  /** Home slideshow: image fills the frame, no copy or button (whole card tap = onBuy) */
  imageOnly?: boolean;
}

export default function VividAquaProductCard({
  title,
  ticketCount,
  subtitle,
  badge,
  onBuy,
  packImage,
  compact = false,
  imageOnly = false,
}: VividAquaProductCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  const borderGradient = useMemo(
    () => ({
      background: 'linear-gradient(45deg, rgba(11,59,145,0.5) 0%, rgba(10,102,178,0.4) 40%, rgba(18,201,205,0.5) 100%)',
    }),
    []
  );

  if (imageOnly) {
    return (
      <motion.div
        className="relative rounded-3xl p-px shadow-2xl"
        style={borderGradient}
        whileTap={{ scale: 0.985 }}
        transition={{ type: 'spring', stiffness: 400, damping: 28 }}
      >
        <button
          type="button"
          onClick={onBuy}
          aria-label={title}
          className="relative block w-full overflow-hidden rounded-[22px] border-0 bg-[#07234b] p-0 cursor-pointer"
          style={{ touchAction: 'manipulation' }}
        >
          <div className="relative aspect-[5/3] w-full">
            {packImage && !imageFailed ? (
              <img
                src={packImage}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
                loading="lazy"
                decoding="async"
                onError={() => setImageFailed(true)}
              />
            ) : (
              <div
                className="absolute inset-0"
                style={{ background: 'linear-gradient(160deg, #031738 0%, #07234b 65%, #0a2e5d 100%)' }}
              />
            )}
          </div>
        </button>
      </motion.div>
    );
  }

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
        className={`relative overflow-hidden rounded-3xl text-white flex flex-col ${compact ? 'px-4 py-4' : 'px-5 py-5'}`}
        style={{
          background: 'linear-gradient(160deg, #031738 0%, #07234b 65%, #0a2e5d 100%)',
          minHeight:
            packImage && !imageFailed
              ? compact
                ? '256px'
                : '320px'
              : compact
                ? '224px'
                : '280px',
        }}
      >
        {packImage && !imageFailed ? (
          <div
            className={`relative z-10 flex items-center justify-center overflow-hidden bg-black/15 ${
              compact
                ? '-mx-4 -mt-4 mb-2 min-h-[96px] max-h-[128px] rounded-t-[18px]'
                : '-mx-5 -mt-5 mb-3 min-h-[120px] max-h-[160px] rounded-t-[22px]'
            }`}
          >
            <img
              src={packImage}
              alt=""
              className={`w-full object-contain object-center ${compact ? 'max-h-[120px]' : 'max-h-[150px]'}`}
              loading="lazy"
              decoding="async"
              onError={() => setImageFailed(true)}
            />
          </div>
        ) : null}
        <div className={`relative z-20 flex items-start justify-between gap-3 flex-1 ${compact ? 'mb-3' : 'mb-4'}`}>
          <div>
            <span
              className={`inline-block rounded-full font-semibold ${compact ? 'px-2.5 py-0.5 text-[11px]' : 'px-3 py-1 text-xs'}`}
              style={{ background: 'rgba(18, 201, 205, 0.24)', border: '1px solid rgba(18, 201, 205, 0.5)' }}
            >
              {badge}
            </span>
            <h3 className={`font-extrabold tracking-tight ${compact ? 'mt-2 text-xl' : 'mt-3 text-2xl'}`}>{title}</h3>
            <p className={`text-cyan-100/90 ${compact ? 'mt-0.5 text-[13px]' : 'mt-1 text-sm'}`}>{subtitle}</p>
          </div>
          <div className="text-right">
            <p className={`font-black leading-none text-cyan-300 ${compact ? 'text-3xl' : 'text-4xl'}`}>{ticketCount}</p>
            <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-cyan-100">Water Tickets</p>
          </div>
        </div>

        <motion.div
          className="relative z-20"
          style={{ marginTop: 'auto', paddingTop: compact ? 16 : 24 }}
          animate={{ boxShadow: ['0 0 0 rgba(18, 201, 205, 0.18)', '0 0 22px rgba(18, 201, 205, 0.42)', '0 0 0 rgba(18, 201, 205, 0.18)'] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
        >
          <button
            type="button"
            onClick={onBuy}
            className={`w-full rounded-xl px-4 font-bold text-slate-900 ${compact ? 'py-2 text-[13px]' : 'py-3 text-sm'}`}
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
