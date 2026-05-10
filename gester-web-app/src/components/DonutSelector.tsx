import React from 'react';
import TiltTelemetry from './TiltTelemetry';
import MotionGraph from './MotionGraph';
import { tiltStore } from '../lib/tiltStore';

// ── Sensitivity knobs ────────────────────────────────────────────────────
// Wheel (outer sections) — pitch → section index
const WHEEL_PITCH_RANGE_DEG = 90; // total pitch span across all wheel sections
const WHEEL_DEADZONE_DEG = 5;     // |pitch| below this → nothing selected (rest pose)

// Letter rectangle — pitch → subgroup index inside the active group
const LETTER_PITCH_MAX_DEG = 30;  // ±this maps across the subgroups (smaller = more sensitive)

// Magnitude flick "select" gesture (with hysteresis)
const MAGNITUDE_ENGAGE = 750;     // rising-edge: must exceed this to fire a select
const MAGNITUDE_REARM = 400;      // must fall below this before another select can fire

// Section "anchor" (lock current section after holding this long)
const ANCHOR_DELAY_MS = 500;

const SECTIONS = [
  { letters: 'ABCDEFG', gradient: 'url(#gradient0)' },
  { letters: 'HIJKLMN', gradient: 'url(#gradient1)' },
  { letters: 'OPQRSTU', gradient: 'url(#gradient2)' },
  { letters: 'VWXYZ.!', gradient: 'url(#gradient3)' }
];

const GRADIENTS = [
  { start: 'rgba(156, 163, 175, 0.4)', end: 'rgba(156, 163, 175, 0.2)', hoverStart: 'rgba(139, 92, 246, 0.85)', hoverEnd: 'rgba(99, 102, 241, 0.65)' },
  { start: 'rgba(148, 156, 168, 0.4)', end: 'rgba(148, 156, 168, 0.2)', hoverStart: 'rgba(99, 102, 241, 0.85)', hoverEnd: 'rgba(59, 130, 246, 0.65)' },
  { start: 'rgba(140, 149, 161, 0.4)', end: 'rgba(140, 149, 161, 0.2)', hoverStart: 'rgba(59, 130, 246, 0.85)', hoverEnd: 'rgba(14, 165, 233, 0.65)' },
  { start: 'rgba(132, 142, 154, 0.4)', end: 'rgba(132, 142, 154, 0.2)', hoverStart: 'rgba(14, 165, 233, 0.85)', hoverEnd: 'rgba(6, 182, 212, 0.65)' }
];

const splitIntoGroups = (letters: string, groupCount: number) => {
  if (!letters) return Array.from({ length: groupCount }, () => '');

  const baseSize = Math.floor(letters.length / groupCount);
  let remainder = letters.length % groupCount;
  let start = 0;

  return Array.from({ length: groupCount }, () => {
    const size = baseSize + (remainder > 0 ? 1 : 0);
    remainder -= remainder > 0 ? 1 : 0;
    const group = letters.slice(start, start + size);
    start += size;
    return group;
  });
};

export default function DonutSelector() {
  const [hoveredSection, setHoveredSection] = React.useState<number | null>(null);
  const [selectedSection, setSelectedSection] = React.useState<number | null>(null);
  const [showRectangle, setShowRectangle] = React.useState(false);
  const [hoveredChar, setHoveredChar] = React.useState<number | null>(null);
  const [typedText, setTypedText] = React.useState('');
  const [activeGroupStack, setActiveGroupStack] = React.useState<string[]>([]);

  const showRectangleRef = React.useRef(showRectangle);
  React.useEffect(() => {
    showRectangleRef.current = showRectangle;
  }, [showRectangle]);

  const selectedSectionRef = React.useRef(selectedSection);
  React.useEffect(() => {
    selectedSectionRef.current = selectedSection;
  }, [selectedSection]);

  const activeGroupRef = React.useRef('');
  React.useEffect(() => {
    activeGroupRef.current = activeGroupStack[activeGroupStack.length - 1] ?? '';
  }, [activeGroupStack]);

  const openSelectedSection = (index: number) => {
    setHoveredSection(index);
    setSelectedSection(index);
    setActiveGroupStack([SECTIONS[index].letters]);
    setShowRectangle(true);
    setHoveredChar(0); // Reset to first character when opening rectangle
  };

  const lastTiltSectionRef = React.useRef<number | null>(null);
  const lastHighMagnitudeRef = React.useRef(false);
  const magnitudeTriggeredRef = React.useRef(false);
  const anchoredSectionRef = React.useRef<number | null>(null);
  const sectionStableTimeRef = React.useRef<number | null>(null);
  const anchorTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    return tiltStore.subscribe((reading) => {
      const isHighMagnitude = reading.magnitude >= MAGNITUDE_ENGAGE;
      const wasHighMagnitude = lastHighMagnitudeRef.current;
      lastHighMagnitudeRef.current = isHighMagnitude;

      // Hysteresis: only re-arm after magnitude has fallen below the lower threshold.
      // Prevents double-firing when the signal hovers near MAGNITUDE_ENGAGE.
      if (reading.magnitude < MAGNITUDE_REARM) {
        magnitudeTriggeredRef.current = false;
      }

      // Handle rectangle stage: map pitch values to subgroup selection
      if (showRectangleRef.current) {
        const activeLetters = activeGroupRef.current;
        if (activeLetters) {
          const groups = splitIntoGroups(activeLetters, 4);
          const availableGroups = groups.filter((group) => group.length > 0);
          const groupCount = availableGroups.length;

          const pitchForGroup = reading.pitch;
          if (typeof pitchForGroup === 'number' && groupCount > 0) {
            const clampedPitch = Math.max(-LETTER_PITCH_MAX_DEG, Math.min(LETTER_PITCH_MAX_DEG, pitchForGroup));
            const ratio = (clampedPitch + LETTER_PITCH_MAX_DEG) / (2 * LETTER_PITCH_MAX_DEG);
            let groupIdx = Math.floor(ratio * groupCount);
            if (groupIdx >= groupCount) groupIdx = groupCount - 1;
            const clampedIdx = Math.min(Math.max(groupIdx, 0), groupCount - 1);
            setHoveredChar(clampedIdx);

            // Confirm selection on a rising-edge magnitude spike (latch until it goes low)
            if (isHighMagnitude && !wasHighMagnitude && !magnitudeTriggeredRef.current) {
              magnitudeTriggeredRef.current = true;
              const selectedGroup = availableGroups[clampedIdx];

              if (selectedGroup.length > 1) {
                setActiveGroupStack((prev) => [...prev, selectedGroup]);
                setHoveredChar(0);
              } else {
                setTypedText((prev) => prev + selectedGroup);

                // Return to the wheel UI immediately after selecting a single letter
                setShowRectangle(false);
                setSelectedSection(null);
                setHoveredSection(null);
                setHoveredChar(null);
                setActiveGroupStack([]);

                // Clear any anchored state/timers so wheel behaves normally
                anchoredSectionRef.current = null;
                sectionStableTimeRef.current = null;
                if (anchorTimerRef.current) {
                  clearTimeout(anchorTimerRef.current);
                  anchorTimerRef.current = null;
                }
              }
            }
          }
        }
        return;
      }

      // Use rising-edge magnitude to open the rectangle, but only if not already triggered
      if (isHighMagnitude && !wasHighMagnitude && !magnitudeTriggeredRef.current) {
        magnitudeTriggeredRef.current = true;
        const currentSection = lastTiltSectionRef.current;
        if (currentSection !== null) {
          openSelectedSection(currentSection);
        }
        return;
      }

      // Map pitch evenly across the wheel's sections, with a small deadzone at rest.
      let next: number | null = null;
      const pitch = reading.pitch;
      const bins = SECTIONS.length;

      if (typeof pitch === 'number' && Math.abs(pitch) >= WHEEL_DEADZONE_DEG) {
        // Wrap pitch into [0, WHEEL_PITCH_RANGE_DEG) so values outside loop around.
        let normalized = pitch % WHEEL_PITCH_RANGE_DEG;
        if (normalized < 0) normalized += WHEEL_PITCH_RANGE_DEG;

        const ratio = normalized / WHEEL_PITCH_RANGE_DEG;
        next = Math.floor(ratio * bins);
        if (next >= bins) next = bins - 1;
      }

      // If a section is anchored, only allow leaving it to move to a different section
      if (anchoredSectionRef.current !== null) {
        if (next === anchoredSectionRef.current) {
          // Stay in anchored section, no change needed
          return;
        } else {
          // User tilted enough to leave anchored section
          anchoredSectionRef.current = null;
          sectionStableTimeRef.current = null;
          if (anchorTimerRef.current) clearTimeout(anchorTimerRef.current);
          // Allow the new section to be set below
        }
      }

      // Update section if it changed
      if (next !== lastTiltSectionRef.current) {
        lastTiltSectionRef.current = next;
        setHoveredSection(next);
        
        // Reset stable timer on section change
        sectionStableTimeRef.current = Date.now();
        if (anchorTimerRef.current) clearTimeout(anchorTimerRef.current);
        
        // Set timer to anchor this section after ANCHOR_DELAY_MS
        anchorTimerRef.current = setTimeout(() => {
          anchoredSectionRef.current = next;
        }, ANCHOR_DELAY_MS);
      }
    });
  }, []);

  React.useEffect(() => {
    return () => {
      if (anchorTimerRef.current) clearTimeout(anchorTimerRef.current);
    };
  }, []);

  const createDonutPath = (index: number) => {
    const anglePerSection = 360 / SECTIONS.length;
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
    const anglePerSection = 360 / SECTIONS.length;
    const midAngle = index * anglePerSection + anglePerSection / 2;
    const textRadius = 130;
    const angleRad = (midAngle - 90) * Math.PI / 180;

    return {
      x: 200 + textRadius * Math.cos(angleRad),
      y: 200 + textRadius * Math.sin(angleRad)
    };
  };

  const createBorderPath = (index: number) => {
    const anglePerSection = 360 / SECTIONS.length;
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
    openSelectedSection(index);
  };

  const handleBack = () => {
    if (activeGroupStack.length > 1) {
      setActiveGroupStack((prev) => prev.slice(0, -1));
      setHoveredChar(0);
      return;
    }

    setShowRectangle(false);
    setSelectedSection(null);
    setHoveredSection(null);
    setHoveredChar(null);
    setActiveGroupStack([]);
  };

  const handleBackspace = () => {
    setTypedText((prev) => prev.slice(0, -1));
  };

  const handleClear = () => {
    setTypedText('');
  };

  const activeGroupLetters = activeGroupStack[activeGroupStack.length - 1] ?? '';
  const activeGroups = splitIntoGroups(activeGroupLetters, 4);
  const activeGradient = selectedSection !== null ? GRADIENTS[selectedSection] : GRADIENTS[0];

  return (
    <div className="min-h-screen w-full bg-linear-to-br from-slate-900 via-slate-800 to-slate-900 relative overflow-hidden">
      <TiltTelemetry />

      <div className="absolute top-1/2 left-8 -translate-y-1/2 w-[50%] max-w-3xl z-20">
        <div
          className="backdrop-blur-md border border-white/30 rounded-xl p-6"
          style={{
            background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.85), rgba(51, 65, 85, 0.55))',
            boxShadow: '0 10px 40px rgba(0, 0, 0, 0.3), 0 0 60px rgba(99, 102, 241, 0.15)',
            fontFamily: 'Atkinson Hyperlegible, sans-serif',
          }}
        >
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs uppercase tracking-wider text-white/70 font-semibold">Input</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleBackspace}
                className="text-xs px-3 py-1.5 rounded-md border border-white/30 text-white/90 hover:bg-white/15 hover:border-white/40 transition-all duration-200 hover:shadow-lg"
              >
                ⌫
              </button>
              <button
                type="button"
                onClick={handleClear}
                className="text-xs px-3 py-1.5 rounded-md border border-white/30 text-white/90 hover:bg-white/15 hover:border-white/40 transition-all duration-200 hover:shadow-lg"
              >
                Clear
              </button>
            </div>
          </div>
          <p className="text-2xl text-white font-medium font-mono wrap-break-word min-h-10">
            {typedText || <span className="text-white/30">_</span>}
            <span
              className="inline-block w-0.5 h-6 ml-0.5 animate-pulse align-middle"
              style={{
                background: 'linear-gradient(to bottom, rgba(139, 92, 246, 0.9), rgba(99, 102, 241, 0.9))',
                boxShadow: '0 0 10px rgba(139, 92, 246, 0.6)',
              }}
            />
          </p>
        </div>
      </div>

      <div
        className="absolute top-1/2 right-8 -translate-y-1/2 z-10"
        style={{ width: '460px', height: '460px' }}
      >
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
        style={{ opacity: showRectangle ? 0 : 1, transition: 'opacity 0.5s' }}
      >
        <MotionGraph embedded />
      </div>
      <svg
        width="460"
        height="460"
        viewBox="0 0 400 400"
        className="drop-shadow-2xl transition-opacity duration-500 relative"
        style={{ opacity: showRectangle ? 0 : 1, pointerEvents: showRectangle ? 'none' : 'auto' }}
      >
        <defs>
          {GRADIENTS.map((grad, index) => (
            <React.Fragment key={index}>
              <linearGradient id={`gradient${index}`} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style={{ stopColor: grad.start, stopOpacity: 1 }} />
                <stop offset="100%" style={{ stopColor: grad.end, stopOpacity: 1 }} />
              </linearGradient>
              <linearGradient id={`gradientHover${index}`} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style={{ stopColor: grad.hoverStart, stopOpacity: 1 }} />
                <stop offset="100%" style={{ stopColor: grad.hoverEnd, stopOpacity: 1 }} />
              </linearGradient>
            </React.Fragment>
          ))}
          <filter id="glow">
            <feGaussianBlur stdDeviation="1.5" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
          <filter id="glowHover">
            <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>

        {SECTIONS.map((section, index) => {
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
                fill={isHovered ? `url(#gradientHover${index})` : section.gradient}
                stroke="none"
                style={{ transition: 'fill 0.3s ease-out' }}
              />
              <path
                d={borderPath}
                fill="none"
                stroke={isHovered ? "rgba(255, 255, 255, 0.8)" : "rgba(255, 255, 255, 0.5)"}
                strokeWidth={isHovered ? "4" : "0.5"}
                strokeDasharray={pathLength}
                strokeDashoffset={isHovered ? 0 : pathLength}
                className="pointer-events-none"
                style={{
                  transition: isHovered
                    ? 'stroke-dashoffset 0.4s ease-out, stroke-width 0.2s ease-out, stroke 0.3s ease-out'
                    : 'stroke-dashoffset 0.4s ease-in, stroke-width 0.2s ease-in, stroke 0.3s ease-in',
                  filter: isHovered ? 'drop-shadow(0 0 8px rgba(255, 255, 255, 0.6))' : 'none'
                }}
              />
              <text
                x={pos.x}
                y={pos.y}
                textAnchor="middle"
                dominantBaseline="middle"
                className="text-xl font-medium fill-white select-none"
                filter={isHovered ? "url(#glowHover)" : "url(#glow)"}
                style={{
                  letterSpacing: '0.05em',
                  fontFamily: 'Atkinson Hyperlegible, sans-serif',
                  transition: 'filter 0.3s ease-out, transform 0.3s ease-out',
                  transform: isHovered ? 'scale(1.1)' : 'scale(1)',
                  transformOrigin: 'center'
                }}
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
      </div>

      {showRectangle && selectedSection !== null && (
        <div className="absolute top-1/2 right-8 -translate-y-1/2 z-10 flex flex-col items-center justify-center gap-6" style={{ width: '460px', height: '460px' }}>
          <div className="relative flex items-center justify-center" style={{ width: '420px', height: '420px', animation: 'slideIn 0.4s ease-out both' }}>
            <svg width="420" height="420" viewBox="0 0 400 400" className="drop-shadow-2xl">
              <defs>
                <linearGradient id="subgroupBase" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" style={{ stopColor: activeGradient.start, stopOpacity: 1 }} />
                  <stop offset="100%" style={{ stopColor: activeGradient.end, stopOpacity: 1 }} />
                </linearGradient>
                <linearGradient id="subgroupHover" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" style={{ stopColor: activeGradient.hoverStart, stopOpacity: 1 }} />
                  <stop offset="100%" style={{ stopColor: activeGradient.hoverEnd, stopOpacity: 1 }} />
                </linearGradient>
                <filter id="subgroupGlow">
                  <feGaussianBlur stdDeviation="2.5" result="coloredBlur" />
                  <feMerge>
                    <feMergeNode in="coloredBlur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {activeGroups.map((group, index) => {
                const pos = getTextPosition(index);
                const isHovered = hoveredChar === index;
                const borderPath = createBorderPath(index);
                const pathLength = 600;

                return (
                  <g key={index} className="cursor-pointer">
                    <path
                      d={createDonutPath(index)}
                      fill={isHovered ? 'url(#subgroupHover)' : 'url(#subgroupBase)'}
                      stroke="none"
                      style={{ transition: 'fill 0.3s ease-out' }}
                    />
                    <path
                      d={borderPath}
                      fill="none"
                      stroke={isHovered ? 'rgba(255, 255, 255, 0.85)' : 'rgba(255, 255, 255, 0.45)'}
                      strokeWidth={isHovered ? '4' : '0.5'}
                      strokeDasharray={pathLength}
                      strokeDashoffset={isHovered ? 0 : pathLength}
                      className="pointer-events-none"
                      style={{
                        transition: isHovered
                          ? 'stroke-dashoffset 0.4s ease-out, stroke-width 0.2s ease-out, stroke 0.3s ease-out'
                          : 'stroke-dashoffset 0.4s ease-in, stroke-width 0.2s ease-in, stroke 0.3s ease-in',
                        filter: isHovered ? 'drop-shadow(0 0 8px rgba(255, 255, 255, 0.6))' : 'none'
                      }}
                    />
                    {group.length > 0 && (
                      <text
                        x={pos.x}
                        y={pos.y}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        className="text-xl font-medium fill-white select-none"
                        filter="url(#subgroupGlow)"
                        style={{
                          letterSpacing: '0.05em',
                          fontFamily: 'Atkinson Hyperlegible, sans-serif',
                          transition: 'filter 0.3s ease-out, transform 0.3s ease-out',
                          transform: isHovered ? 'scale(1.1)' : 'scale(1)',
                          transformOrigin: 'center'
                        }}
                      >
                        {group}
                      </text>
                    )}
                  </g>
                );
              })}

              <circle cx="200" cy="200" r="180" fill="none" stroke="rgba(255, 255, 255, 0.2)" strokeWidth="2" />
              <circle cx="200" cy="200" r="80" fill="none" stroke="rgba(255, 255, 255, 0.2)" strokeWidth="2" />
            </svg>
          </div>
          <button
            onClick={handleBack}
            className="px-6 py-3 backdrop-blur-md border border-white/40 rounded-lg transition-all duration-300"
            style={{
              background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.15), rgba(255, 255, 255, 0.05))',
              boxShadow: '0 4px 16px 0 rgba(0, 0, 0, 0.3)',
              fontFamily: 'Atkinson Hyperlegible, sans-serif',
              animation: 'slideIn 0.4s ease-out 0.1s both'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'linear-gradient(135deg, rgba(255, 255, 255, 0.25), rgba(255, 255, 255, 0.15))';
              e.currentTarget.style.boxShadow = '0 4px 20px 0 rgba(255, 255, 255, 0.2)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'linear-gradient(135deg, rgba(255, 255, 255, 0.15), rgba(255, 255, 255, 0.05))';
              e.currentTarget.style.boxShadow = '0 4px 16px 0 rgba(0, 0, 0, 0.3)';
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