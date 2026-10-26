import { useEffect } from 'react';
import { ScrollView, StyleSheet, type ScrollViewProps, type StyleProp, type ViewStyle } from 'react-native';
import { KeyboardAvoidingView, KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { REVEAL_MARGIN, type useKeyboardAwareScroll } from '@/hooks/useKeyboardAwareScroll';
import { useAppSelector } from '@/hooks/useRedux';
import { logger } from '@/scripts/Logger';
import { selectKeyboardHandling } from '@/store/settingsReducer';

type Props = ScrollViewProps & {
  /** The screen's own `useKeyboardAwareScroll()` result; its handlers stay wired onto the inputs. */
  keyboard: ReturnType<typeof useKeyboardAwareScroll>;
  /** `KeyboardAvoidingView` offsets and style; only used by the 'legacy' mode. */
  keyboardVerticalOffset?: number;
  automaticOffset?: boolean;
  avoidingViewStyle?: StyleProp<ViewStyle>;
};

/**
 * Temporary experiment for issue 244: renders either today's
 * `KeyboardAvoidingView` + `ScrollView` driven by `useKeyboardAwareScroll`
 * ('legacy') or react-native-keyboard-controller's `KeyboardAwareScrollView`
 * ('library'), depending on the `keyboardHandling` setting.
 */
export function KeyboardAwareForm({
  keyboard,
  keyboardVerticalOffset,
  automaticOffset,
  avoidingViewStyle,
  contentContainerStyle,
  children,
  ...scrollViewProps
}: Props) {
  const mode = useAppSelector(selectKeyboardHandling);

  useEffect(() => {
    logger.log('Keyboard', `Form using ${mode} keyboard handling`);
  }, [mode]);

  if (mode === 'library') {
    // The hook's scrollViewProps (and so its scrollRef/innerViewRef) are not
    // attached here, which leaves the hook inert: `sync` bails without a
    // scrollRef, and `parkFocusedInputAtTop` can't measure without a contentRef.
    return (
      <KeyboardAwareScrollView
        {...scrollViewProps}
        bottomOffset={REVEAL_MARGIN}
        contentContainerStyle={contentContainerStyle}
      >
        {children}
      </KeyboardAwareScrollView>
    );
  }

  const basePaddingBottom = StyleSheet.flatten(contentContainerStyle)?.paddingBottom;

  return (
    <KeyboardAvoidingView
      style={avoidingViewStyle}
      behavior="padding"
      keyboardVerticalOffset={keyboardVerticalOffset}
      automaticOffset={automaticOffset}
    >
      <ScrollView
        {...keyboard.scrollViewProps}
        {...scrollViewProps}
        contentContainerStyle={[
          contentContainerStyle,
          { paddingBottom: (typeof basePaddingBottom === 'number' ? basePaddingBottom : 0) + keyboard.extraBottomSpace },
        ]}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
