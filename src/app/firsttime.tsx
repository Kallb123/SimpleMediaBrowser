import { StyleSheet, Button, Switch, ScrollView, View, Platform } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HelloWave } from '@/components/HelloWave';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { ThemedTextInput } from '@/components/ThemedTextInput';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useState } from 'react';
import { StorageKeys } from '@/constants/StorageKeys';
import { useDispatch } from 'react-redux';
import { setPassword, setEnableThumbnailGeneration } from '@/store/settingsReducer';
import { AddMediaSource } from '@/components/ui/AddMediaSource';
import { logger } from '@/scripts/Logger';
import Constants from 'expo-constants';

const DIVIDER_COLOR = 'rgba(128,128,128,0.35)';

export default function FirstTime() {
  const [password, onChangePassword] = useState(null as string | null);
  const [sourceAdded, setSourceAdded] = useState(false);
  const [enableThumbnailGeneration, setEnableThumbnailGenerationLocal] = useState(false);
  const dispatch = useDispatch();
  const appVersion = Constants.expoConfig?.version ?? 'unknown';
  const insets = useSafeAreaInsets();

  logger.log('FirstTime', 'FirstTime screen rendered');

  const finishedGoHome = useCallback(async () => {
    logger.log('FirstTime', `Finishing first-time setup. Password set: ${!!password}`);
    if (password) {
      dispatch(setPassword(password));
    }
    dispatch(setEnableThumbnailGeneration(enableThumbnailGeneration));
    await AsyncStorage.setItem(StorageKeys.FIRST_TIME_SETUP_KEY, JSON.stringify(false));
    logger.log('FirstTime', 'First-time setup key written to AsyncStorage. Navigating to home.');
    router.replace('/(drawer)');
  }, [password, enableThumbnailGeneration, dispatch]);

  const contentPlatformStyle = Platform.select({
    android: {
      paddingTop: insets.top,
    },
    default: {},
  });

  return (
    <SafeAreaView style={styles.container}>
    <ThemedView style={styles.container}>
    <KeyboardAvoidingView style={styles.container} behavior="padding" automaticOffset>
    <ScrollView contentContainerStyle={[styles.contentContainer, contentPlatformStyle]}>
      <View style={styles.header}>
        <ThemedText type="title">Welcome to Simple Media Browser</ThemedText>
        <HelloWave />
      </View>

      {/* Settings Password */}
      <View style={styles.section}>
        <ThemedText type="subtitle" style={styles.sectionTitle}>Settings password (optional):</ThemedText>
        <View style={styles.field}>
          <ThemedTextInput
            onChangeText={onChangePassword}
            value={password ?? ""}
            placeholder="Leave blank for no password"
            keyboardType="default"
            secureTextEntry={true}
          />
        </View>
      </View>

      {/* Add Media Source */}
      <View style={styles.section}>
        <ThemedText type="subtitle" style={styles.sectionTitle}>Add a media source:</ThemedText>
        <AddMediaSource onAdded={(source) => {
          logger.log('FirstTime', `Media source added: type=${source.contentType} uri=${source.uri}`);
          setSourceAdded(true);
        }} />
        {sourceAdded && (
          <ThemedText style={styles.addedNote} accessibilityLabel="Source added successfully. You can add more in Settings later.">
            ✓ Source added. You can add more in Settings later.
          </ThemedText>
        )}
      </View>

      {/* Thumbnail Generation */}
      <View style={styles.section}>
        <ThemedText type="subtitle" style={styles.sectionTitle}>Generate video thumbnails:</ThemedText>
        <View style={styles.row}>
          <Switch
            value={enableThumbnailGeneration}
            onValueChange={setEnableThumbnailGenerationLocal}
          />
          <ThemedText style={styles.emptyText}>Off by default. You can change this later in Settings.</ThemedText>
        </View>
      </View>

      {/* Action Button */}
      <View style={styles.section}>
        <Button
          title="Finished, Go Home"
          onPress={finishedGoHome}
        />
      </View>

      {/* Footer */}
      <View style={styles.footerContainer}>
        <ThemedText style={styles.footerText}>Version {appVersion}</ThemedText>
      </View>
    </ScrollView>
    </KeyboardAvoidingView>
    </ThemedView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
    gap: 0,
  },
  header: {
    gap: 8,
    marginBottom: 8,
  },
  section: {
    gap: 12,
    paddingTop: 20,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: DIVIDER_COLOR,
  },
  sectionTitle: {
    fontSize: 15,
    marginBottom: 2,
  },
  field: {
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  addedNote: {
    fontSize: 13,
    opacity: 0.7,
  },
  emptyText: {
    opacity: 0.5,
    fontStyle: 'italic',
    fontSize: 13,
  },
  footerContainer: {
    marginTop: 24,
    marginBottom: 8,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 12,
    opacity: 0.6,
  },
});

