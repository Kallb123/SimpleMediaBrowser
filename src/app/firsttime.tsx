import { Image, StyleSheet, Button, Switch } from 'react-native';
import { HelloWave } from '@/components/HelloWave';
import ParallaxScrollView from '@/components/ParallaxScrollView';
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

export default function FirstTime() {
  const [password, onChangePassword] = useState(null as string | null);
  const [sourceAdded, setSourceAdded] = useState(false);
  const [enableThumbnailGeneration, setEnableThumbnailGenerationLocal] = useState(false);
  const dispatch = useDispatch();
  const appVersion = Constants.expoConfig?.version ?? 'unknown';

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

  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#A1CEDC', dark: '#1D3D47' }}
      headerImage={
        <Image
          source={require('@/assets/images/partial-react-logo.png')}
          style={styles.reactLogo}
        />
      }>
      <ThemedView style={styles.titleContainer}>
        <ThemedText type="title">Welcome to Simple Media Browser</ThemedText>
        <HelloWave />
      </ThemedView>
      <ThemedView style={styles.titleContainer}>
        <ThemedText>Add a media source:</ThemedText>
      </ThemedView>
      <AddMediaSource onAdded={(source) => {
          logger.log('FirstTime', `Media source added: type=${source.contentType} uri=${source.uri}`);
          setSourceAdded(true);
        }} />
      {sourceAdded && (
        <ThemedText style={styles.addedNote} accessibilityLabel="Source added successfully. You can add more in Settings later.">
          ✓ Source added. You can add more in Settings later.
        </ThemedText>
      )}
      <ThemedView style={styles.titleContainer}>
        <ThemedText>Settings password (optional):</ThemedText>
        <ThemedTextInput
          onChangeText={onChangePassword}
          value={password ?? ""}
          placeholder="Leave blank for no password"
          keyboardType="default"
          secureTextEntry={true}
        />
      </ThemedView>
      <ThemedView style={styles.titleContainer}>
        <ThemedText>Generate video thumbnails:</ThemedText>
        <Switch
          value={enableThumbnailGeneration}
          onValueChange={setEnableThumbnailGenerationLocal}
        />
      </ThemedView>
      <ThemedText style={styles.addedNote}>
        Off by default. You can change this later in Settings.
      </ThemedText>
      <ThemedView style={styles.titleContainer}>
        <Button
            title="Finished, Go Home"
            onPress={finishedGoHome}
        />
      </ThemedView>
      <ThemedView style={styles.footerContainer}>
        <ThemedText style={styles.footerText}>Version {appVersion}</ThemedText>
      </ThemedView>
    </ParallaxScrollView>
  );
}

const styles = StyleSheet.create({
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepContainer: {
    gap: 8,
    marginBottom: 8,
  },
  addedNote: {
    fontSize: 13,
    opacity: 0.7,
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
  reactLogo: {
    height: 178,
    width: 290,
    bottom: 0,
    left: 0,
    position: 'absolute',
  },
});

