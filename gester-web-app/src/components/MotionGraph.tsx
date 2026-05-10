import React from 'react';
import { tiltStore, type TiltReading } from '../lib/tiltStore';

const ANGLE_RANGE_DEG = 45;
const MAGNITUDE_MAX_DPS = 400;
const TRAIL_MS = 1500;

type TrailPoint = {
  x: number;
  y: number;
  mag: number;
  t: number;
};

type MotionGraphProps = {
  embedded?: boolean;
};

function magnitudeToHsla(mag: number, alpha = 1) {
  const normalized = Math.min(1, Math.max(0, mag / MAGNITUDE_MAX_DPS));
  const hue = 240 * (1 - normalized);
  return `hsla(${hue.toFixed(0)}, 85%, 55%, ${alpha})`;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export default function MotionGraph({ embedded = false }: MotionGraphProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const latestRef = React.useRef<TiltReading | null>(null);
  const trailRef = React.useRef<TrailPoint[]>([]);

  const canvasSize = embedded ? 180 : 200;

  React.useEffect(() => {
    return tiltStore.subscribe((reading) => {
      latestRef.current = reading;
    });
  }, []);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasSize * dpr;
    canvas.height = canvasSize * dpr;
    canvas.style.width = `${canvasSize}px`;
    canvas.style.height = `${canvasSize}px`;
    ctx.scale(dpr, dpr);

    const cx = canvasSize / 2;
    const cy = canvasSize / 2;
    const margin = embedded ? 8 : 16;
    const scale = (canvasSize / 2 - margin) / ANGLE_RANGE_DEG;

    let raf = 0;
    let lastSampleTimestamp = 0;

    const draw = () => {
      const now = performance.now();

      if (embedded) {
        ctx.clearRect(0, 0, canvasSize, canvasSize);
      } else {
        ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
        ctx.fillRect(0, 0, canvasSize, canvasSize);
      }

      ctx.strokeStyle = embedded ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      for (let d = -ANGLE_RANGE_DEG; d <= ANGLE_RANGE_DEG; d += 15) {
        const x = cx + d * scale;
        const y = cy + d * scale;
        ctx.beginPath();
        ctx.moveTo(x, margin);
        ctx.lineTo(x, canvasSize - margin);
        ctx.moveTo(margin, y);
        ctx.lineTo(canvasSize - margin, y);
        ctx.stroke();
      }

      ctx.strokeStyle = embedded ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.25)';
      ctx.beginPath();
      ctx.moveTo(margin, cy);
      ctx.lineTo(canvasSize - margin, cy);
      ctx.moveTo(cx, margin);
      ctx.lineTo(cx, canvasSize - margin);
      ctx.stroke();

      if (!embedded) {
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.font = '10px Rubik, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('roll →', canvasSize - 18, cy - 4);
        ctx.textAlign = 'left';
        ctx.save();
        ctx.translate(cx + 4, 18);
        ctx.fillText('↑ pitch', 0, 0);
        ctx.restore();
      }

      const reading = latestRef.current;
      if (reading && performance.now() - lastSampleTimestamp > 0) {
        const px = cx + clamp(reading.roll, -ANGLE_RANGE_DEG, ANGLE_RANGE_DEG) * scale;
        const py = cy - clamp(reading.pitch, -ANGLE_RANGE_DEG, ANGLE_RANGE_DEG) * scale;
        trailRef.current.push({ x: px, y: py, mag: reading.magnitude, t: now });
        lastSampleTimestamp = now;
      }

      trailRef.current = trailRef.current.filter((p) => now - p.t < TRAIL_MS);

      for (const p of trailRef.current) {
        const age = (now - p.t) / TRAIL_MS;
        const alpha = 1 - age;
        ctx.fillStyle = magnitudeToHsla(p.mag, alpha * 0.85);
        ctx.beginPath();
        ctx.arc(p.x, p.y, embedded ? 2 : 3, 0, Math.PI * 2);
        ctx.fill();
      }

      const last = trailRef.current[trailRef.current.length - 1];
      if (last) {
        ctx.shadowColor = magnitudeToHsla(last.mag, 1);
        ctx.shadowBlur = embedded ? 10 : 16;
        ctx.fillStyle = magnitudeToHsla(last.mag, 1);
        ctx.beginPath();
        ctx.arc(last.x, last.y, embedded ? 5 : 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => cancelAnimationFrame(raf);
  }, [canvasSize, embedded]);

  if (embedded) {
    return (
      <div
        className="rounded-full overflow-hidden pointer-events-none"
        style={{
          width: canvasSize,
          height: canvasSize,
          background: 'rgba(15, 23, 42, 0.35)',
        }}
      >
        <canvas ref={canvasRef} />
      </div>
    );
  }

  return (
    <div className="absolute bottom-6 right-6 z-30">
      <div
        className="backdrop-blur-md border border-white/25 rounded-xl p-3"
        style={{
          background:
            'linear-gradient(135deg, rgba(30, 41, 59, 0.75), rgba(51, 65, 85, 0.45))',
          boxShadow: '0 10px 30px rgba(0, 0, 0, 0.25)',
          fontFamily: 'Rubik, sans-serif',
        }}
      >
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs text-white/85 tracking-wide">Motion</h3>
          <span className="text-[10px] text-white/50">±{ANGLE_RANGE_DEG}° / {MAGNITUDE_MAX_DPS} dps</span>
        </div>

        <canvas ref={canvasRef} className="rounded-md" />

        <div className="mt-2">
          <div
            className="h-1.5 w-full rounded-full"
            style={{
              background:
                'linear-gradient(90deg, hsla(240,85%,55%,1) 0%, hsla(180,85%,55%,1) 25%, hsla(120,85%,55%,1) 50%, hsla(60,85%,55%,1) 75%, hsla(0,85%,55%,1) 100%)',
            }}
          />
          <div className="flex justify-between text-[9px] text-white/55 mt-1">
            <span>still</span>
            <span>fast (gyro mag)</span>
          </div>
        </div>
      </div>
    </div>
  );
}
