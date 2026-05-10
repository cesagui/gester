import React from 'react';
import { FaBackspace } from 'react-icons/fa';
import { IoIosCloseCircle } from 'react-icons/io';
import { TbNumber123, TbAbc } from 'react-icons/tb';
import { MdSpaceBar } from 'react-icons/md';
import TiltTelemetry from './TiltTelemetry';
import MotionGraph from './MotionGraph';
import { tiltStore } from '../lib/tiltStore';

// ── Sensitivity knobs ────────────────────────────────────────────────────
// Wheel (outer sections) — pitch → section index
const WHEEL_PITCH_RANGE_DEG = 60; // total pitch span across all wheel sections (15° per section → S3 at -45°)
const WHEEL_DEADZONE_DEG = 8;     // |pitch| below this → nothing selected (rest pose); flick at rest types a space
const WHEEL_HYSTERESIS_DEG = 3;   // pitch must overshoot a boundary by this much to switch sections

// Letter rectangle — pitch → subgroup index inside the active group
const LETTER_PITCH_MAX_DEG = 30;     // ±this maps across the subgroups (smaller = more sensitive); 60° wrap matches layer 1
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

// Suggestion menu (right side) — mirrors the left menu but for Claude word completions
const SUGGEST_SLOT_COUNT = 3;
const COMPLETIONS_ENDPOINT = 'http://localhost:3000/complete';
const COMPLETIONS_DEBOUNCE_MS = 250;

async function fetchCompletions(buffer: string, signal: AbortSignal): Promise<string[]> {
  const res = await fetch(COMPLETIONS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ buffer, context: [] }),
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const sseText = await res.text();
  const events = sseText.split(/\r?\n\r?\n/);
  let textAcc = '';
  for (const evt of events) {
    if (!evt.trim()) continue;
    const lines = evt.split(/\r?\n/);
    let isError = false;
    let isDone = false;
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith('event: error')) isError = true;
      else if (line.startsWith('event: done')) isDone = true;
      else if (line.startsWith('data:')) {
        dataLines.push(line.startsWith('data: ') ? line.slice(6) : line.slice(5));
      }
    }
    if (isError) throw new Error(dataLines.join('\n'));
    if (isDone) break;
    textAcc += dataLines.join('\n');
  }
  return textAcc.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, SUGGEST_SLOT_COUNT);
}

// Section "anchor" (lock current section after holding this long)
const ANCHOR_DELAY_MS = 500;
// ────────────────────────────────────────────────────

// Frequency-weighted layout: top 8 English letters live in two 4-letter
// sections (2 flicks each); the remaining 18 split into two 9-letter
// sections (3 flicks each). Keeps the wheel visually balanced (4+4+9+9).
// Within each section, letters are ordered by frequency too, so the
// most-common letter in that section lands at the lowest pitch index.
const SECTIONS = [
  { letters: 'ETAO', gradient: 'url(#gradient0)' },
  { letters: 'INSH', gradient: 'url(#gradient1)' },
  { letters: 'DLCMFGBKJ', gradient: 'url(#gradient2)' },
  { letters: 'RUWYPVXQZ', gradient: 'url(#gradient3)' }
];

const NUMBER_SECTIONS = [
  { letters: '1234', gradient: 'url(#gradient0)' },
  { letters: '5678', gradient: 'url(#gradient1)' },
  { letters: '90.,', gradient: 'url(#gradient2)' },
  { letters: '!?@#', gradient: 'url(#gradient3)' },
];

const GRADIENTS = [
  { start: 'rgba(156, 163, 175, 0.4)', end: 'rgba(156, 163, 175, 0.2)', hoverStart: 'rgba(139, 92, 246, 0.85)', hoverEnd: 'rgba(99, 102, 241, 0.65)' },
  { start: 'rgba(148, 156, 168, 0.4)', end: 'rgba(148, 156, 168, 0.2)', hoverStart: 'rgba(99, 102, 241, 0.85)', hoverEnd: 'rgba(59, 130, 246, 0.65)' },
  { start: 'rgba(140, 149, 161, 0.4)', end: 'rgba(140, 149, 161, 0.2)', hoverStart: 'rgba(59, 130, 246, 0.85)', hoverEnd: 'rgba(14, 165, 233, 0.65)' },
  { start: 'rgba(132, 142, 154, 0.4)', end: 'rgba(132, 142, 154, 0.2)', hoverStart: 'rgba(14, 165, 233, 0.85)', hoverEnd: 'rgba(6, 182, 212, 0.65)' }
];

// Equal angular wedges (90° each), but sections with long letter strings
// get a thicker donut ring (girth) so the text has more visual room
// without crowding the wedge edge.
const buildSectionLayout = (sections: typeof SECTIONS) => {
  const angleSpan = 360 / sections.length;
  const pitchWidth = WHEEL_PITCH_RANGE_DEG / sections.length;
  return sections.map((s, i) => {
    const isLong = s.letters.length > 5;
    return {
      angleStart: i * angleSpan,
      angleEnd: (i + 1) * angleSpan,
      pitchStart: i * pitchWidth,
      pitchEnd: (i + 1) * pitchWidth,
      pitchCenter: (i + 0.5) * pitchWidth,
      pitchWidth,
      outerRadius: isLong ? 195 : 165,
      // All sections share the same inner edge so the donut hole stays a clean circle.
      innerRadius: 65,
    };
  });
};

const SECTION_LAYOUT = buildSectionLayout(SECTIONS);
const NUMBER_SECTION_LAYOUT = buildSectionLayout(NUMBER_SECTIONS);

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
  const [isSpaceAnchored, setIsSpaceAnchored] = React.useState(false);
  const [isNumberMode, setIsNumberMode] = React.useState(false);
  const [isSuggestMode, setIsSuggestMode] = React.useState(false);
  const [suggestions, setSuggestions] = React.useState<string[]>([]);
  const [hoveredSuggestion, setHoveredSuggestion] = React.useState<number | null>(null);

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

  const suggestModeRef = React.useRef(isSuggestMode);
  React.useEffect(() => {
    suggestModeRef.current = isSuggestMode;
  }, [isSuggestMode]);

  const suggestionsRef = React.useRef<string[]>(suggestions);
  React.useEffect(() => {
    suggestionsRef.current = suggestions;
  }, [suggestions]);

  const suggestEnterTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const completionsAbortRef = React.useRef<AbortController | null>(null);
  const completionsDebounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const isNumberModeRef = React.useRef(isNumberMode);
  React.useEffect(() => {
    isNumberModeRef.current = isNumberMode;
  }, [isNumberMode]);

  const openSelectedSection = (index: number) => {
    const sections = isNumberModeRef.current ? NUMBER_SECTIONS : SECTIONS;
    setHoveredSection(index);
    setSelectedSection(index);
    setActiveGroupStack([sections[index].letters]);
    setShowRectangle(true);
    setHoveredChar(0);
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
  const backCooldownUntilRef = React.useRef<number>(0);
  const rollFilteredRef = React.useRef<number | null>(null);
  const ROLL_FILTER_ALPHA = 0.22; // lower -> smoother, higher -> more responsive
  // Separate, slower filter just for the rim glow opacity. The logic filter
  // (above) is tuned to detect the 50° threshold quickly; the visual filter
  // is tuned to keep the glow steady so it doesn't flicker frame-to-frame.
  const rollVisualRef = React.useRef<number | null>(null);
  const ROLL_VISUAL_ALPHA = 0.08;
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
    setIsSpaceAnchored(false);
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

  const enterSuggestMode = () => {
    if (suggestModeRef.current) return;
    setIsSuggestMode(true);
    setHoveredSuggestion(0);

    setShowRectangle(false);
    setSelectedSection(null);
    setHoveredSection(null);
    setHoveredChar(null);
    setActiveGroupStack([]);

    anchoredSectionRef.current = null;
    setAnchoredSection(null);
    setIsSpaceAnchored(false);
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

    if (suggestEnterTimerRef.current) {
      clearTimeout(suggestEnterTimerRef.current);
      suggestEnterTimerRef.current = null;
    }
  };

  const exitSuggestMode = () => {
    if (!suggestModeRef.current) return;
    setIsSuggestMode(false);
    setHoveredSuggestion(null);
    if (suggestEnterTimerRef.current) {
      clearTimeout(suggestEnterTimerRef.current);
      suggestEnterTimerRef.current = null;
    }
  };

  const applySuggestion = (word: string) => {
    if (!word) return;
    setTypedText((prev) => prev.replace(/\S*$/, '') + word + ' ');
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
      if (Date.now() < backCooldownUntilRef.current) return;
      const isHighMagnitude = reading.magnitude >= MAGNITUDE_ENGAGE;
      const wasHighMagnitude = lastHighMagnitudeRef.current;
      lastHighMagnitudeRef.current = isHighMagnitude;
      const roll = reading.roll;
      if (rollFilteredRef.current === null) rollFilteredRef.current = roll;
      else rollFilteredRef.current = rollFilteredRef.current * (1 - ROLL_FILTER_ALPHA) + roll * ROLL_FILTER_ALPHA;
      const filteredRoll = rollFilteredRef.current;

      if (rollVisualRef.current === null) rollVisualRef.current = roll;
      else rollVisualRef.current = rollVisualRef.current * (1 - ROLL_VISUAL_ALPHA) + roll * ROLL_VISUAL_ALPHA;
      setCurrentRoll(rollVisualRef.current);

      // Hold positive roll for 2s to enter menu mode (wheel stage only).
      if (!menuModeRef.current && !suggestModeRef.current && !showRectangleRef.current) {
        if (filteredRoll >= MENU_ENTER_ROLL_THRESHOLD) {
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

      // Hold negative roll for 2s at top level to enter suggest mode (right menu).
      if (!menuModeRef.current && !suggestModeRef.current && !showRectangleRef.current) {
        if (filteredRoll <= MENU_EXIT_ROLL_THRESHOLD) {
          if (!suggestEnterTimerRef.current) {
            suggestEnterTimerRef.current = setTimeout(() => {
              enterSuggestMode();
            }, MENU_ENTER_HOLD_MS);
          }
        } else if (suggestEnterTimerRef.current) {
          clearTimeout(suggestEnterTimerRef.current);
          suggestEnterTimerRef.current = null;
        }
      } else if (suggestEnterTimerRef.current) {
        clearTimeout(suggestEnterTimerRef.current);
        suggestEnterTimerRef.current = null;
      }

      // Back-hold while in rectangle: hold negative roll to go back one level or exit.
      if (!menuModeRef.current && showRectangleRef.current) {
        if (activeGroupDepthRef.current >= 1) {
          if (filteredRoll <= MENU_EXIT_ROLL_THRESHOLD) {
            if (!backHoldTimerRef.current) {
              backHoldTimerRef.current = setTimeout(() => {
                handleBack();
                backHoldTimerRef.current = null;
                backCooldownUntilRef.current = Date.now() + 500;
              }, MENU_EXIT_HOLD_MS);
            }
          } else if (backHoldTimerRef.current) {
            // Only clear the timer if roll has moved back above the threshold
            // plus a small hysteresis to avoid cancelling due to jitter.
            if (filteredRoll > MENU_EXIT_ROLL_THRESHOLD + MENU_EXIT_HYSTERESIS_DEG) {
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

      // Suggest mode: pitch chooses slot, flick types the word, positive roll exits.
      if (suggestModeRef.current) {
        if (roll >= MENU_ENTER_ROLL_THRESHOLD) {
          exitSuggestMode();
          return;
        }
        const PITCH_MAX = 75;
        const clampedPitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, reading.pitch));
        const ratio = (clampedPitch + PITCH_MAX) / (2 * PITCH_MAX);
        const idx = Math.min(Math.max(Math.floor(ratio * SUGGEST_SLOT_COUNT), 0), SUGGEST_SLOT_COUNT - 1);
        setHoveredSuggestion(idx);

        if (isHighMagnitude && !wasHighMagnitude && !magnitudeTriggeredRef.current) {
          fireSpike();
          const word = suggestionsRef.current[idx];
          if (word) {
            applySuggestion(word);
            exitSuggestMode();
          }
        }

        return;
      }

      // Menu mode: pitch chooses button, flick presses, negative roll exits.
      if (menuModeRef.current) {
        if (roll <= MENU_EXIT_ROLL_THRESHOLD) {
          exitMenuMode();
          return;
        }

        // PITCH_MAX/3 is the threshold to switch off the middle button: at 75 the
        // user only needs ±25° (down from ±30°) to reach clear or number.
        const PITCH_MAX = 75;
        const clampedPitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, reading.pitch));
        const ratio = (clampedPitch + PITCH_MAX) / (2 * PITCH_MAX);
        const menuIdx = Math.min(Math.max(Math.floor(ratio * MENU_BUTTONS.length), 0), MENU_BUTTONS.length - 1);
        setHoveredMenuButton(menuIdx);

        if (isHighMagnitude && !wasHighMagnitude && !magnitudeTriggeredRef.current) {
          fireSpike();
          if (menuIdx === 0) {
            handleClear();
          } else if (menuIdx === 1) {
            handleBackspace();
          } else if (menuIdx === 2) {
            setIsNumberMode((prev) => !prev);
            exitMenuMode();
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

          if (groupCount > 0) {
            // Same wrap + direction convention as layer 1: negative pitch goes
            // clockwise from subgroup 0, positive pitch goes counter-clockwise.
            const wrapRange = 2 * LETTER_PITCH_MAX_DEG;
            const subWidth = wrapRange / groupCount;
            const normalized = (((-reading.pitch) % wrapRange) + wrapRange) % wrapRange;
            const rawIdx = Math.min(Math.floor(normalized / subWidth), groupCount - 1);

            // Hysteresis: stick to the current subgroup until pitch overshoots
            // its boundary by LETTER_HYSTERESIS_DEG. Wrap-aware delta.
            const lastChar = lastCharIdxRef.current;
            let clampedIdx = rawIdx;
            if (lastChar !== null && rawIdx !== lastChar && lastChar < groupCount) {
              const lastCenter = (lastChar + 0.5) * subWidth;
              let delta = normalized - lastCenter;
              if (delta > wrapRange / 2) delta -= wrapRange;
              if (delta < -wrapRange / 2) delta += wrapRange;
              if (Math.abs(delta) < subWidth / 2 + LETTER_HYSTERESIS_DEG) {
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
        } else {
          // Rest-pose flick (in deadzone, no section selected) types a space
          setTypedText((prev) => prev + ' ');
          setIsSpaceAnchored(false);
          if (anchorTimerRef.current) clearTimeout(anchorTimerRef.current);
          anchorTimerRef.current = setTimeout(() => {
            if (lastTiltSectionRef.current === null) setIsSpaceAnchored(true);
          }, ANCHOR_DELAY_MS);
        }
        return;
      }

      // Map pitch across the wheel's sections (variable widths from SECTION_LAYOUT),
      // with a small deadzone at rest.
      let next: number | null = null;
      const pitch = reading.pitch;

      if (Math.abs(pitch) >= WHEEL_DEADZONE_DEG) {
        // Rest pose sits just before ETAO. Negative pitch advances clockwise
        // (ETAO → INSH → DLC → RUW); positive pitch goes counter-clockwise.
        // Both directions wrap.
        let normalized = (((-pitch) % WHEEL_PITCH_RANGE_DEG) + WHEEL_PITCH_RANGE_DEG) % WHEEL_PITCH_RANGE_DEG;

        // Find which section's pitch slice contains `normalized`.
        const layout = isNumberModeRef.current ? NUMBER_SECTION_LAYOUT : SECTION_LAYOUT;
        let rawNext = layout.length - 1;
        for (let i = 0; i < layout.length; i++) {
          if (normalized < layout[i].pitchEnd) {
            rawNext = i;
            break;
          }
        }

        const last = lastTiltSectionRef.current;
        if (last === null || rawNext === last) {
          next = rawNext;
        } else {
          // Hysteresis: stick to the current section until pitch is past its
          // boundary by WHEEL_HYSTERESIS_DEG. Distance is measured from the
          // center of the last section, with wrap-around.
          const lastRange = layout[last];
          let delta = normalized - lastRange.pitchCenter;
          if (delta > WHEEL_PITCH_RANGE_DEG / 2) delta -= WHEEL_PITCH_RANGE_DEG;
          if (delta < -WHEEL_PITCH_RANGE_DEG / 2) delta += WHEEL_PITCH_RANGE_DEG;

          if (Math.abs(delta) >= lastRange.pitchWidth / 2 + WHEEL_HYSTERESIS_DEG) {
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
        setIsSpaceAnchored(false);

        // Reset stable timer on section change
        sectionStableTimeRef.current = Date.now();
        if (anchorTimerRef.current) clearTimeout(anchorTimerRef.current);

        // Set timer to anchor this section after ANCHOR_DELAY_MS;
        // a null `next` means we're at rest (deadzone) → space-anchored.
        anchorTimerRef.current = setTimeout(() => {
          anchoredSectionRef.current = next;
          setAnchoredSection(next);
          if (next === null) setIsSpaceAnchored(true);
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
      if (suggestEnterTimerRef.current) clearTimeout(suggestEnterTimerRef.current);
      if (completionsDebounceRef.current) clearTimeout(completionsDebounceRef.current);
      completionsAbortRef.current?.abort();
    };
  }, []);

  React.useEffect(() => {
    if (completionsDebounceRef.current) clearTimeout(completionsDebounceRef.current);
    completionsDebounceRef.current = setTimeout(() => {
      completionsAbortRef.current?.abort();
      const ac = new AbortController();
      completionsAbortRef.current = ac;
      fetchCompletions(typedText, ac.signal)
        .then((sugs) => {
          if (!ac.signal.aborted) setSuggestions(sugs);
        })
        .catch(() => { /* network/abort — leave previous suggestions */ });
    }, COMPLETIONS_DEBOUNCE_MS);
    return () => {
      if (completionsDebounceRef.current) clearTimeout(completionsDebounceRef.current);
    };
  }, [typedText]);

  const createDonutPath = (startAngle: number, endAngle: number, outerRadius = 180, innerRadius = 80) => {
    const largeArc = endAngle - startAngle > 180 ? 1 : 0;

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

    return `M ${x1} ${y1} A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${x4} ${y4} Z`;
  };

  const getTextPosition = (startAngle: number, endAngle: number, textRadius = 130) => {
    const midAngle = (startAngle + endAngle) / 2;
    const angleRad = (midAngle - 90) * Math.PI / 180;

    return {
      x: 200 + textRadius * Math.cos(angleRad),
      y: 200 + textRadius * Math.sin(angleRad)
    };
  };

  const createArcPath = (startAngle: number, endAngle: number, radius: number) => {
    const largeArc = endAngle - startAngle > 180 ? 1 : 0;
    const startAngleRad = (startAngle - 90) * Math.PI / 180;
    const endAngleRad = (endAngle - 90) * Math.PI / 180;
    const x1 = 200 + radius * Math.cos(startAngleRad);
    const y1 = 200 + radius * Math.sin(startAngleRad);
    const x2 = 200 + radius * Math.cos(endAngleRad);
    const y2 = 200 + radius * Math.sin(endAngleRad);
    return `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`;
  };

  const handleSectionClick = (index: number) => {
    openSelectedSection(index);
  };

  const activeSections = isNumberMode ? NUMBER_SECTIONS : SECTIONS;
  const activeSectionLayout = isNumberMode ? NUMBER_SECTION_LAYOUT : SECTION_LAYOUT;

  const activeGroupLetters = activeGroupStack[activeGroupStack.length - 1] ?? '';
  const activeGroups = splitIntoGroups(activeGroupLetters, 4).filter((group) => group.length > 0);
  const activeGradient = selectedSection !== null ? GRADIENTS[selectedSection] : GRADIENTS[0];

  // Roll-direction glows: ramp from MENU_GLOW_START_DEG up to the threshold,
  // then stay fully lit while the user holds past it (so the glow doesn't
  // snap off mid-gesture). Hidden while the gesture isn't applicable.
  const computeRimIntensity = (roll: number, threshold: number) => {
    const sign = Math.sign(threshold) || 1;
    const absRoll = roll * sign;
    const absThreshold = Math.abs(threshold);
    if (absRoll < MENU_GLOW_START_DEG) return 0;
    if (absRoll >= absThreshold) return 1;
    return (absRoll - MENU_GLOW_START_DEG) / (absThreshold - MENU_GLOW_START_DEG);
  };
  // Enter-glow only on the wheel stage (not in rectangle, not already in menu).
  const enterIntensity = (showRectangle || isMenuMode || isSuggestMode) ? 0 : computeRimIntensity(currentRoll, MENU_ENTER_ROLL_THRESHOLD);
  // Right rim glow doubles as: "approaching suggest-menu" at top level, and "approaching menu-exit" while in left menu.
  const exitIntensity = (showRectangle || isSuggestMode) ? 0 : computeRimIntensity(currentRoll, MENU_EXIT_ROLL_THRESHOLD);
  // Back-gesture intensity: while in the rectangle stage, rolling left builds toward
  // the back-hold trigger. Lights the Back button blue so the user knows what's about to fire.
  const backIntensity = showRectangle ? computeRimIntensity(currentRoll, MENU_EXIT_ROLL_THRESHOLD) : 0;

  return (
    <div className="min-h-screen w-full bg-linear-to-br from-slate-900 via-slate-800 to-slate-900 relative overflow-hidden">
      <TiltTelemetry />

      <div className="absolute top-[254px] right-[calc(50%+250px)] -translate-y-1/2 z-30">
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
                setIsNumberMode((prev) => !prev);
              }
            };

            const getIcon = () => {
              if (index === 0) return <IoIosCloseCircle size={28} />;
              if (index === 1) return <FaBackspace size={24} />;
              if (index === 2) return isNumberMode ? <TbAbc size={28} /> : <TbNumber123 size={28} />;
              return null;
            };

            return (
              <button
                key={label}
                type="button"
                onClick={handleMenuButtonClick}
                className="w-14 h-14 rounded-lg border flex items-center justify-center text-white/90 transition-all duration-150"
                style={{
                  borderColor: isMenuMode && isHovered
                    ? 'rgba(255,255,255,0.9)'
                    : (index === 2 && isNumberMode ? 'rgba(251,191,36,0.7)' : 'rgba(255,255,255,0.25)'),
                  background: isMenuMode && isHovered
                    ? 'linear-gradient(135deg, rgba(255,255,255,0.32), rgba(255,255,255,0.12))'
                    : (index === 2 && isNumberMode
                      ? 'linear-gradient(135deg, rgba(251,191,36,0.22), rgba(251,191,36,0.08))'
                      : 'linear-gradient(135deg, rgba(255,255,255,0.12), rgba(255,255,255,0.04))'),
                  boxShadow: isMenuMode && isHovered
                    ? '0 0 18px rgba(255,255,255,0.45), 0 0 24px rgba(99,102,241,0.4)'
                    : (index === 2 && isNumberMode ? '0 0 12px rgba(251,191,36,0.35)' : 'none'),
                  transform: isMenuMode && isHovered ? 'scale(1.05)' : 'scale(1)',
                }}
              >
                {getIcon() || label}
              </button>
            );
          })}
        </div>
      </div>

      {!showRectangle && (
        <div className="absolute top-[254px] left-[calc(50%+250px)] -translate-y-1/2 z-30">
          <div
            className="backdrop-blur-md border border-white/30 rounded-xl p-2 flex flex-col gap-2"
            style={{
              background: isSuggestMode
                ? 'linear-gradient(180deg, rgba(59, 130, 246, 0.35), rgba(30, 41, 59, 0.65))'
                : 'linear-gradient(180deg, rgba(30, 41, 59, 0.45), rgba(51, 65, 85, 0.45))',
              boxShadow: isSuggestMode
                ? '0 0 28px rgba(59, 130, 246, 0.45), 0 10px 24px rgba(0, 0, 0, 0.35)'
                : '0 8px 20px rgba(0, 0, 0, 0.25)',
              transition: 'background 0.25s ease, box-shadow 0.25s ease',
            }}
          >
            {Array.from({ length: SUGGEST_SLOT_COUNT }).map((_, index) => {
              const word = suggestions[index] ?? '';
              const isHovered = hoveredSuggestion === index;
              const handleClick = () => applySuggestion(word);
              return (
                <button
                  key={index}
                  type="button"
                  onClick={handleClick}
                  disabled={!word}
                  className="min-w-[7rem] h-14 px-3 rounded-lg border flex items-center justify-center text-white/90 transition-all duration-150 disabled:opacity-40"
                  style={{
                    borderColor: isSuggestMode && isHovered
                      ? 'rgba(255,255,255,0.9)'
                      : 'rgba(255,255,255,0.25)',
                    background: isSuggestMode && isHovered
                      ? 'linear-gradient(135deg, rgba(255,255,255,0.32), rgba(255,255,255,0.12))'
                      : 'linear-gradient(135deg, rgba(255,255,255,0.12), rgba(255,255,255,0.04))',
                    boxShadow: isSuggestMode && isHovered
                      ? '0 0 18px rgba(255,255,255,0.45), 0 0 24px rgba(59,130,246,0.4)'
                      : 'none',
                    transform: isSuggestMode && isHovered ? 'scale(1.05)' : 'scale(1)',
                    fontFamily: 'Atkinson Hyperlegible, sans-serif',
                  }}
                >
                  <span className="text-sm font-medium truncate">{word || '—'}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-[min(92vw,40rem)] z-20">
        <div
          className="backdrop-blur-md border border-white/30 rounded-lg px-4 py-3 flex items-center gap-3"
          style={{
            background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.85), rgba(51, 65, 85, 0.55))',
            boxShadow: '0 6px 20px rgba(0, 0, 0, 0.3), 0 0 30px rgba(99, 102, 241, 0.12)',
            fontFamily: 'Atkinson Hyperlegible, sans-serif',
          }}
        >
          <p className="flex-1 text-lg text-white font-medium font-mono wrap-break-word min-h-7 leading-7">
            {typedText || <span className="text-white/30">_</span>}
            <span
              className="inline-block w-0.5 h-5 ml-0.5 animate-pulse align-middle"
              style={{
                background: 'linear-gradient(to bottom, rgba(139, 92, 246, 0.9), rgba(99, 102, 241, 0.9))',
                boxShadow: '0 0 8px rgba(139, 92, 246, 0.6)',
              }}
            />
          </p>
          <div className="flex gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleBackspace}
              aria-label="Backspace"
              className="text-xs px-2 py-1 rounded-md border border-white/30 text-white/90 hover:bg-white/15 hover:border-white/40 transition-all duration-200 flex items-center justify-center"
            >
              <FaBackspace size={12} />
            </button>
            <button
              type="button"
              onClick={handleClear}
              aria-label="Clear"
              className="text-xs px-2 py-1 rounded-md border border-white/30 text-white/90 hover:bg-white/15 hover:border-white/40 transition-all duration-200 flex items-center justify-center"
            >
              <IoIosCloseCircle size={12} />
            </button>
          </div>
        </div>
      </div>

      <div
        className="absolute top-6 left-1/2 -translate-x-1/2 z-10"
        style={{ width: '460px', height: '460px' }}
      >
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
        style={{ opacity: showRectangle ? 0 : 1, transition: 'opacity 0.5s' }}
      >
        <MotionGraph embedded />
      </div>
      {/* Space icon — flick at rest pose (deadzone) types a space; anchors after dwell */}
      <div
        className="absolute pointer-events-none flex items-center justify-center"
        style={{
          top: '50%',
          left: '50%',
          width: 96,
          height: 96,
          transform: `translate(-50%, -50%) scale(${isSpaceAnchored ? 1.1 : 1})`,
          opacity: showRectangle ? 0 : 1,
          color: isSpaceAnchored ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,0.55)',
          filter: isSpaceAnchored
            ? 'drop-shadow(0 0 16px rgba(255, 255, 255, 1)) drop-shadow(0 0 28px rgba(139, 92, 246, 0.7))'
            : 'drop-shadow(0 0 4px rgba(255, 255, 255, 0.25))',
          borderRadius: '50%',
          border: `2px solid rgba(255,255,255,${isSpaceAnchored ? 1 : 0.15})`,
          transition: 'opacity 0.4s, color 0.4s, filter 0.4s, transform 0.4s, border-color 0.4s',
        }}
      >
        <MdSpaceBar size={44} />
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

        {activeSections.map((section, index) => {
          const { angleStart, angleEnd, outerRadius, innerRadius } = activeSectionLayout[index];
          const textRadius = (outerRadius + innerRadius) / 2;
          const pos = getTextPosition(angleStart, angleEnd, textRadius);
          const isHovered = hoveredSection === index;
          const isAnchored = anchoredSection === index;
          const donutPath = createDonutPath(angleStart, angleEnd, outerRadius, innerRadius);

          return (
            <g
              key={index}
              onMouseEnter={() => !showRectangle && setHoveredSection(index)}
              onMouseLeave={() => !showRectangle && setHoveredSection(null)}
              onClick={() => handleSectionClick(index)}
              className="cursor-pointer"
            >
              <path
                d={donutPath}
                fill={isHovered ? `url(#gradientHover${index})` : section.gradient}
                stroke="none"
                style={{ transition: 'fill 0.3s ease-out' }}
              />
              <path
                d={donutPath}
                fill="none"
                stroke="rgba(255, 255, 255, 1)"
                strokeWidth={isAnchored ? "6" : "0.5"}
                className="pointer-events-none"
                style={{
                  transition: isAnchored
                    ? 'stroke-width 0.2s ease-out, filter 0.3s ease-out'
                    : 'stroke-width 0.2s ease-in, filter 0.3s ease-in',
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

        {/* Left rim red glow — sidebar transition cue (sits on sections 2/3, outer=195) */}
        <path
          d="M 62.1 62.1 A 195 195 0 0 0 62.1 337.9"
          fill="none"
          stroke="#ef4444"
          strokeWidth={16}
          strokeLinecap="round"
          filter="url(#rimGlow)"
          opacity={enterIntensity}
          className="pointer-events-none"
          style={{ transition: 'opacity 0.25s ease-out' }}
        />
        {/* Right rim blue glow — return-to-wheel cue (sits on sections 0/1, outer=165) */}
        <path
          d="M 316.7 83.3 A 165 165 0 0 1 316.7 316.7"
          fill="none"
          stroke="#3b82f6"
          strokeWidth={16}
          strokeLinecap="round"
          filter="url(#rimGlow)"
          opacity={exitIntensity}
          className="pointer-events-none"
          style={{ transition: 'opacity 0.25s ease-out' }}
        />

        {/* Per-section outer/inner outline arcs (replace the old single radius circles) */}
        {activeSectionLayout.map((layout, index) => (
          <React.Fragment key={`outline-${index}`}>
            <path
              d={createArcPath(layout.angleStart, layout.angleEnd, layout.outerRadius)}
              fill="none"
              stroke="rgba(255, 255, 255, 0.2)"
              strokeWidth="2"
              className="pointer-events-none"
            />
            <path
              d={createArcPath(layout.angleStart, layout.angleEnd, layout.innerRadius)}
              fill="none"
              stroke="rgba(255, 255, 255, 0.2)"
              strokeWidth="2"
              className="pointer-events-none"
            />
          </React.Fragment>
        ))}
      </svg>
      </div>

      {showRectangle && selectedSection !== null && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center justify-center gap-6" style={{ width: '460px', height: '460px' }}>
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
                const subgroupSpan = 360 / subgroupCount;
                const subStart = index * subgroupSpan;
                const subEnd = subStart + subgroupSpan;
                const subMid = (subStart + subEnd) / 2;
                // Right-half subgroups shrink to make room for the Back ring on the right.
                const isRight = subMid < 180;
                const subOuter = isRight ? 165 : 195;
                const subInner = 65;
                const subTextRadius = (subOuter + subInner) / 2;
                const pos = getTextPosition(subStart, subEnd, subTextRadius);
                const isHovered = hoveredChar === index;
                const isAnchored = anchoredChar === index;
                const donutPath = createDonutPath(subStart, subEnd, subOuter, subInner);

                return (
                  <g key={index} className="cursor-pointer">
                    <path
                      d={donutPath}
                      fill={isHovered ? 'url(#subgroupHover)' : 'url(#subgroupBase)'}
                      stroke="none"
                      style={{ transition: 'fill 0.3s ease-out' }}
                    />
                    <path
                      d={donutPath}
                      fill="none"
                      stroke="rgba(255, 255, 255, 1)"
                      strokeWidth={isAnchored ? '6' : '0.5'}
                      className="pointer-events-none"
                      style={{
                        transition: isAnchored
                          ? 'stroke-width 0.2s ease-out, filter 0.3s ease-out'
                          : 'stroke-width 0.2s ease-in, filter 0.3s ease-in',
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

              {/* Per-subgroup outline arcs (replace single-radius circles since right-side is shrunk) */}
              {activeGroups.map((_, index) => {
                const subgroupCount = activeGroups.length;
                const subgroupSpan = 360 / subgroupCount;
                const subStart = index * subgroupSpan;
                const subEnd = subStart + subgroupSpan;
                const subMid = (subStart + subEnd) / 2;
                const isRight = subMid < 180;
                const subOuter = isRight ? 165 : 195;
                return (
                  <React.Fragment key={`sub-outline-${index}`}>
                    <path d={createArcPath(subStart, subEnd, subOuter)} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="2" className="pointer-events-none" />
                    <path d={createArcPath(subStart, subEnd, 65)} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="2" className="pointer-events-none" />
                  </React.Fragment>
                );
              })}

              {/* Back ring on the right — fills the radial gap left by the shrunk subgroups, lights blue with backIntensity */}
              {(() => {
                const subgroupCount = activeGroups.length;
                const subgroupSpan = 360 / subgroupCount;
                const rightCount = activeGroups.filter((_, i) => (i + 0.5) * subgroupSpan < 180).length;
                if (rightCount === 0) return null;
                const backStart = 0;
                const backEnd = rightCount * subgroupSpan;
                const arcInsetDeg = 4;
                const textArcId = `backArcText-${activeGroupStack.length}`;
                return (
                  <g style={{ pointerEvents: 'none' }}>
                    <path
                      d={createDonutPath(backStart, backEnd, 195, 165)}
                      fill={`rgba(59, 130, 246, ${0.10 + backIntensity * 0.45})`}
                      stroke={`rgba(96, 165, 250, ${0.35 + backIntensity * 0.55})`}
                      strokeWidth={1 + backIntensity * 1.5}
                      style={{ transition: 'fill 0.25s ease-out, stroke 0.25s ease-out, stroke-width 0.25s ease-out' }}
                    />
                    <path
                      id={textArcId}
                      d={createArcPath(backStart + arcInsetDeg, backEnd - arcInsetDeg, 180)}
                      fill="none"
                      stroke="none"
                    />
                    <text
                      fontSize="13"
                      fontWeight="600"
                      fill={`rgba(255, 255, 255, ${0.55 + backIntensity * 0.45})`}
                      style={{
                        letterSpacing: '0.35em',
                        fontFamily: 'Atkinson Hyperlegible, sans-serif',
                        transition: 'fill 0.25s ease-out',
                      }}
                    >
                      <textPath href={`#${textArcId}`} startOffset="50%" textAnchor="middle">BACK</textPath>
                    </text>
                  </g>
                );
              })()}
            </svg>
          </div>
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