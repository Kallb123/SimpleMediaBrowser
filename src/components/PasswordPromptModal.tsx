import { useEffect, useState } from 'react';
import { Alert, Modal, StyleSheet, TouchableOpacity, View } from 'react-native';
import { KeyboardAvoidingView, KeyboardProvider } from 'react-native-keyboard-controller';
import { useDispatch, useSelector } from 'react-redux';
import { ThemedText } from '@/components/ThemedText';
import { ThemedTextInput } from '@/components/ThemedTextInput';
import { useColorScheme } from '@/hooks/useColorScheme';
import { logger } from '@/scripts/Logger';
import { computeRecoveryCode, recoveryChallengeText } from '@/scripts/PasswordRecovery';
import { selectPassword, setPassword } from '@/store/settingsReducer';

interface PasswordPromptModalProps {
  visible: boolean;
  title: string;
  subtitle: string;
  /** Label of the primary button in password mode (default "Unlock"). */
  confirmLabel?: string;
  /** Called after the password was entered correctly, or after recovery cleared it. The caller closes the modal. */
  onSuccess: () => void;
  onCancel: () => void;
}

/**
 * Prompts for the settings (parent-mode) password, with the offline "Forgot password?"
 * recovery flow. Owns its input/error/recovery state, which is reset whenever
 * the modal is opened or closed.
 */
export function PasswordPromptModal({
  visible,
  title,
  subtitle,
  confirmLabel = 'Unlock',
  onSuccess,
  onCancel,
}: PasswordPromptModalProps) {
  const dispatch = useDispatch();
  const settingsPassword = useSelector(selectPassword);
  const colorScheme = useColorScheme() ?? 'light';
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState('');
  const [recoveryError, setRecoveryError] = useState('');

  // Start from a clean slate each time the modal opens or closes.
  useEffect(() => {
    setPasswordInput('');
    setPasswordError('');
    setRecoveryMode(false);
    setRecoveryInput('');
    setRecoveryError('');
  }, [visible]);

  const submitPassword = () => {
    if (passwordInput === settingsPassword) {
      logger.log('PasswordPrompt', `Settings password accepted (${title})`);
      onSuccess();
    } else {
      logger.warn('PasswordPrompt', `Settings password rejected (${title})`);
      setPasswordError('Incorrect password.');
    }
  };

  const startRecovery = () => {
    setPasswordError('');
    setRecoveryInput('');
    setRecoveryError('');
    setRecoveryMode(true);
  };

  const cancelRecovery = () => {
    setRecoveryMode(false);
    setRecoveryInput('');
    setRecoveryError('');
  };

  const submitRecovery = () => {
    if (recoveryInput.trim() === computeRecoveryCode()) {
      logger.log('PasswordPrompt', 'Settings password recovered via math challenge – password cleared');
      dispatch(setPassword(null));
      Alert.alert('Password cleared', 'The settings password has been removed. Set a new one from Settings if you want to lock it again.');
      onSuccess();
    } else {
      logger.warn('PasswordPrompt', 'Settings password recovery code rejected');
      setRecoveryError('Incorrect code.');
    }
  };

  const borderColor = colorScheme === 'dark' ? '#555' : '#CCC';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      {/* RN's Modal renders in its own native window on Android, separate from the
          app-root KeyboardProvider's window, so keyboard insets there need their own
          nested KeyboardProvider rather than relying on the root one. */}
      <KeyboardProvider>
      <KeyboardAvoidingView style={styles.modalOverlay} behavior="padding" automaticOffset>
        <View style={[styles.modalBox, { backgroundColor: colorScheme === 'dark' ? '#1E2022' : '#fff' }]}>
          {recoveryMode ? (
            <>
              <ThemedText type="subtitle" style={styles.modalTitle}>Forgotten Password Recovery</ThemedText>
              <ThemedText style={styles.modalSubtitle}>{recoveryChallengeText()}</ThemedText>
              <ThemedTextInput
                value={recoveryInput}
                onChangeText={(v) => {
                  setRecoveryInput(v);
                  setRecoveryError('');
                }}
                placeholder="6-digit code"
                keyboardType="number-pad"
                style={styles.modalInput}
                autoFocus
                onSubmitEditing={submitRecovery}
              />
              {recoveryError !== '' && (
                <ThemedText style={styles.errorText}>{recoveryError}</ThemedText>
              )}
              <View style={styles.modalButtons}>
                <TouchableOpacity onPress={cancelRecovery} style={[styles.modalButton, { borderColor }]}>
                  <ThemedText>Back</ThemedText>
                </TouchableOpacity>
                <TouchableOpacity onPress={submitRecovery} style={[styles.modalButton, styles.modalButtonPrimary]}>
                  <ThemedText style={styles.modalButtonPrimaryText}>Submit</ThemedText>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <ThemedText type="subtitle" style={styles.modalTitle}>{title}</ThemedText>
              <ThemedText style={styles.modalSubtitle}>{subtitle}</ThemedText>
              <ThemedTextInput
                value={passwordInput}
                onChangeText={(v) => {
                  setPasswordInput(v);
                  setPasswordError('');
                }}
                placeholder="Password"
                secureTextEntry
                style={styles.modalInput}
                autoFocus
                onSubmitEditing={submitPassword}
              />
              {passwordError !== '' && (
                <ThemedText style={styles.errorText}>{passwordError}</ThemedText>
              )}
              <View style={styles.modalButtons}>
                <TouchableOpacity onPress={onCancel} style={[styles.modalButton, { borderColor }]}>
                  <ThemedText>Cancel</ThemedText>
                </TouchableOpacity>
                <TouchableOpacity onPress={submitPassword} style={[styles.modalButton, styles.modalButtonPrimary]}>
                  <ThemedText style={styles.modalButtonPrimaryText}>{confirmLabel}</ThemedText>
                </TouchableOpacity>
              </View>
              <TouchableOpacity onPress={startRecovery}>
                <ThemedText style={styles.forgotPasswordText}>Forgot password?</ThemedText>
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
      </KeyboardProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBox: {
    borderRadius: 12,
    padding: 24,
    width: '80%',
    gap: 12,
  },
  modalTitle: {
    textAlign: 'center',
  },
  modalSubtitle: {
    textAlign: 'center',
    opacity: 0.7,
  },
  modalInput: {
    flex: 0,
    paddingVertical: 12,
    minHeight: 44,
  },
  errorText: {
    color: '#E55',
    fontSize: 13,
    textAlign: 'center',
  },
  forgotPasswordText: {
    color: '#0a7ea4',
    fontSize: 13,
    textAlign: 'center',
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  modalButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  modalButtonPrimary: {
    backgroundColor: '#0a7ea4',
    borderColor: '#0a7ea4',
  },
  modalButtonPrimaryText: {
    color: '#fff',
    fontWeight: '600',
  },
});
