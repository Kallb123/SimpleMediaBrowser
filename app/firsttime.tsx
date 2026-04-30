import { Image, StyleSheet, Button } from 'react-native';
import { HelloWave } from '@/components/HelloWave';
import ParallaxScrollView from '@/components/ParallaxScrollView';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { StorageKeys } from '@/constants/StorageKeys';
import { useDispatch } from 'react-redux';
import { setPassword } from '@/store/settingsReducer';
import { AddMediaSource } from '@/components/UI/AddMediaSource';

export default function FirstTime() {
  const [password, onChangePassword] = useState(null as string | null);
  const [sourceAdded, setSourceAdded] = useState(false);
  const dispatch = useDispatch();

  useEffect(() => {
    // setFirstTime()
  }, []);

  const setFirstTime = async () => {
    await AsyncStorage.setItem(StorageKeys.FIRST_TIME_SETUP_KEY, JSON.stringify(false));
  }

  const finishedGoHome = useCallback(async () => {
    if (password) {
      dispatch(setPassword(password));
    }
    await AsyncStorage.setItem(StorageKeys.FIRST_TIME_SETUP_KEY, JSON.stringify(false));
    router.replace('/(tabs)');
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
      <AddMediaSource onAdded={() => setSourceAdded(true)} />
      {sourceAdded && (
        <ThemedText style={styles.addedNote}>✓ Source added. You can add more in Settings later.</ThemedText>
      )}
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

