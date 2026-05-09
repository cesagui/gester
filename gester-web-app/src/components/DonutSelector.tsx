import React from 'react';
import TiltTelemetry from './TiltTelemetry';
import MotionGraph from './MotionGraph';
import { tiltStore } from '../lib/tiltStore';

const TILT_DEADZONE_DEG = 8;

export default function DonutSelector() {
  const [hoveredSection, setHoveredSection] = React.useState<number | null>(null);
  const [selectedSection, setSelectedSection] = React.useState<number | null>(null);
  const [showRectangle, setShowRectangle] = React.useState(false);
  const [hoveredChar, setHoveredChar] = React.useState<number | null>(null);

  const showRectangleRef = React.useRef(showRectangle);
  React.useEffect(() => {
    showRectangleRef.current = showRectangle;
  }, [showRectangle]);

  const lastTiltSectionRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    return tiltStore.subscribe((reading) => {
      if (showRectangleRef.current) return;

      const tiltMag = Math.hypot(reading.pitch, reading.roll);
      let next: number | null = null;
      if (tiltMag >= TILT_DEADZONE_DEG) {
        let angleDeg = (Math.atan2(reading.roll, reading.pitch) * 180) / Math.PI;
        if (angleDeg < 0) angleDeg += 360;
        next = Math.floor(angleDeg / 45) % 8;
      }

      if (next !== lastTiltSectionRef.current) {
        lastTiltSectionRef.current = next;
        setHoveredSection(next);
      }
    });
  }, []);

  const sections = [
    { letters: 'ETA', gradient: 'url(#gradient0)' },
    { letters: 'OIN', gradient: 'url(#gradient1)' },
    { letters: 'SHR', gradient: 'url(#gradient2)' },
    { letters: 'DLCU', gradient: 'url(#gradient3)' },
    { letters: ".?'", gradient: 'url(#gradient4)' },
    { letters: 'FWG', gradient: 'url(#gradient5)' },
    { letters: 'UPBV', gradient: 'url(#gradient6)' },
    { letters: 'KJXQZ', gradient: 'url(#gradient7)' }
  ];

  const gradients = [
    { start: 'rgba(156, 163, 175, 0.4)', end: 'rgba(156, 163, 175, 0.2)' },
    { start: 'rgba(148, 156, 168, 0.4)', end: 'rgba(148, 156, 168, 0.2)' },
    { start: 'rgba(140, 149, 161, 0.4)', end: 'rgba(140, 149, 161, 0.2)' },
    { start: 'rgba(132, 142, 154, 0.4)', end: 'rgba(132, 142, 154, 0.2)' },
    { start: 'rgba(124, 135, 147, 0.4)', end: 'rgba(124, 135, 147, 0.2)' },
    { start: 'rgba(116, 128, 140, 0.4)', end: 'rgba(116, 128, 140, 0.2)' },
    { start: 'rgba(108, 121, 133, 0.4)', end: 'rgba(108, 121, 133, 0.2)' },
    { start: 'rgba(100, 114, 126, 0.4)', end: 'rgba(100, 114, 126, 0.2)' }
  ];

  const createDonutPath = (index: number) => {
    const anglePerSection = 360 / 8;
    const startAngle = index * anglePerSection;
    const endAngle = startAngle + anglePerSection;
    const outerRadius = 180;
    const innerRadius = 80;

    const startAngleRad = (startAngle - 90) * Math.PI / 180;
    const endAngleRad = (endAngle - 90) * Math.PI / 180;

    const x1 = 200 + outerRadius * Math.cos(startAngleRad);
    const y1 = 200 + outerRadius * Math.sin(startAngleRad);
    const x2 = 200 + outerRadius * Math.cos(endAngleRad);
    const y2 = 200 + outerRadius * Math.sin(endAngleRad);
    const x3 = 200 + innerRadius * Math.cos(endAngleRad);
    const y3 = 200 + innerRadius * Math.sin(endAngleRad);
    const x4 = 200 + innerRadius * Math.cos(startAngleRad);
    const y4 = 200 + innerRadius * Math.sin(startAngleRad);

    return `M ${x1} ${y1} A ${outerRadius} ${outerRadius} 0 0 1 ${x2} ${y2} L ${x3} ${y3} A ${innerRadius} ${innerRadius} 0 0 0 ${x4} ${y4} Z`;
  };

  const getTextPosition = (index: number) => {
    const anglePerSection = 360 / 8;
    const midAngle = index * anglePerSection + anglePerSection / 2;
    const textRadius = 130;
    const angleRad = (midAngle - 90) * Math.PI / 180;

    return {
      x: 200 + textRadius * Math.cos(angleRad),
      y: 200 + textRadius * Math.sin(angleRad)
    };
  };

  const createBorderPath = (index: number) => {
    const anglePerSection = 360 / 8;
    const startAngle = index * anglePerSection;
    const endAngle = startAngle + anglePerSection;
    const outerRadius = 180;
    const innerRadius = 80;

    const startAngleRad = (startAngle - 90) * Math.PI / 180;
    const endAngleRad = (endAngle - 90) * Math.PI / 180;

    const x1 = 200 + outerRadius * Math.cos(startAngleRad);
    const y1 = 200 + outerRadius * Math.sin(startAngleRad);
    const x2 = 200 + outerRadius * Math.cos(endAngleRad);
    const y2 = 200 + outerRadius * Math.sin(endAngleRad);
    const x3 = 200 + innerRadius * Math.cos(endAngleRad);
    const y3 = 200 + innerRadius * Math.sin(endAngleRad);
    const x4 = 200 + innerRadius * Math.cos(startAngleRad);
    const y4 = 200 + innerRadius * Math.sin(startAngleRad);

    return `M ${x1} ${y1} A ${outerRadius} ${outerRadius} 0 0 1 ${x2} ${y2} L ${x3} ${y3} A ${innerRadius} ${innerRadius} 0 0 0 ${x4} ${y4} L ${x1} ${y1}`;
  };

  const handleSectionClick = (index: number) => {
    setSelectedSection(index);
    setShowRectangle(true);
  };

  const handleBack = () => {
    setShowRectangle(false);
    setSelectedSection(null);
    setHoveredSection(null);
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-linear-to-br from-slate-900 via-slate-800 to-slate-900 relative">
      <TiltTelemetry />
      <MotionGraph />
      <svg
        width="500"
        height="500"
        viewBox="0 0 400 400"
        className="drop-shadow-2xl transition-opacity duration-500 absolute"
        style={{ opacity: showRectangle ? 0 : 1, pointerEvents: showRectangle ? 'none' : 'auto' }}
      >
        <defs>
          {gradients.map((grad, index) => (
            <linearGradient key={index} id={`gradient${index}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" style={{ stopColor: grad.start, stopOpacity: 1 }} />
              <stop offset="100%" style={{ stopColor: grad.end, stopOpacity: 1 }} />
            </linearGradient>
          ))}
          <filter id="glow">
            <feGaussianBlur stdDeviation="1.5" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>

        {sections.map((section, index) => {
          const pos = getTextPosition(index);
          const isHovered = hoveredSection === index;
          const borderPath = createBorderPath(index);
          const pathLength = 600;

          return (
            <g
              key={index}
              onMouseEnter={() => !showRectangle && setHoveredSection(index)}
              onMouseLeave={() => !showRectangle && setHoveredSection(null)}
              onClick={() => handleSectionClick(index)}
              className="cursor-pointer"
            >
              <path
                d={createDonutPath(index)}
                fill={section.gradient}
                stroke="none"
              />
              <path
                d={borderPath}
                fill="none"
                stroke="rgba(255, 255, 255, 0.5)"
                strokeWidth={isHovered ? "4" : "0.5"}
                strokeDasharray={pathLength}
                strokeDashoffset={isHovered ? 0 : pathLength}
                className="pointer-events-none"
                style={{
                  transition: isHovered
                    ? 'stroke-dashoffset 0.4s ease-out, stroke-width 0.2s ease-out'
                    : 'stroke-dashoffset 0.4s ease-in, stroke-width 0.2s ease-in'
                }}
              />
              <text
                x={pos.x}
                y={pos.y}
                textAnchor="middle"
                dominantBaseline="middle"
                className="text-xl font-medium fill-white select-none"
                filter="url(#glow)"
                style={{ letterSpacing: '0.05em', fontFamily: 'Rubik, sans-serif' }}
              >
                {section.letters}
              </text>
            </g>
          );
        })}

        <circle
          cx="200"
          cy="200"
          r="180"
          fill="none"
          stroke="rgba(255, 255, 255, 0.2)"
          strokeWidth="2"
        />
        <circle
          cx="200"
          cy="200"
          r="80"
          fill="none"
          stroke="rgba(255, 255, 255, 0.2)"
          strokeWidth="2"
        />
      </svg>

      {showRectangle && selectedSection !== null && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-8">
          <div
            className="flex backdrop-blur-md border border-white/30 rounded-lg overflow-hidden relative"
            style={{
              background: 'linear-gradient(135deg, rgba(156, 163, 175, 0.3), rgba(156, 163, 175, 0.15))',
              boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.3)',
              animation: 'slideIn 0.4s ease-out both'
            }}
          >
            {sections[selectedSection].letters.split('').map((char, idx) => {
              const isCharHovered = hoveredChar === idx;

              return (
                <div
                  key={idx}
                  className="w-20 h-24 flex items-center justify-center relative"
                  style={{
                    borderRight: idx < sections[selectedSection].letters.length - 1 ? '1px solid rgba(255, 255, 255, 0.2)' : 'none'
                  }}
                  onMouseEnter={() => setHoveredChar(idx)}
                  onMouseLeave={() => setHoveredChar(null)}
                >
                  <div
                    className="absolute inset-0 pointer-events-none border-2 border-white/60 transition-opacity duration-200"
                    style={{ opacity: isCharHovered ? 1 : 0 }}
                  />
                  <span
                    className="text-3xl font-medium text-white select-none relative z-10"
                    style={{
                      fontFamily: 'Rubik, sans-serif',
                      textShadow: '0 2px 8px rgba(0, 0, 0, 0.5)'
                    }}
                  >
                    {char}
                  </span>
                </div>
              );
            })}
          </div>
          <button
            onClick={handleBack}
            className="px-6 py-3 backdrop-blur-md border border-white/30 rounded-lg transition-all duration-300 hover:bg-white/10"
            style={{
              background: 'linear-gradient(135deg, rgba(156, 163, 175, 0.2), rgba(156, 163, 175, 0.1))',
              boxShadow: '0 4px 16px 0 rgba(0, 0, 0, 0.2)',
              fontFamily: 'Rubik, sans-serif',
              animation: 'slideIn 0.4s ease-out 0.1s both'
            }}
          >
            <span className="text-white font-medium">Back</span>
          </button>
        </div>
      )}

      <style>{`
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateY(-20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}