import { View, Platform, Button } from 'react-native';
import { Link, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect } from 'react';
import { ThemedText } from '@/components/ThemedText';
import { StorageKeys } from '@/constants/StorageKeys';
import { selectMediaSources } from '@/store/settingsReducer';
import { useSelector } from 'react-redux';
import { AddMediaSource } from '@/components/ui/AddMediaSource';

export default function Modal() {
    // If the page was reloaded or navigated to directly, then the modal should be presented as
    // a full screen page. You may need to change the UI to account for this.
    const isPresented = router.canGoBack();

    const mediaSources = useSelector(selectMediaSources);

    const resetFirstTime = useCallback(async () => {
        await AsyncStorage.setItem(StorageKeys.FIRST_TIME_SETUP_KEY, JSON.stringify(true));
        router.replace("/firsttime");
    }, []);

    return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 }}>
            {/* Use `../` as a simple way to navigate to the root. This is not analogous to "goBack". */}
            {!isPresented && <Link href="../">Dismiss</Link>}
            {/* Native modals have dark backgrounds on iOS. Set the status bar to light content and add a fallback for other platforms with auto. */}
            <StatusBar style={Platform.OS === 'ios' ? 'light' : 'auto'} />
            <ThemedText>Sources configured: {mediaSources.length}</ThemedText>
            <AddMediaSource />
            <Button
                title="Reset First Time"
                onPress={resetFirstTime}
            />
        </View>
    );
}