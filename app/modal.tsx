import { View, Platform, Button } from 'react-native';
import { Link, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ScopedStorage from "react-native-scoped-storage"
import { useCallback, useEffect, useState } from 'react';
import { ThemedText } from '@/components/ThemedText';
import { StorageKeys } from '@/constants/StorageKeys';
import { selectDirectory, setDirectory } from '@/store/settingsReducer';
import { useDispatch, useSelector } from 'react-redux';

export default function Modal() {
    // If the page was reloaded or navigated to directly, then the modal should be presented as
    // a full screen page. You may need to change the UI to account for this.
    const isPresented = router.canGoBack();

    const directory = useSelector(selectDirectory);
    const dispatch = useDispatch();

    const checkDirectory = useCallback(async () => {
        if (!directory) {
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
        dispatch(setDirectory(selectedDir.uri))
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