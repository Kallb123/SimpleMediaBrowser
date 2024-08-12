import { Image, StyleSheet, Button, TextInput } from 'react-native';
import { HelloWave } from '@/components/HelloWave';
import ParallaxScrollView from '@/components/ParallaxScrollView';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ScopedStorage from "react-native-scoped-storage";
import { useCallback, useEffect, useState } from 'react';
import { StorageKeys } from '@/constants/StorageKeys';
import { useDispatch } from 'react-redux';
import { setDirectory, setPassword } from '@/store/settingsReducer';

export default function FirstTime() {
  const [password, onChangePassword] = useState(null as string | null);
  const [dir, setDir] = useState(null as string | null);
  const dispatch = useDispatch();

  useEffect(() => {
    // setFirstTime()
  }, []);

  const setFirstTime = async () => {
    await AsyncStorage.setItem(StorageKeys.FIRST_TIME_SETUP_KEY, JSON.stringify(false));
  }

  const selectNewDirectory = useCallback(async () => {
    let selectedDir;
    try {
        selectedDir = await ScopedStorage.openDocumentTree(true);
    } catch (eNew) {
        // Toast to say selection cancelled?
        return;
    }
    setDir(selectedDir.uri);
  }, []);

  const finishedGoHome = useCallback(async () => {
    if (dir) {
      dispatch(setDirectory(dir));
    }
    if (password) {
      dispatch(setPassword(password));
    }
    await AsyncStorage.setItem(StorageKeys.FIRST_TIME_SETUP_KEY, JSON.stringify(false));
    router.replace('/(tabs)');
  }, []);

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
        <ThemedText>Password for settings:</ThemedText>
        <TextInput
          // style={styles.input}
          onChangeText={onChangePassword}
          value={password ?? ""}
          placeholder="Settings password"
          keyboardType="default"
          secureTextEntry={true}
        />
      </ThemedView>
      <ThemedView style={styles.titleContainer}>
        <ThemedText>Select a directory:</ThemedText>
        <Button
            title="Change Directory"
            onPress={selectNewDirectory}
        />
      </ThemedView>
      <ThemedView style={styles.titleContainer}>
        <ThemedText>{dir}</ThemedText>
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
  reactLogo: {
    height: 178,
    width: 290,
    bottom: 0,
    left: 0,
    position: 'absolute',
  },
});
