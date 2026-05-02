import { Image, StyleSheet, Button } from 'react-native';
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
import { setPassword } from '@/store/settingsReducer';
import { AddMediaSource } from '@/components/UI/AddMediaSource';
import { logger } from '@/scripts/Logger';

export default function FirstTime() {
  const [password, onChangePassword] = useState(null as string | null);
  const [sourceAdded, setSourceAdded] = useState(false);
  const dispatch = useDispatch();

  logger.log('FirstTime', 'FirstTime screen rendered');

  const finishedGoHome = useCallback(async () => {
    logger.log('FirstTime', `Finishing first-time setup. Password set: ${!!password}`);
    if (password) {
      dispatch(setPassword(password));
    }
    await AsyncStorage.setItem(StorageKeys.FIRST_TIME_SETUP_KEY, JSON.stringify(false));
    logger.log('FirstTime', 'First-time setup key written to AsyncStorage. Navigating to home.');
    router.replace('/(drawer)');
  }, [password, dispatch]);

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
        <Button
            title="Finished, Go Home"
            onPress={finishedGoHome}
        />
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
  reactLogo: {
    height: 178,
    width: 290,
    bottom: 0,
    left: 0,
    position: 'absolute',
  },
});

