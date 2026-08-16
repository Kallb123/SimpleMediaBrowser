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
 * KeyboardAvoidingView still reserves space for the keyboard correctly, but
 * inputs low in a ScrollView are left with no way to scroll them into view.
 *
 * This tracks the keyboard height via React Native's own Keyboard module
 * (unrelated to that library's reanimated-driven internals) and nudges the
 * ScrollView directly when it would otherwise leave the focused input hidden.
 */
export function useKeyboardScrollFix() {
  const scrollRef = useRef<ScrollView>(null);
  const scrollOffsetY = useRef(0);
  const focusedTarget = useRef<MeasurableTarget>(null);

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollOffsetY.current = e.nativeEvent.contentOffset.y;
  }, []);

  const revealFocusedInput = useCallback((keyboardHeight: number) => {
    const target = focusedTarget.current;
    const scrollView = scrollRef.current;
    if (!target || !scrollView || keyboardHeight <= 0) return;
    measureTarget(target, (y, height) => {
      const windowHeight = Dimensions.get('window').height;
      const visibleBottom = windowHeight - keyboardHeight;
      const overflow = y + height + FOCUSED_INPUT_MARGIN - visibleBottom;
      if (overflow > 0) {
        scrollView.scrollTo({ y: scrollOffsetY.current + overflow, animated: true });
      }
    });
  }, []);

  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', (e) => {
      revealFocusedInput(e.endCoordinates.height);
    });
    return () => sub.remove();
  }, [revealFocusedInput]);

  const handleInputFocus = useCallback((e: FocusEvent) => {
    focusedTarget.current = e.target as MeasurableTarget;
    // Focus moving between two inputs while the keyboard is already up
    // doesn't re-fire keyboardDidShow, so nudge immediately in that case.
    const currentHeight = Keyboard.metrics()?.height ?? 0;
    if (currentHeight > 0) {
      requestAnimationFrame(() => revealFocusedInput(currentHeight));
    }
  }, [revealFocusedInput]);

  return { scrollRef, handleScroll, handleInputFocus };
}
