import { useCallback, useEffect, useRef } from 'react';
import {
  Dimensions,
  findNodeHandle,
  Keyboard,
  type FocusEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  UIManager,
} from 'react-native';

// Breathing room left between the focused input and the top of the keyboard
// once it's been scrolled into view.
const FOCUSED_INPUT_MARGIN = 24;

// Some devices (observed on Amazon Fire OS) never dispatch a keyboardDidShow
// event with a real height — the resize/inset callback RN's Keyboard module
// relies on just doesn't fire. Without a real measurement, assume the
// keyboard could take up this fraction of the screen so focused inputs still
// get scrolled clear instead of silently doing nothing.
const FALLBACK_KEYBOARD_HEIGHT_RATIO = 0.45;

type MeasurableTarget = { measureInWindow?: (callback: (x: number, y: number, width: number, height: number) => void) => void } | number | null | undefined;

function measureTarget(target: MeasurableTarget, callback: (y: number, height: number) => void) {
  if (target && typeof target === 'object' && typeof target.measureInWindow === 'function') {
    target.measureInWindow((_x, y, _width, height) => callback(y, height));
    return;
  }
  const tag = findNodeHandle(target as number | null);
  if (tag == null) return;
  UIManager.measureInWindow(tag, (_x, y, _width, height) => callback(y, height));
}

/**
 * react-native-keyboard-controller's automatic scroll-to-focused-input
 * behavior (used by both its KeyboardAvoidingView and KeyboardAwareScrollView)
 * doesn't fire reliably on this app's stack — see
 * https://github.com/kirillzyusko/react-native-keyboard-controller/issues/1411.
 * KeyboardAvoidingView still reserves space for the keyboard correctly on most
 * devices, but inputs low in a ScrollView are left with no way to scroll them
 * into view.
 *
 * This tracks the keyboard height via React Native's own Keyboard module
 * (unrelated to that library's reanimated-driven internals) and nudges the
 * ScrollView directly when it would otherwise leave the focused input hidden.
 * It deliberately doesn't wait on that height being reported before reacting:
 * some devices never dispatch it at all, so focus alone triggers a reveal
 * using the last known (or a conservative assumed) height, refined further if
 * a real measurement arrives afterward.
 */
export function useKeyboardScrollFix() {
  const scrollRef = useRef<ScrollView>(null);
  const scrollOffsetY = useRef(0);
  const focusedTarget = useRef<MeasurableTarget>(null);
  const knownKeyboardHeight = useRef(0);

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollOffsetY.current = e.nativeEvent.contentOffset.y;
  }, []);

  const revealFocusedInput = useCallback((keyboardHeight: number) => {
    const target = focusedTarget.current;
    const scrollView = scrollRef.current;
    if (!target || !scrollView) return;
    const windowHeight = Dimensions.get('window').height;
    const effectiveKeyboardHeight = keyboardHeight > 0
      ? keyboardHeight
      : windowHeight * FALLBACK_KEYBOARD_HEIGHT_RATIO;
    measureTarget(target, (y, height) => {
      const visibleBottom = windowHeight - effectiveKeyboardHeight;
      const overflow = y + height + FOCUSED_INPUT_MARGIN - visibleBottom;
      if (overflow > 0) {
        scrollView.scrollTo({ y: scrollOffsetY.current + overflow, animated: true });
      }
    });
  }, []);

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
      knownKeyboardHeight.current = e.endCoordinates.height;
      revealFocusedInput(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      knownKeyboardHeight.current = 0;
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [revealFocusedInput]);

  const handleInputFocus = useCallback((e: FocusEvent) => {
    focusedTarget.current = e.target as MeasurableTarget;
    // Don't wait for keyboardDidShow — it may never arrive (observed on some
    // Fire OS devices), so react to focus itself using the best height info
    // available right now, and let the listener above refine it if a real
    // measurement shows up afterward.
    requestAnimationFrame(() => revealFocusedInput(knownKeyboardHeight.current));
  }, [revealFocusedInput]);

  return { scrollRef, handleScroll, handleInputFocus };
}
