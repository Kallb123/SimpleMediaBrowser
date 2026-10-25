import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, router } from 'expo-router';
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
import {
  selectAppColorScheme,
  selectBedtimeAllowedTypes,
  selectBedtimeEnabled,
  selectBedtimeEnd,
  selectBedtimeStart,
} from '@/store/settingsReducer';
import { bedtimeRestrictedSections, firstAllowedSection, isWithinBedtime, type BedtimeSection } from '@/utils/bedtime';

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

  const [loaded, setLoaded] = useState(false);

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
      if (loaded) {
        SplashScreen.hideAsync();
        return;
      }
      firstTimeSetupCheck();
    }
  }, [fontsLoaded, loaded]);

  if (!fontsLoaded) {
    return null;
  }

  const firstTimeSetupCheck = async () => {
    logger.log('RootLayout', 'Checking first-time setup key');
    // Wait for redux-persist to finish rehydrating so defaultPage is available
    await waitForPersistBootstrap();
    // Load (or migrate) the library before routing: the drawer's startup scan
    // carries metadata over from the existing library. Never rejects.
    await startLibraryPersistence();
    const firstTimeLookup = await AsyncStorage.getItem(StorageKeys.FIRST_TIME_SETUP_KEY);
    console.log("First Time result:", firstTimeLookup);
    logger.log('RootLayout', `First-time setup key value: ${firstTimeLookup}`);
    if (!firstTimeLookup || firstTimeLookup !== "false") {
      logger.log('RootLayout', 'First-time setup not complete – redirecting to /firsttime');
      router.replace("/firsttime");
    } else {
      const storeState = store.getState() as { settingsReducer?: { defaultPage?: string } };
      const defaultPage = storeState.settingsReducer?.defaultPage ?? 'home';
      let section: BedtimeSection = defaultPage === 'tv'
        ? 'tv'
        : defaultPage === 'movies'
          ? 'movies'
          : defaultPage === 'audiobooks'
            ? 'audiobooks'
            : '(home)';
      // Bedtime mode: avoid a flash of a restricted default page. The drawer's guard is the safety net.
      const state = store.getState();
      if (selectBedtimeEnabled(state) && isWithinBedtime(new Date(), selectBedtimeStart(state), selectBedtimeEnd(state))) {
        const restricted = bedtimeRestrictedSections(selectBedtimeAllowedTypes(state));
        const fallback = firstAllowedSection(restricted);
        if (restricted.has(section) && fallback) {
          logger.log('Bedtime', `Default page ${section} is restricted at startup – routing to ${fallback} instead`);
          section = fallback;
        }
      }
      const route = `/(drawer)/${section}` as const;
      logger.log('RootLayout', `First-time setup already complete – redirecting to ${route}`);
      router.replace(route);
    }
    setLoaded(true);
  }

  return (
    <KeyboardProvider>
      <ThemeProvider value={effectiveScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <StatusBar style={effectiveScheme === 'dark' ? 'light' : 'dark'} />
        <EditModeProvider>
          <BedtimeProvider>
            <Stack>
              <Stack.Screen name="firsttime" options={{ headerShown: false }} />
              <Stack.Screen name="(drawer)" options={{ headerShown: false }} />
              <Stack.Screen name="+not-found" />
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
            </Stack>
          </BedtimeProvider>
        </EditModeProvider>
      </ThemeProvider>
    </KeyboardProvider>
  );
}
