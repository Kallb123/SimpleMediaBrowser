import Ionicons from '@expo/vector-icons/Ionicons';
import { Button, StyleSheet, TextInput } from 'react-native';
import ParallaxScrollView from '@/components/ParallaxScrollView';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { useCallback, useEffect, useState } from 'react';
import { router } from 'expo-router';
import * as ScopedStorage from "react-native-scoped-storage";
import { useDispatch, useSelector } from 'react-redux';
import { selectDirectory, selectPassword, setDirectory, setPassword } from '@/store/settingsReducer';

export default function SettingsPrompt() {
  const [dir, setDir] = useState(null as string | null);
  const [password, setLocalPassword] = useState(null as string | null);

  const dispatch = useDispatch();
  const settingsPassword = useSelector(selectPassword);
  const directory = useSelector(selectDirectory);
  
  useEffect(() => {
    console.log(`Got dir: ${directory} and pass: ${settingsPassword}`);
    setDir(directory as string);
    setLocalPassword(settingsPassword as string);
  }, [directory, settingsPassword]);

  const save = () => {
    console.log(dir);
    if (dir) {
      console.log(`Setting directory to: ${dir}`);
      dispatch(setDirectory(dir));
    }
    console.log(password);
    if (password) {
      console.log(`Setting password to: ${password}`);
      dispatch(setPassword(password));
    }
    router.replace('/(drawer)')
  };

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
  
  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#D0D0D0', dark: '#353636' }}
      headerImage={<Ionicons size={310} name="code-slash" style={styles.headerImage} />}>
      <ThemedView style={styles.titleContainer}>
        <ThemedText type="title">Settings</ThemedText>
      </ThemedView>
      <ThemedView style={styles.titleContainer}>
        <ThemedText>Password for settings:</ThemedText>
        <TextInput
          // style={styles.input}
          onChangeText={setLocalPassword}
          value={password ?? ""}
          placeholder="Settings password"
          keyboardType="default"
          secureTextEntry={false}
        />
      </ThemedView>
      <ThemedView style={styles.titleContainer}>
        <ThemedText>Select a directory:</ThemedText>
        <Button
            title="Change Directory"
            onPress={selectNewDirectory}
        />
      </ThemedView>
      <ThemedText>Directory is: {dir}</ThemedText>
      <ThemedView style={styles.titleContainer}>
        <Button
            title="Save"
            onPress={save}
        />
      </ThemedView>
    </ParallaxScrollView>
  );
}

const styles = StyleSheet.create({
  headerImage: {
    color: '#808080',
    bottom: -90,
    left: -35,
    position: 'absolute',
  },
  titleContainer: {
    flexDirection: 'row',
    gap: 8,
  },
});
