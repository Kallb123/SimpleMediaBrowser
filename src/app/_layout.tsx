import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import 'react-native-reanimated';
import { useColorScheme } from '@/hooks/useColorScheme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StorageKeys } from '@/constants/StorageKeys';
import { Provider } from 'react-redux';
import { store } from '@/store/store';
import { logger } from '@/scripts/Logger';
import { EditModeProvider } from '@/contexts/EditModeContext';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

logger.log('RootLayout', 'App starting up');

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [loaded, setLoaded] = useState(false);
  
  const [fontsLoaded] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

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
    const firstTimeLookup = await AsyncStorage.getItem(StorageKeys.FIRST_TIME_SETUP_KEY);
    console.log("First Time result:", firstTimeLookup);
    logger.log('RootLayout', `First-time setup key value: ${firstTimeLookup}`);
    if (!firstTimeLookup || firstTimeLookup !== "false") {
      logger.log('RootLayout', 'First-time setup not complete – redirecting to /firsttime');
      router.replace("/firsttime");
    } else {
      logger.log('RootLayout', 'First-time setup already complete – proceeding to main app');
    }
    setLoaded(true);
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Provider store={store}>
        <EditModeProvider>
          <Stack>
            <Stack.Screen name="firsttime" options={{ headerShown: false }} />
            <Stack.Screen name="(drawer)" options={{ headerShown: false }} />
            <Stack.Screen name="settings" options={{ headerShown: false }} />
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
          </Stack>
        </EditModeProvider>
      </Provider>
    </ThemeProvider>
  );
}
