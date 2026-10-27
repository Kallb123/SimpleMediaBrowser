import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useSelector } from 'react-redux';
import { useEditMode } from '@/contexts/EditModeContext';
import { logger } from '@/scripts/Logger';
import {
  selectBedtimeAllowedTypes,
  selectBedtimeEnabled,
  selectBedtimeSlots,
  type BedtimeSlot,
} from '@/store/settingsReducer';
import {
  activeBedtimeSlot,
  bedtimeRestrictedSections,
  firstAllowedSection,
  formatBedtimeDays,
  type BedtimeSection,
} from '@/utils/bedtime';

/** How often bedtimeActive is re-evaluated while bedtime mode is enabled. */
const BEDTIME_TICK_MS = 60_000;

// One shared instance for the "nothing restricted" case, so consumers using
// restrictedSections as an effect dependency don't see a new reference every render.
const NO_SECTIONS: ReadonlySet<BedtimeSection> = new Set<BedtimeSection>();

interface BedtimeContextType {
  /** Bedtime mode is enabled and the current time is inside the configured window. */
  bedtimeActive: boolean;
  /**
   * Drawer sections currently locked away. Empty when inactive, lifted, or parent mode is
   * unlocked, and also when the settings would lock every section (e.g. no allowed types):
   * the drawer needs at least one screen, so bedtime then restricts nothing.
   */
  restrictedSections: ReadonlySet<BedtimeSection>;
  /** "HH:MM" at which the currently active time slot ends ('' when none), for messages like "locked until 07:00". */
  bedtimeEnd: string;
  /** Parent entered the password: lift the restrictions until the next entry check. */
  liftBedtime: () => void;
  /** Entry check: re-evaluate bedtime and clear any lift (e.g. after the parent re-locks). */
  recheckBedtime: () => void;
}

const describeSlot = (slot: BedtimeSlot) => `${formatBedtimeDays(slot.days)} ${slot.start}-${slot.end}`;

const BedtimeContext = createContext<BedtimeContextType>({
  bedtimeActive: false,
  restrictedSections: NO_SECTIONS,
  bedtimeEnd: '',
  liftBedtime: () => {},
  recheckBedtime: () => {},
});

export function BedtimeProvider({ children }: { children: React.ReactNode }) {
  const enabled = useSelector(selectBedtimeEnabled);
  const slots = useSelector(selectBedtimeSlots);
  const allowedTypes = useSelector(selectBedtimeAllowedTypes);
  const { drawerUnlocked } = useEditMode();

  const [evaluated, setEvaluated] = useState(() => {
    const slot = enabled ? activeBedtimeSlot(new Date(), slots) : null;
    return { active: slot !== null, end: slot?.end ?? '' };
  });
  const [lifted, setLifted] = useState(false);
  // Mirrors of the state above so transitions can be logged without side effects in updaters.
  const evaluatedRef = useRef(evaluated);
  const liftedRef = useRef(false);

  // Re-evaluates the clock only; does not touch `lifted`.
  const evaluate = useCallback((reason: string) => {
    const slot = enabled ? activeBedtimeSlot(new Date(), slots) : null;
    const next = { active: slot !== null, end: slot?.end ?? '' };
    const prev = evaluatedRef.current;
    if (next.active !== prev.active || next.end !== prev.end) {
      if (slot) {
        logger.log('Bedtime', `Bedtime ${prev.active ? 'moved to another time slot' : 'started'} (${reason}, ${describeSlot(slot)})`);
      } else {
        logger.log('Bedtime', `Bedtime ended (${reason})`);
      }
      evaluatedRef.current = next;
      setEvaluated(next);
    }
  }, [enabled, slots]);

  // Entry check: evaluate and clear the lift.
  const entryCheck = useCallback((reason: string) => {
    if (liftedRef.current) {
      logger.log('Bedtime', `Bedtime lift cleared (${reason})`);
      liftedRef.current = false;
      setLifted(false);
    }
    evaluate(reason);
  }, [evaluate]);

  const liftBedtime = useCallback(() => {
    logger.log('Bedtime', 'Bedtime restrictions lifted by settings password');
    liftedRef.current = true;
    setLifted(true);
  }, []);

  const recheckBedtime = useCallback(() => entryCheck('manual recheck'), [entryCheck]);

  // On mount and whenever a bedtime setting changes (entryCheck's identity follows them).
  useEffect(() => {
    entryCheck('startup or settings change');
  }, [entryCheck]);

  // Returning to the foreground counts as a fresh entry.
  useEffect(() => {
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active' && (previous === 'background' || previous === 'inactive')) {
        entryCheck('app foregrounded');
      }
      previous = next;
    });
    return () => subscription.remove();
  }, [entryCheck]);

  // If the app stays open across the bedtime start, lock then. Does not clear `lifted`.
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => evaluate('clock tick'), BEDTIME_TICK_MS);
    return () => clearInterval(id);
  }, [enabled, evaluate]);

  // evaluatedActive can lag one render behind a settings change until the entry check runs.
  const bedtimeActive = enabled && evaluated.active;
  const bedtimeEnd = bedtimeActive ? evaluated.end : '';

  const configuredRestriction = useMemo(() => bedtimeRestrictedSections(allowedTypes), [allowedTypes]);
  const enforced = bedtimeActive && !lifted && !drawerUnlocked;
  const nothingAllowed = firstAllowedSection(configuredRestriction) === null;

  const restrictedSections = enforced && !nothingAllowed ? configuredRestriction : NO_SECTIONS;

  useEffect(() => {
    if (enforced && nothingAllowed) {
      logger.warn('Bedtime', 'Bedtime would lock every section (no allowed types) – not restricting anything');
    }
  }, [enforced, nothingAllowed]);

  // Memoised for the same reason as EditModeContext's value: consumers use these as hook dependencies.
  const value = useMemo(
    () => ({ bedtimeActive, restrictedSections, bedtimeEnd, liftBedtime, recheckBedtime }),
    [bedtimeActive, restrictedSections, bedtimeEnd, liftBedtime, recheckBedtime],
  );

  return (
    <BedtimeContext.Provider value={value}>
      {children}
    </BedtimeContext.Provider>
  );
}

export function useBedtime() {
  return useContext(BedtimeContext);
}
