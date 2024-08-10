import { View, Platform, Button } from 'react-native';
import { Link, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ScopedStorage from "react-native-scoped-storage"
import { useCallback, useEffect, useState } from 'react';
import { ThemedText } from '@/components/ThemedText';
import { StorageKeys } from '@/constants/StorageKeys';

export default function Modal() {
    // If the page was reloaded or navigated to directly, then the modal should be presented as
    // a full screen page. You may need to change the UI to account for this.
    const isPresented = router.canGoBack();

    const [directory, setDirectory] = useState("Unset");

    const checkDirectory = useCallback(async () => {
        let dir = "";
        try {
            dir = await AsyncStorage.getItem(StorageKeys.DIRECTORY_KEY);
            setDirectory(dir);
        } catch (eRead) {
            console.error(eRead);
        }
        if (!dir) {
            console.log("No directory set, asking for a new one");
            await selectNewDirectory();
        }
    }, []);

    const selectNewDirectory = useCallback(async () => {
        let selectedDir;
        try {
            selectedDir = await ScopedStorage.openDocumentTree(true);
        } catch (eNew) {
            // Toast to say selection cancelled?
            return;
        }
        setDirectory(selectedDir.uri);
        try {
            await AsyncStorage.setItem(StorageKeys.DIRECTORY_KEY, selectedDir.uri);
        } catch (eWrite) {
            console.error(eWrite);
            // saving error
        }
    }, []);

    const resetFirstTime = useCallback(async () => {
        await AsyncStorage.setItem(StorageKeys.FIRST_TIME_SETUP_KEY, JSON.stringify(true));
    }, []);

    useEffect(() => {
        checkDirectory();
    }, [checkDirectory]);

    return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            {/* Use `../` as a simple way to navigate to the root. This is not analogous to "goBack". */}
            {!isPresented && <Link href="../">Dismiss</Link>}
            {/* Native modals have dark backgrounds on iOS. Set the status bar to light content and add a fallback for other platforms with auto. */}
            <StatusBar style={Platform.OS === 'ios' ? 'light' : 'auto'} />
            <ThemedText>Directory is: {directory}</ThemedText>
            <Button
                title="Change Directory"
                onPress={selectNewDirectory}
            />
            <Button
                title="Reset First Time"
                onPress={resetFirstTime}
            />
        </View>
    );
}