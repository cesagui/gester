import React from 'react';
import { FaBackspace } from 'react-icons/fa';
import { IoIosCloseCircle } from 'react-icons/io';
import { TbNumber123 } from 'react-icons/tb';
import TiltTelemetry from './TiltTelemetry';
import MotionGraph from './MotionGraph';
import { tiltStore } from '../lib/tiltStore';

// ── Sensitivity knobs ────────────────────────────────────────────────────
// Wheel (outer sections) — pitch → section index
const WHEEL_PITCH_RANGE_DEG = 90; // total pitch span across all wheel sections
const WHEEL_DEADZONE_DEG = 5;     // |pitch| below this → nothing selected (rest pose)
const WHEEL_HYSTERESIS_DEG = 3;   // pitch must overshoot a boundary by this much to switch sections

// Letter rectangle — pitch → subgroup index inside the active group
const LETTER_PITCH_MAX_DEG = 30;     // ±this maps across the subgroups (smaller = more sensitive)
const LETTER_HYSTERESIS_DEG = 2;     // pitch must overshoot a subgroup boundary by this much to switch
const LETTER_ANCHOR_DELAY_MS = 400;  // dwell time before a subgroup locks in the rectangle

// Magnitude flick "select" gesture
const MAGNITUDE_ENGAGE = 400;     // rising-edge: must exceed this to fire a select
const REARM_DELAY_MS = 200;       // cooldown after a fire before another select can register

// Sidebar menu mode
const MENU_ENTER_ROLL_THRESHOLD = 50;
const MENU_EXIT_ROLL_THRESHOLD = -50;
const MENU_GLOW_START_DEG = 40;   // rim glow begins at this absolute roll, peaks at the threshold, hidden past it
const MENU_ENTER_HOLD_MS = 2000;
const MENU_EXIT_HOLD_MS = 1500; // hold duration to trigger "back" when in nested rectangle
const MENU_EXIT_HYSTERESIS_DEG = 8; // small hysteresis to avoid jitter canceling the hold
const MENU_BUTTONS = ['1', '2', '3'];

// Section "anchor" (lock current section after holding this long)
const ANCHOR_DELAY_MS = 500;
// ────────────────────────────────────────────────────

const SECTIONS = [
  { letters: 'ABCDEFG', gradient: 'url(#gradient0)' },
  { letters: 'HIJKLM', gradient: 'url(#gradient1)' },
  { letters: 'NOPQRST', gradient: 'url(#gradient2)' },
  { letters: 'UVWXYZ', gradient: 'url(#gradient3)' }
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
  const [anchoredSection, setAnchoredSection] = React.useState<number | null>(null);
  const [anchoredChar, setAnchoredChar] = React.useState<number | null>(null);
  const [isMenuMode, setIsMenuMode] = React.useState(false);
  const [hoveredMenuButton, setHoveredMenuButton] = React.useState<number | null>(null);
  const [currentRoll, setCurrentRoll] = React.useState(0);

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

  const menuModeRef = React.useRef(isMenuMode);
  React.useEffect(() => {
    menuModeRef.current = isMenuMode;
  }, [isMenuMode]);

  const openSelectedSection = (index: number) => {
    setHoveredSection(index);
    setSelectedSection(index);
    setActiveGroupStack([SECTIONS[index].letters]);
    setShowRectangle(true);
    setHoveredChar(0); // Reset to first character when opening rectangle
    setAnchoredChar(null);
  };

  const lastTiltSectionRef = React.useRef<number | null>(null);
  const lastHighMagnitudeRef = React.useRef(false);
  const magnitudeTriggeredRef = React.useRef(false);
  const anchoredSectionRef = React.useRef<number | null>(null);
  const sectionStableTimeRef = React.useRef<number | null>(null);
  const anchorTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const rearmTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuEnterTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const backHoldTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const rollFilteredRef = React.useRef<number | null>(null);
  const ROLL_FILTER_ALPHA = 0.22; // lower -> smoother, higher -> more responsive
  const lastCharIdxRef = React.useRef<number | null>(null);
  const anchoredCharRef = React.useRef<number | null>(null);
  const charAnchorTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeGroupDepthRef = React.useRef<number>(0);

  // Reset char tracking whenever the active group changes (entering rectangle, drilling deeper, exit)
  React.useEffect(() => {
    lastCharIdxRef.current = null;
    anchoredCharRef.current = null;
    if (charAnchorTimerRef.current) {
      clearTimeout(charAnchorTimerRef.current);
      charAnchorTimerRef.current = null;
    }
    // Keep a ref for the current depth of the active group stack so the
    // tilt subscription can detect nested levels reliably.
    activeGroupDepthRef.current = activeGroupStack.length;
  }, [activeGroupStack]);

  const fireSpike = () => {
    magnitudeTriggeredRef.current = true;
    if (rearmTimerRef.current) clearTimeout(rearmTimerRef.current);
    rearmTimerRef.current = setTimeout(() => {
      magnitudeTriggeredRef.current = false;
    }, REARM_DELAY_MS);
  };

  const enterMenuMode = () => {
    if (menuModeRef.current) return;

    setIsMenuMode(true);
    setHoveredMenuButton(0);

    // Exit wheel/letter selection UI when menu mode opens
    setShowRectangle(false);
    setSelectedSection(null);
    setHoveredSection(null);
    setHoveredChar(null);
    setActiveGroupStack([]);

    // Clear anchors/timers so returning to the wheel starts cleanly
    anchoredSectionRef.current = null;
    setAnchoredSection(null);
    sectionStableTimeRef.current = null;
    if (anchorTimerRef.current) {
      clearTimeout(anchorTimerRef.current);
      anchorTimerRef.current = null;
    }
    anchoredCharRef.current = null;
    setAnchoredChar(null);
    if (charAnchorTimerRef.current) {
      clearTimeout(charAnchorTimerRef.current);
      charAnchorTimerRef.current = null;
    }
    lastCharIdxRef.current = null;

    if (menuEnterTimerRef.current) {
      clearTimeout(menuEnterTimerRef.current);
      menuEnterTimerRef.current = null;
    }
  };

  const exitMenuMode = () => {
    if (!menuModeRef.current) return;
    setIsMenuMode(false);
    setHoveredMenuButton(null);

    if (menuEnterTimerRef.current) {
      clearTimeout(menuEnterTimerRef.current);
      menuEnterTimerRef.current = null;
    }
  };

  const handleBackspace = () => {
    setTypedText((prev) => prev.slice(0, -1));
  };

  const handleClear = () => {
    setTypedText('');
  };

  const handleBack = () => {
    if (activeGroupStack.length > 1) {
      setActiveGroupStack((prev) => prev.slice(0, -1));
      setHoveredChar(0);
      setAnchoredChar(null);
      return;
    }

    setShowRectangle(false);
    setSelectedSection(null);
    setHoveredSection(null);
    setHoveredChar(null);
    setActiveGroupStack([]);
  };

  React.useEffect(() => {
    return tiltStore.subscribe((reading) => {
      const isHighMagnitude = reading.magnitude >= MAGNITUDE_ENGAGE;
      const wasHighMagnitude = lastHighMagnitudeRef.current;
      lastHighMagnitudeRef.current = isHighMagnitude;
      const roll = reading.roll;
      let filteredRoll = roll;
      if (typeof roll === 'number') {
        if (rollFilteredRef.current === null) rollFilteredRef.current = roll;
        else rollFilteredRef.current = rollFilteredRef.current * (1 - ROLL_FILTER_ALPHA) + roll * ROLL_FILTER_ALPHA;
        filteredRoll = rollFilteredRef.current as number;
        setCurrentRoll(filteredRoll);
      }

      // Hold positive roll for 2s to enter menu mode (wheel stage only).
      if (!menuModeRef.current && !showRectangleRef.current) {
          if (filteredRoll !== undefined && filteredRoll !== null && filteredRoll >= MENU_ENTER_ROLL_THRESHOLD) {
          if (!menuEnterTimerRef.current) {
            menuEnterTimerRef.current = setTimeout(() => {
              enterMenuMode();
            }, MENU_ENTER_HOLD_MS);
          }
        } else if (menuEnterTimerRef.current) {
          clearTimeout(menuEnterTimerRef.current);
          menuEnterTimerRef.current = null;
        }
      } else if (menuEnterTimerRef.current) {
        clearTimeout(menuEnterTimerRef.current);
        menuEnterTimerRef.current = null;
      }

      // Back-hold while in rectangle: hold negative roll to go back one level or exit.
      if (!menuModeRef.current && showRectangleRef.current) {
        if (activeGroupDepthRef.current >= 1) {
          if (typeof filteredRoll === 'number' && filteredRoll <= MENU_EXIT_ROLL_THRESHOLD) {
            if (!backHoldTimerRef.current) {
              backHoldTimerRef.current = setTimeout(() => {
                handleBack();
                backHoldTimerRef.current = null;
              }, MENU_EXIT_HOLD_MS);
            }
          } else if (backHoldTimerRef.current) {
            // Only clear the timer if roll has moved back above the threshold
            // plus a small hysteresis to avoid cancelling due to jitter.
            if (typeof filteredRoll !== 'number' || filteredRoll > MENU_EXIT_ROLL_THRESHOLD + MENU_EXIT_HYSTERESIS_DEG) {
              clearTimeout(backHoldTimerRef.current);
              backHoldTimerRef.current = null;
            }
          }
        } else if (backHoldTimerRef.current) {
          clearTimeout(backHoldTimerRef.current);
          backHoldTimerRef.current = null;
        }
      } else if (backHoldTimerRef.current) {
        clearTimeout(backHoldTimerRef.current);
        backHoldTimerRef.current = null;
      }

      // Menu mode: pitch chooses button, flick presses, negative roll exits.
      if (menuModeRef.current) {
        if (roll <= MENU_EXIT_ROLL_THRESHOLD) {
          exitMenuMode();
          return;
        }

        const pitchForMenu = reading.pitch;
        if (typeof pitchForMenu === 'number') {
          const PITCH_MAX = 90;
          const clampedPitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, pitchForMenu));
          const ratio = (clampedPitch + PITCH_MAX) / (2 * PITCH_MAX);
          let menuIdx = Math.floor(ratio * MENU_BUTTONS.length);
          if (menuIdx >= MENU_BUTTONS.length) menuIdx = MENU_BUTTONS.length - 1;
          menuIdx = Math.min(Math.max(menuIdx, 0), MENU_BUTTONS.length - 1);
          setHoveredMenuButton(menuIdx);

          if (isHighMagnitude && !wasHighMagnitude && !magnitudeTriggeredRef.current) {
            fireSpike();
            if (menuIdx === 0) {
              handleClear();
            } else if (menuIdx === 1) {
              handleBackspace();
            } else if (menuIdx === 2) {
              console.log(`Menu button ${MENU_BUTTONS[menuIdx]} pressed`);
            }
          }
        }

        return;
      }

      // Re-arm is now timer-based: fireSpike() schedules magnitudeTriggeredRef
      // to flip back to false after REARM_DELAY_MS, regardless of magnitude.

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
            let rawIdx = Math.floor(ratio * groupCount);
            if (rawIdx >= groupCount) rawIdx = groupCount - 1;
            rawIdx = Math.min(Math.max(rawIdx, 0), groupCount - 1);

            // Hysteresis: stick to the current subgroup until pitch overshoots
            // its boundary by LETTER_HYSTERESIS_DEG.
            const subWidth = (2 * LETTER_PITCH_MAX_DEG) / groupCount;
            const lastChar = lastCharIdxRef.current;
            let clampedIdx = rawIdx;
            if (lastChar !== null && rawIdx !== lastChar && lastChar < groupCount) {
              const lastCenter = -LETTER_PITCH_MAX_DEG + (lastChar + 0.5) * subWidth;
              if (Math.abs(clampedPitch - lastCenter) < subWidth / 2 + LETTER_HYSTERESIS_DEG) {
                clampedIdx = lastChar;
              }
            }

            // Update hovered + restart anchor timer on actual change
            if (clampedIdx !== lastCharIdxRef.current) {
              lastCharIdxRef.current = clampedIdx;
              setHoveredChar(clampedIdx);

              if (anchoredCharRef.current !== null) {
                anchoredCharRef.current = null;
                setAnchoredChar(null);
              }
              if (charAnchorTimerRef.current) clearTimeout(charAnchorTimerRef.current);
              charAnchorTimerRef.current = setTimeout(() => {
                anchoredCharRef.current = clampedIdx;
                setAnchoredChar(clampedIdx);
              }, LETTER_ANCHOR_DELAY_MS);
            }

            // Confirm selection on a rising-edge magnitude spike
            if (isHighMagnitude && !wasHighMagnitude && !magnitudeTriggeredRef.current) {
              fireSpike();
              const selectedGroup = availableGroups[clampedIdx];

              // Clear letter anchor + timer
              anchoredCharRef.current = null;
              setAnchoredChar(null);
              if (charAnchorTimerRef.current) {
                clearTimeout(charAnchorTimerRef.current);
                charAnchorTimerRef.current = null;
              }
              lastCharIdxRef.current = null;

              if (selectedGroup.length > 1) {
                setActiveGroupStack((prev) => [...prev, selectedGroup]);
                setHoveredChar(0);
                setAnchoredChar(null);
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
                setAnchoredSection(null);
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
        fireSpike();
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
        let rawNext = Math.floor(ratio * bins);
        if (rawNext >= bins) rawNext = bins - 1;

        const last = lastTiltSectionRef.current;
        if (last === null || rawNext === last) {
          next = rawNext;
        } else {
          // Hysteresis: stick to the current section until pitch is past the
          // boundary by WHEEL_HYSTERESIS_DEG. Distance is measured from the
          // center of the last section, with wrap-around.
          const sectionWidth = WHEEL_PITCH_RANGE_DEG / bins;
          const lastCenter = (last + 0.5) * sectionWidth;
          let delta = normalized - lastCenter;
          if (delta > WHEEL_PITCH_RANGE_DEG / 2) delta -= WHEEL_PITCH_RANGE_DEG;
          if (delta < -WHEEL_PITCH_RANGE_DEG / 2) delta += WHEEL_PITCH_RANGE_DEG;

          if (Math.abs(delta) >= sectionWidth / 2 + WHEEL_HYSTERESIS_DEG) {
            next = rawNext;
          } else {
            next = last;
          }
        }
      }

      // If a section is anchored, only allow leaving it to move to a different section
      if (anchoredSectionRef.current !== null) {
        if (next === anchoredSectionRef.current) {
          // Stay in anchored section, no change needed
          return;
        } else {
          // User tilted enough to leave anchored section
          anchoredSectionRef.current = null;
          setAnchoredSection(null);
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
          setAnchoredSection(next);
        }, ANCHOR_DELAY_MS);
      }
    });
  }, []);

  React.useEffect(() => {
    return () => {
      if (anchorTimerRef.current) clearTimeout(anchorTimerRef.current);
      if (rearmTimerRef.current) clearTimeout(rearmTimerRef.current);
      if (charAnchorTimerRef.current) clearTimeout(charAnchorTimerRef.current);
      if (menuEnterTimerRef.current) clearTimeout(menuEnterTimerRef.current);
      if (backHoldTimerRef.current) clearTimeout(backHoldTimerRef.current);
    };
  }, []);

  const createDonutPath = (index: number, totalSections: number = SECTIONS.length) => {
    const anglePerSection = 360 / totalSections;
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

  const getTextPosition = (index: number, totalSections: number = SECTIONS.length) => {
    const anglePerSection = 360 / totalSections;
    const midAngle = index * anglePerSection + anglePerSection / 2;
    const textRadius = 130;
    const angleRad = (midAngle - 90) * Math.PI / 180;

    return {
      x: 200 + textRadius * Math.cos(angleRad),
      y: 200 + textRadius * Math.sin(angleRad)
    };
  };

  const createBorderPath = (index: number, totalSections: number = SECTIONS.length) => {
    const anglePerSection = 360 / totalSections;
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

  const activeGroupLetters = activeGroupStack[activeGroupStack.length - 1] ?? '';
  const activeGroups = splitIntoGroups(activeGroupLetters, 4).filter((group) => group.length > 0);
  const activeGradient = selectedSection !== null ? GRADIENTS[selectedSection] : GRADIENTS[0];

  // Roll-direction glows: only visible in the [MENU_GLOW_START_DEG, |threshold|] window.
  const computeRimIntensity = (roll: number, threshold: number) => {
    const sign = Math.sign(threshold) || 1;
    const absRoll = roll * sign;
    const absThreshold = Math.abs(threshold);
    if (absRoll < MENU_GLOW_START_DEG || absRoll > absThreshold) return 0;
    return (absRoll - MENU_GLOW_START_DEG) / (absThreshold - MENU_GLOW_START_DEG);
  };
  const enterIntensity = showRectangle ? 0 : computeRimIntensity(currentRoll, MENU_ENTER_ROLL_THRESHOLD);
  const exitIntensity = showRectangle ? 0 : computeRimIntensity(currentRoll, MENU_EXIT_ROLL_THRESHOLD);

  return (
    <div className="min-h-screen w-full bg-linear-to-br from-slate-900 via-slate-800 to-slate-900 relative overflow-hidden">
      <TiltTelemetry />

      <div className="absolute top-1/2 right-121 -translate-y-1/2 z-30">
        <div
          className="backdrop-blur-md border border-white/30 rounded-xl p-2 flex flex-col gap-2"
          style={{
            background: isMenuMode
              ? 'linear-gradient(180deg, rgba(99, 102, 241, 0.35), rgba(30, 41, 59, 0.65))'
              : 'linear-gradient(180deg, rgba(30, 41, 59, 0.45), rgba(51, 65, 85, 0.45))',
            boxShadow: isMenuMode
              ? '0 0 28px rgba(99, 102, 241, 0.45), 0 10px 24px rgba(0, 0, 0, 0.35)'
              : '0 8px 20px rgba(0, 0, 0, 0.25)',
            transition: 'background 0.25s ease, box-shadow 0.25s ease',
          }}
        >
          {MENU_BUTTONS.map((label, index) => {
            const isHovered = hoveredMenuButton === index;
            const handleMenuButtonClick = () => {
              if (index === 0) {
                handleClear();
              } else if (index === 1) {
                handleBackspace();
              } else if (index === 2) {
                console.log(`Menu button ${label} clicked`);
              }
            };

            const getIcon = () => {
              if (index === 0) return <IoIosCloseCircle size={28} />;
              if (index === 1) return <FaBackspace size={24} />;
              if (index === 2) return <TbNumber123 size={28} />;
              return null;
            };

            return (
              <button
                key={label}
                type="button"
                onClick={handleMenuButtonClick}
                className="w-14 h-14 rounded-lg border flex items-center justify-center text-white/90 transition-all duration-150"
                style={{
                  borderColor: isMenuMode && isHovered ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.25)',
                  background: isMenuMode && isHovered
                    ? 'linear-gradient(135deg, rgba(255,255,255,0.32), rgba(255,255,255,0.12))'
                    : 'linear-gradient(135deg, rgba(255,255,255,0.12), rgba(255,255,255,0.04))',
                  boxShadow: isMenuMode && isHovered
                    ? '0 0 18px rgba(255,255,255,0.45), 0 0 24px rgba(99,102,241,0.4)'
                    : 'none',
                  transform: isMenuMode && isHovered ? 'scale(1.05)' : 'scale(1)',
                }}
              >
                {getIcon() || label}
              </button>
            );
          })}
        </div>
      </div>

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
                aria-label="Backspace"
                className="text-xs px-3 py-1.5 rounded-md border border-white/30 text-white/90 hover:bg-white/15 hover:border-white/40 transition-all duration-200 hover:shadow-lg flex items-center justify-center"
              >
                <FaBackspace size={14} />
              </button>
              <button
                type="button"
                onClick={handleClear}
                aria-label="Clear"
                className="text-xs px-3 py-1.5 rounded-md border border-white/30 text-white/90 hover:bg-white/15 hover:border-white/40 transition-all duration-200 hover:shadow-lg flex items-center justify-center"
              >
                <IoIosCloseCircle size={14} />
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
          <filter id="rimGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>

        {SECTIONS.map((section, index) => {
          const pos = getTextPosition(index);
          const isHovered = hoveredSection === index;
          const isAnchored = anchoredSection === index;
          const borderPath = createBorderPath(index);

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
                stroke="rgba(255, 255, 255, 1)"
                strokeWidth={isAnchored ? "6" : "0.5"}
                strokeDasharray={0}
                strokeDashoffset={isAnchored ? 0 : 0}
                className="pointer-events-none"
                style={{
                  transition: isAnchored
                    ? 'stroke-dashoffset 0.4s ease-out, stroke-width 0.2s ease-out, filter 0.3s ease-out'
                    : 'stroke-dashoffset 0.4s ease-in, stroke-width 0.2s ease-in, filter 0.3s ease-in',
                  filter: isAnchored
                    ? 'drop-shadow(0 0 16px rgba(255, 255, 255, 1)) drop-shadow(0 0 28px rgba(139, 92, 246, 0.7))'
                    : 'none'
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

        {/* Left rim red glow — sidebar transition cue */}
        <path
          d="M 73 73 A 180 180 0 0 0 73 327"
          fill="none"
          stroke="#ef4444"
          strokeWidth={16}
          strokeLinecap="round"
          filter="url(#rimGlow)"
          opacity={enterIntensity}
          className="pointer-events-none"
          style={{ transition: 'opacity 0.12s ease-out' }}
        />
        {/* Right rim blue glow — return-to-wheel cue */}
        <path
          d="M 327 73 A 180 180 0 0 1 327 327"
          fill="none"
          stroke="#3b82f6"
          strokeWidth={16}
          strokeLinecap="round"
          filter="url(#rimGlow)"
          opacity={exitIntensity}
          className="pointer-events-none"
          style={{ transition: 'opacity 0.12s ease-out' }}
        />

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
          <div className="relative flex items-center justify-center" style={{ width: '420px', height: '420px', animation: 'slideIn 0.2s ease-out both' }}>
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
                const subgroupCount = activeGroups.length;
                const pos = getTextPosition(index, subgroupCount);
                const isHovered = hoveredChar === index;
                const isAnchored = anchoredChar === index;
                const borderPath = createBorderPath(index, subgroupCount);

                return (
                  <g key={index} className="cursor-pointer">
                    <path
                      d={createDonutPath(index, subgroupCount)}
                      fill={isHovered ? 'url(#subgroupHover)' : 'url(#subgroupBase)'}
                      stroke="none"
                      style={{ transition: 'fill 0.3s ease-out' }}
                    />
                    <path
                      d={borderPath}
                      fill="none"
                      stroke="rgba(255, 255, 255, 1)"
                      strokeWidth={isAnchored ? '6' : '0.5'}
                      strokeDasharray={0}
                      strokeDashoffset={isAnchored ? 0 : 0}
                      className="pointer-events-none"
                      style={{
                        transition: isAnchored
                          ? 'stroke-dashoffset 0.4s ease-out, stroke-width 0.2s ease-out, filter 0.3s ease-out'
                          : 'stroke-dashoffset 0.4s ease-in, stroke-width 0.2s ease-in, filter 0.3s ease-in',
                        filter: isAnchored
                          ? 'drop-shadow(0 0 16px rgba(255, 255, 255, 1)) drop-shadow(0 0 28px rgba(139, 92, 246, 0.7))'
                          : 'none'
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