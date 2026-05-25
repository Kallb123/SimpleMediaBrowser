import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { useColorScheme as useNativeColorScheme } from 'react-native';
import 'react-native-reanimated';
import '@/global.css';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StorageKeys } from '@/constants/StorageKeys';
import { Provider, useSelector } from 'react-redux';
import { store, persistor } from '@/store/store';
import { logger } from '@/scripts/Logger';
import { EditModeProvider } from '@/contexts/EditModeContext';
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
    await new Promise<void>((resolve) => {
      if (persistor.getState().bootstrapped) {
        resolve();
        return;
      }
      const unsubscribe = persistor.subscribe(() => {
        if (persistor.getState().bootstrapped) {
          unsubscribe();
          resolve();
        }
      });
    });
    const firstTimeLookup = await AsyncStorage.getItem(StorageKeys.FIRST_TIME_SETUP_KEY);
    console.log("First Time result:", firstTimeLookup);
    logger.log('RootLayout', `First-time setup key value: ${firstTimeLookup}`);
    if (!firstTimeLookup || firstTimeLookup !== "false") {
      logger.log('RootLayout', 'First-time setup not complete – redirecting to /firsttime');
      router.replace("/firsttime");
    } else {
      const storeState = store.getState() as { settingsReducer?: { defaultPage?: string } };
      const defaultPage = storeState.settingsReducer?.defaultPage ?? 'home';
      const route = defaultPage === 'tv'
        ? '/(drawer)/tv'
        : defaultPage === 'movies'
          ? '/(drawer)/movies'
          : '/(drawer)';
      logger.log('RootLayout', `First-time setup already complete – redirecting to ${route}`);
      router.replace(route);
    }
    setLoaded(true);
  }

  return (
    <ThemeProvider value={effectiveScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <StatusBar style={effectiveScheme === 'dark' ? 'light' : 'dark'} />
      <EditModeProvider>
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
        </Stack>
      </EditModeProvider>
    </ThemeProvider>
  );
}
