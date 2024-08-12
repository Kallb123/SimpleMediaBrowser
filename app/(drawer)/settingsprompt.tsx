import Ionicons from '@expo/vector-icons/Ionicons';
import { Button, StyleSheet, TextInput } from 'react-native';
import ParallaxScrollView from '@/components/ParallaxScrollView';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { useCallback, useState } from 'react';
import { router } from 'expo-router';
import { useSelector } from 'react-redux';
import { selectPassword } from '@/store/settingsReducer';

export default function SettingsPrompt() {
  const [password, setPassword] = useState("");

  const settingsPassword = useSelector(selectPassword);

  const goSettings = () => {
    if (password === settingsPassword) {
      router.navigate('/settings');
    } else {
      // Toast
      console.log(`Passwords don't match: ${password} - ${settingsPassword}`);
    }
  };
  
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
          onChangeText={setPassword}
          value={password ?? ""}
          placeholder="Settings password"
          keyboardType="default"
          secureTextEntry={false}
        />
      </ThemedView>
      <ThemedView style={styles.titleContainer}>
        <Button
            title="Go To Settings"
            onPress={goSettings}
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
