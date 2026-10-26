import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { useColorScheme as useNativeColorScheme } from 'react-native';
import 'react-native-reanimated';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import '@/global.css';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StorageKeys } from '@/constants/StorageKeys';
import { Provider, useSelector } from 'react-redux';
import { store, waitForPersistBootstrap } from '@/store/store';
import '@/store/wireServices';
import { startLibraryPersistence } from '@/store/libraryPersistence';
import { logger } from '@/scripts/Logger';
import { EditModeProvider } from '@/contexts/EditModeContext';
import { BedtimeProvider } from '@/contexts/BedtimeContext';
import { FirstTimeSetupProvider } from '@/contexts/FirstTimeSetupContext';
import { selectAppColorScheme } from '@/store/settingsReducer';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

logger.log('RootLayout', 'App starting up');

export default function RootLayout() {
  return (
    <Provider store={store}>
      <AppRoot />
    </Provider>
  );
}

function AppRoot() {
  const nativeColorScheme = useNativeColorScheme() ?? 'light';
  const appColorScheme = useSelector(selectAppColorScheme);
  const effectiveScheme = appColorScheme === 'system' ? nativeColorScheme : appColorScheme;

  // null until the persisted first-time flag has been read; the guards below need a real value.
  const [setupComplete, setSetupComplete] = useState<boolean | null>(null);

  const [fontsLoaded] = useFonts({
    SpaceMono: require('../../assets/fonts/SpaceMono-Regular.ttf'),
  });

  useEffect(() => {
    const maybeErrorUtils = (globalThis as any).ErrorUtils;
    if (!maybeErrorUtils || typeof maybeErrorUtils.getGlobalHandler !== 'function' || typeof maybeErrorUtils.setGlobalHandler !== 'function') {
      return;
    }

    const previousHandler = maybeErrorUtils.getGlobalHandler();
    maybeErrorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Unhandled', `Uncaught exception (fatal=${Boolean(isFatal)}): ${err.message}`, err.stack ?? '(no stack)');
      if (typeof previousHandler === 'function') {
        previousHandler(error, isFatal);
      }
    });

    return () => {
      if (typeof previousHandler === 'function') {
        maybeErrorUtils.setGlobalHandler(previousHandler);
      }
    };
  }, []);

  useEffect(() => {
    if (fontsLoaded) {
      logger.log('RootLayout', 'Fonts loaded');
    }
  }, [fontsLoaded]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      logger.log('RootLayout', 'Checking first-time setup key');
      // Wait for redux-persist to finish rehydrating so settings are available
      await waitForPersistBootstrap();
      // Load (or migrate) the library before the drawer mounts: its startup scan
      // carries metadata over from the existing library. Never rejects.
      await startLibraryPersistence();
      const firstTimeLookup = await AsyncStorage.getItem(StorageKeys.FIRST_TIME_SETUP_KEY);
      logger.log('RootLayout', `First-time setup key value: ${firstTimeLookup}`);
      if (!cancelled) {
        setSetupComplete(firstTimeLookup === 'false');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const ready = fontsLoaded && setupComplete !== null;

  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync();
    }
  }, [ready]);

  if (!ready) {
    return null;
  }

  return (
    <KeyboardProvider>
      <ThemeProvider value={effectiveScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <StatusBar style={effectiveScheme === 'dark' ? 'light' : 'dark'} />
        <EditModeProvider>
          <BedtimeProvider>
            <FirstTimeSetupProvider setupComplete={setupComplete} setSetupComplete={setSetupComplete}>
              <Stack>
                {/* "/" resolves to this blank route; guarding it off makes the stack open on the first screen the guards below allow. */}
                <Stack.Protected guard={false}>
                  <Stack.Screen name="index" />
                </Stack.Protected>
                <Stack.Protected guard={!setupComplete}>
                  <Stack.Screen name="firsttime" options={{ headerShown: false }} />
                </Stack.Protected>
                <Stack.Protected guard={setupComplete}>
                  <Stack.Screen name="(drawer)" options={{ headerShown: false }} />
                  <Stack.Screen
                    name="modal"
                    options={{
                      presentation: 'modal',
                    }}
                  />
                  <Stack.Screen
                    name="edititem"
                    options={{
                      presentation: 'modal',
                      title: 'Edit Item',
                    }}
                  />
                  <Stack.Screen
                    name="editposter"
                    options={{
                      presentation: 'modal',
                      title: 'Choose Poster',
                    }}
                  />
                  <Stack.Screen
                    name="editrematch"
                    options={{
                      presentation: 'modal',
                      title: 'Re-match Metadata',
                    }}
                  />
                  <Stack.Screen
                    name="mergeshows"
                    options={{
                      presentation: 'modal',
                      title: 'Merge Shows',
                    }}
                  />
                  <Stack.Screen
                    name="player"
                    options={{
                      presentation: 'modal',
                      title: 'Now Playing',
                    }}
                  />
                  <Stack.Screen
                    name="videoplayer"
                    options={{
                      headerShown: false,
                      presentation: 'fullScreenModal',
                      animation: 'fade',
                    }}
                  />
                </Stack.Protected>
                <Stack.Screen name="+not-found" />
              </Stack>
            </FirstTimeSetupProvider>
          </BedtimeProvider>
        </EditModeProvider>
      </ThemeProvider>
    </KeyboardProvider>
  );
}
