import { View, Platform, Button } from 'react-native';
import { Link, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ScopedStorage from "react-native-scoped-storage";
import { useCallback, useEffect } from 'react';
import { ThemedText } from '@/components/ThemedText';
import { StorageKeys } from '@/constants/StorageKeys';
import { selectMediaSources, addMediaSource } from '@/store/settingsReducer';
import { useDispatch, useSelector } from 'react-redux';

export default function Modal() {
    // If the page was reloaded or navigated to directly, then the modal should be presented as
    // a full screen page. You may need to change the UI to account for this.
    const isPresented = router.canGoBack();

    const mediaSources = useSelector(selectMediaSources);
    const dispatch = useDispatch();

    const checkDirectory = useCallback(async () => {
        if (!mediaSources || mediaSources.length === 0) {
            console.log("No sources set, asking for a new one");
            await selectNewDirectory();
        }
    }, [mediaSources]);

    const selectNewDirectory = useCallback(async () => {
        let selectedDir;
        try {
            selectedDir = await ScopedStorage.openDocumentTree(true);
        } catch (eNew) {
            // Toast to say selection cancelled?
            return;
        }
        dispatch(addMediaSource({ uri: selectedDir.uri, contentType: 'tv' }));
    }, [dispatch]);

    const resetFirstTime = useCallback(async () => {
        await AsyncStorage.setItem(StorageKeys.FIRST_TIME_SETUP_KEY, JSON.stringify(true));
        router.replace("/firsttime");
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
            <ThemedText>Sources: {mediaSources.length}</ThemedText>
            <Button
                title="Add Source Directory"
                onPress={selectNewDirectory}
            />
            <Button
                title="Reset First Time"
                onPress={resetFirstTime}
            />
        </View>
    );
}