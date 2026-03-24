import { useMemo } from 'react';
import { motion } from 'framer-motion';

interface DotPoint {
  id: number;
  tx: number;
  ty: number;
  sx: number;
  sy: number;
}

function buildDotPoints(): DotPoint[] {
  const points: DotPoint[] = [];
  const startLeft = { x: 78, y: 56 };
  const endBottom = { x: 180, y: 206 };
  const startRight = { x: 282, y: 56 };

  for (let i = 0; i < 25; i += 1) {
    const t = i / 24;
    points.push({
      id: i,
      tx: startLeft.x + (endBottom.x - startLeft.x) * t,
      ty: startLeft.y + (endBottom.y - startLeft.y) * t,
      sx: 20 + Math.random() * 320,
      sy: 10 + Math.random() * 230,
    });
  }

  for (let i = 0; i < 25; i += 1) {
    const t = i / 24;
    points.push({
      id: i + 25,
      tx: endBottom.x + (startRight.x - endBottom.x) * t,
      ty: endBottom.y + (startRight.y - endBottom.y) * t,
      sx: 20 + Math.random() * 320,
      sy: 10 + Math.random() * 230,
    });
  }

  return points;
}

export default function SplashPreview() {
  const dots = useMemo(() => buildDotPoints(), []);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#003366',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      }}
    >
      <div style={{ width: '100%', maxWidth: '520px', textAlign: 'center' }}>
        <motion.div
          initial={{ opacity: 0.9 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.7 }}
          style={{ display: 'inline-block' }}
        >
          <motion.svg
            width="340"
            height="250"
            viewBox="0 0 360 260"
            role="img"
            aria-label="VividAqua logo animation"
            style={{ overflow: 'visible' }}
            animate={{ scale: [1, 1, 1.04, 1] }}
            transition={{ delay: 2.2, duration: 5, ease: 'easeInOut', repeat: Infinity }}
          >
            <defs>
              <linearGradient id="vivid-aqua-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#003366" />
                <stop offset="55%" stopColor="#008ac6" />
                <stop offset="100%" stopColor="#00FFFF" />
              </linearGradient>
            </defs>

            {dots.map((dot, index) => (
              <motion.circle
                key={dot.id}
                cx={dot.sx}
                cy={dot.sy}
                r="3.2"
                fill="#ffffff"
                initial={{ opacity: 0.95 }}
                animate={{
                  cx: dot.tx,
                  cy: dot.ty,
                  opacity: [0.95, 1, 0.2],
                  scale: [1, 1, 0.72],
                }}
                transition={{
                  duration: 1.5,
                  delay: index * 0.02,
                  ease: [0.22, 1, 0.36, 1],
                }}
              />
            ))}

            <motion.path
              d="M78 56 L180 206 L282 56"
              fill="none"
              stroke="url(#vivid-aqua-grad)"
              strokeWidth="42"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ delay: 1.2, duration: 1.4, ease: 'easeInOut' }}
            />
          </motion.svg>
        </motion.div>

        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 2.8, duration: 1.2, ease: 'easeOut' }}
          style={{
            marginTop: '10px',
            color: 'rgba(208, 245, 255, 0.95)',
            fontFamily: 'Orbitron, Rajdhani, "Segoe UI", sans-serif',
            letterSpacing: '0.2em',
            fontSize: '14px',
            textTransform: 'uppercase',
          }}
        >
          最纯净的水
        </motion.p>
      </div>
    </div>
  );
}
