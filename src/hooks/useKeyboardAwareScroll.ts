import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  ScrollView,
  TextInput,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type View,
} from 'react-native';

/** Breathing room kept below the focused input once it has been revealed. */
export const REVEAL_MARGIN = 24;
/**
 * Gap left above the focused input when it gets parked at the top of the
 * ScrollView because nothing on the device would tell us where the keyboard is.
 */
export const TOP_MARGIN = 12;
/**
 * How long to wait for the layout to react to the keyboard before concluding it
 * never will. Android's keyboard show animation is ~250ms, so this leaves room
 * for a slow device without being noticeable.
 */
const LAYOUT_REACTION_TIMEOUT_MS = 500;
/** Moving focus between two inputs fires blur before the next focus arrives. */
const BLUR_SETTLE_MS = 100;
/**
 * `KeyboardAvoidingView` animates its padding, so the ScrollView re-lays out on
 * every frame of the keyboard transition. Coalesce those into a single pass at
 * the end rather than firing a scroll per frame.
 */
const SYNC_DEBOUNCE_MS = 60;

export type KeyboardScrollPlan = {
  /**
   * Extra bottom padding the scroll content needs so that the focused input can
   * be scrolled all the way to the top of the visible area.
   */
  extraBottomSpace: number;
  /** Offset to scroll to, or null if the input is already clear of the keyboard. */
  scrollTo: number | null;
};

/**
 * Works out what to do about a focused input, given only measurements that are
 * always available. Pure so it can be unit tested — the three previous attempts
 * at this bug all failed on arithmetic, not on plumbing.
 *
 * All values are in the ScrollView's own coordinate space: `inputTop` is the
 * input's offset within the scroll content, `visibleHeight` is how much of the
 * ScrollView is not covered by the keyboard, and `naturalContentHeight` is the
 * content height excluding any space we have already added ourselves.
 *
 * The scroll target is absolute rather than a delta on the current offset, so
 * running this repeatedly (on focus, on layout, on a keyboard event) converges
 * instead of accumulating — re-running it after it has taken effect is a no-op.
 */
export function planKeyboardScroll({
  inputTop,
  inputHeight,
  visibleHeight,
  naturalContentHeight,
  scrollOffset,
}: {
  inputTop: number;
  inputHeight: number;
  visibleHeight: number;
  naturalContentHeight: number;
  scrollOffset: number;
}): KeyboardScrollPlan {
  // Scrolling stops at `contentHeight - visibleHeight`, which is why an input
  // near the end of the content can be stuck behind the keyboard with no way to
  // reach it. Reserve exactly enough slack for it to reach the top of the
  // visible area and no more, so there is always a way to scroll it into view
  // by hand even if every keyboard measurement below turns out to be useless.
  const extraBottomSpace = Math.max(
    0,
    inputTop - TOP_MARGIN - (naturalContentHeight - visibleHeight),
  );
  const target = Math.max(0, inputTop + inputHeight + REVEAL_MARGIN - visibleHeight);

  return {
    extraBottomSpace,
    // Only ever scroll forwards: focusing an input you can already see must not
    // drag it back down towards the keyboard.
    scrollTo: target > scrollOffset ? target : null,
  };
}

/** Offset that puts the focused input just below the top of the visible area. */
export function planTopParkScroll(inputTop: number): number {
  return Math.max(0, inputTop - TOP_MARGIN);
}

/**
 * Keeps the focused input of a `ScrollView` clear of the on-screen keyboard.
 *
 * `KeyboardAvoidingView` reserves space for the keyboard (see #186–#190) but
 * never scrolls the focused input into that space, so inputs low in a
 * ScrollView stayed hidden. #211 added a scroll, but derived the covered region
 * from `Dimensions.get('window')` plus an assumed keyboard height when no real
 * measurement had arrived yet, then applied it as a delta on the current scroll
 * offset. On Amazon Fire tablets — where the keyboard is not reported to the app
 * at all — that guess fired on every focus and moved content by an arbitrary
 * amount, which is why it made things worse there.
 *
 * This works from measurements that can't disagree with each other instead:
 *
 * 1. The ScrollView's own on-screen height (`onLayout`) is the ground truth for
 *    how much space is actually available. It already accounts for whatever
 *    reserved the space — `KeyboardAvoidingView`'s padding or a window resize —
 *    so no keyboard height is needed and there is nothing to double-count.
 * 2. If React Native's `Keyboard` module reports a keyboard (a separate
 *    mechanism from the window insets `react-native-keyboard-controller` reads,
 *    so it can work where those don't), its top edge is used as well. The two
 *    signals are combined with `min`, never a sum, so an extra signal can only
 *    ever shrink the area we consider visible — it can never overshoot.
 * 3. Whatever happens, enough scrollable slack is reserved for the focused input
 *    to reach the top of the ScrollView, so there is always a way to scroll it
 *    into view by hand.
 * 4. If neither 1 nor 2 has reacted shortly after focus, the device is telling
 *    us nothing about its keyboard, so the input is parked near the top of the
 *    ScrollView — above any keyboard — rather than moved by a guessed amount.
 */
export function useKeyboardAwareScroll() {
  const scrollRef = useRef<ScrollView>(null);
  const contentRef = useRef<View | null>(null);

  /** ScrollView's current on-screen height. */
  const viewportHeight = useRef(0);
  /** ScrollView's on-screen height while no input is focused. */
  const restingViewportHeight = useRef(0);
  /** ScrollView's top edge in window coordinates. */
  const scrollViewTop = useRef(0);
  const contentHeight = useRef(0);
  const scrollOffset = useRef(0);
  /** Keyboard's top edge in screen coordinates, or null if unknown. */
  const keyboardTop = useRef<number | null>(null);
  const inputFocused = useRef(false);
  /** Bottom space we have added ourselves, excluded from content measurements. */
  const addedBottomSpace = useRef(0);
  const layoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [extraBottomSpace, setExtraBottomSpace] = useState(0);

  /** How much of the ScrollView the keyboard leaves visible. */
  const visibleHeight = useCallback(() => {
    const viewport = viewportHeight.current;
    const top = keyboardTop.current;

    if (top === null) {
      return viewport;
    }
    const fromKeyboard = top - scrollViewTop.current;

    // A non-positive result means the coordinates don't line up (or the
    // ScrollView hasn't been measured yet); fall back to the layout instead of
    // acting on a nonsense number.
    return fromKeyboard > 0 ? Math.min(viewport, fromKeyboard) : viewport;
  }, []);

  const measureFocusedInput = useCallback(
    (onMeasured: (inputTop: number, inputHeight: number) => void) => {
      const input = TextInput.State.currentlyFocusedInput();
      const content = contentRef.current;

      if (!input || !content) {
        return;
      }
      input.measureLayout(content, (_x, y, _width, height) => onMeasured(y, height));
    },
    [],
  );

  const applyBottomSpace = useCallback((space: number) => {
    if (space === addedBottomSpace.current) {
      return;
    }
    addedBottomSpace.current = space;
    setExtraBottomSpace(space);
  }, []);

  const sync = useCallback(() => {
    const scrollView = scrollRef.current;

    if (!inputFocused.current || !scrollView) {
      return;
    }
    // Keyboard coordinates are screen-absolute, so the ScrollView's position on
    // screen has to be refreshed before the two can be compared.
    const nativeScrollRef = scrollView.getNativeScrollRef();

    const plan = () =>
      measureFocusedInput((inputTop, inputHeight) => {
        const visible = visibleHeight();

        if (visible <= 0) {
          return;
        }
        const { extraBottomSpace: space, scrollTo } = planKeyboardScroll({
          inputTop,
          inputHeight,
          visibleHeight: visible,
          naturalContentHeight: contentHeight.current - addedBottomSpace.current,
          scrollOffset: scrollOffset.current,
        });

        applyBottomSpace(space);
        if (scrollTo !== null) {
          scrollView.scrollTo({ y: scrollTo, animated: true });
        }
      });

    if (nativeScrollRef) {
      nativeScrollRef.measureInWindow((_x, y) => {
        scrollViewTop.current = y;
        plan();
      });
    } else {
      plan();
    }
  }, [applyBottomSpace, measureFocusedInput, visibleHeight]);

  const scheduleSync = useCallback(() => {
    if (syncTimer.current) {
      clearTimeout(syncTimer.current);
    }
    syncTimer.current = setTimeout(() => {
      syncTimer.current = null;
      sync();
    }, SYNC_DEBOUNCE_MS);
  }, [sync]);

  /**
   * Nothing reacted to the keyboard, so we have no idea how much of the screen
   * it covers. Park the focused input near the top, which is clear of any
   * keyboard — `sync` has already reserved the slack needed to get there.
   */
  const parkFocusedInputAtTop = useCallback(() => {
    layoutTimer.current = null;
    if (!inputFocused.current || visibleHeight() < restingViewportHeight.current) {
      return;
    }
    measureFocusedInput((inputTop) => {
      scrollRef.current?.scrollTo({ y: planTopParkScroll(inputTop), animated: true });
    });
  }, [measureFocusedInput, visibleHeight]);

  const handleInputFocus = useCallback(() => {
    if (blurTimer.current) {
      clearTimeout(blurTimer.current);
      blurTimer.current = null;
    }
    inputFocused.current = true;
    // Handles moving focus to another input while the keyboard is already up;
    // if it is still opening, the layout and keyboard events below re-run this.
    sync();

    if (layoutTimer.current) {
      clearTimeout(layoutTimer.current);
    }
    layoutTimer.current = setTimeout(parkFocusedInputAtTop, LAYOUT_REACTION_TIMEOUT_MS);
  }, [parkFocusedInputAtTop, sync]);

  const handleInputBlur = useCallback(() => {
    if (blurTimer.current) {
      clearTimeout(blurTimer.current);
    }
    blurTimer.current = setTimeout(() => {
      blurTimer.current = null;
      // Focus moving between two inputs blurs the first one; only treat the
      // keyboard as gone once nothing at all is focused.
      if (TextInput.State.currentlyFocusedInput()) {
        return;
      }
      inputFocused.current = false;
      if (layoutTimer.current) {
        clearTimeout(layoutTimer.current);
        layoutTimer.current = null;
      }
      applyBottomSpace(0);
    }, BLUR_SETTLE_MS);
  }, [applyBottomSpace]);

  const handleLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const height = e.nativeEvent.layout.height;

      if (height === viewportHeight.current) {
        return;
      }
      viewportHeight.current = height;

      if (!inputFocused.current) {
        restingViewportHeight.current = height;
        return;
      }
      // The available space just changed while typing — that is the keyboard
      // being reserved for, and the moment to re-check the focused input.
      if (layoutTimer.current) {
        clearTimeout(layoutTimer.current);
        layoutTimer.current = null;
      }
      scheduleSync();
    },
    [scheduleSync],
  );

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollOffset.current = e.nativeEvent.contentOffset.y;
  }, []);

  const handleContentSizeChange = useCallback((_width: number, height: number) => {
    contentHeight.current = height;
  }, []);

  useEffect(() => {
    const onShow = Keyboard.addListener('keyboardDidShow', (e) => {
      const { height, screenY } = e.endCoordinates;

      if (height > 0 && screenY > 0) {
        keyboardTop.current = screenY;
        scheduleSync();
      }
    });
    const onHide = Keyboard.addListener('keyboardDidHide', () => {
      keyboardTop.current = null;
    });

    return () => {
      onShow.remove();
      onHide.remove();
    };
  }, [scheduleSync]);

  useEffect(
    () => () => {
      if (layoutTimer.current) {
        clearTimeout(layoutTimer.current);
      }
      if (blurTimer.current) {
        clearTimeout(blurTimer.current);
      }
      if (syncTimer.current) {
        clearTimeout(syncTimer.current);
      }
    },
    [],
  );

  return {
    /** Spread onto the screen's `ScrollView`. */
    scrollViewProps: {
      ref: scrollRef,
      // RN types `innerViewRef` as a non-nullable RefObject<View>, which a ref
      // that starts out unattached can never satisfy.
      innerViewRef: contentRef as React.RefObject<View>,
      onLayout: handleLayout,
      onScroll: handleScroll,
      onContentSizeChange: handleContentSizeChange,
      scrollEventThrottle: 16,
    },
    /** Must be added to the `ScrollView`'s `contentContainerStyle` paddingBottom. */
    extraBottomSpace,
    handleInputFocus,
    handleInputBlur,
  };
}
