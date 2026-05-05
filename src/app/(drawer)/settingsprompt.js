import Ionicons from '@expo/vector-icons/Ionicons';
import { Button, StyleSheet } from 'react-native';
import { ThemedTextInput } from '@/components/ThemedTextInput';
import ParallaxScrollView from '@/components/ParallaxScrollView';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { useSelector } from 'react-redux';
import { selectPassword } from '@/store/settingsReducer';
import { logger } from '@/scripts/Logger';
export default function SettingsPrompt() {
    const [password, setPassword] = useState("");
    const hasAutoNavigatedRef = useRef(false);
    const settingsPassword = useSelector(selectPassword);
    useEffect(() => {
        try {
            if (!settingsPassword) {
                if (hasAutoNavigatedRef.current) {
                    return;
                }
                hasAutoNavigatedRef.current = true;
                logger.log('SettingsPrompt', 'No password set – skipping prompt and navigating to settings (one-shot)');
                const frame = requestAnimationFrame(() => {
                    router.push('/settings');
                });
                return () => cancelAnimationFrame(frame);
            }
            hasAutoNavigatedRef.current = false;
        }
        catch (e) {
            logger.error('SettingsPrompt', 'Error during auto-navigation to settings', e);
        }
    }, [settingsPassword]);
    const goSettings = () => {
        try {
            const storedPassword = settingsPassword ?? "";
            if (password === storedPassword) {
                logger.log('SettingsPrompt', 'Password accepted – navigating to settings');
                router.push('/settings');
            }
            else {
                logger.warn('SettingsPrompt', 'Password rejected – entered password does not match stored password');
                // Toast
                console.log(`Passwords don't match: ${password} - ${settingsPassword}`);
            }
        }
        catch (e) {
            logger.error('SettingsPrompt', 'Error while validating password or navigating', e);
        }
    };
    return (<ParallaxScrollView headerBackgroundColor={{ light: '#D0D0D0', dark: '#353636' }} headerImage={<Ionicons size={310} name="code-slash" style={styles.headerImage}/>}>
      <ThemedView style={styles.titleContainer}>
        <ThemedText type="title">Settings</ThemedText>
      </ThemedView>
      <ThemedView style={styles.titleContainer}>
        <ThemedText>Password for settings:</ThemedText>
        <ThemedTextInput onChangeText={setPassword} value={password ?? ""} placeholder="Settings password" keyboardType="default" secureTextEntry={true}/>
      </ThemedView>
      <ThemedView style={styles.titleContainer}>
        <Button title="Go To Settings" onPress={goSettings}/>
      </ThemedView>
    </ParallaxScrollView>);
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
