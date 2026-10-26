import { Keyboard } from 'react-native';
import { KeyboardEvents } from 'react-native-keyboard-controller';
import { logger } from '@/scripts/Logger';

let started = false;

/**
 * Temporary diagnostics for issue 244: logs which keyboard-reporting mechanisms
 * actually fire on a device (Amazon Fire tablets are suspected to report neither
 * to react-native-keyboard-controller), so the Debug Logs screen shows it.
 * Idempotent; the listeners live for the lifetime of the app.
 */
export function startKeyboardDiagnostics() {
  if (started) {
    return;
  }
  started = true;

  Keyboard.addListener('keyboardDidShow', (e) => {
    logger.log('Keyboard', `RN Keyboard keyboardDidShow height=${e.endCoordinates.height} screenY=${e.endCoordinates.screenY}`);
  });
  Keyboard.addListener('keyboardDidHide', (e) => {
    logger.log('Keyboard', `RN Keyboard keyboardDidHide height=${e.endCoordinates.height} screenY=${e.endCoordinates.screenY}`);
  });
  KeyboardEvents.addListener('keyboardDidShow', (e) => {
    logger.log('Keyboard', `keyboard-controller keyboardDidShow height=${e.height}`);
  });
  KeyboardEvents.addListener('keyboardDidHide', (e) => {
    logger.log('Keyboard', `keyboard-controller keyboardDidHide height=${e.height}`);
  });
}
