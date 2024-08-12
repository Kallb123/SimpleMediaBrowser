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

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [loaded, setLoaded] = useState(false);
  
  const [fontsLoaded] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  useEffect(() => {
    if (fontsLoaded) {
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
    const firstTimeLookup = await AsyncStorage.getItem(StorageKeys.FIRST_TIME_SETUP_KEY);
    console.log("First Time result:", firstTimeLookup);
    if (!firstTimeLookup || firstTimeLookup !== "false") {
      router.replace("/firsttime");
    }
    setLoaded(true);
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Provider store={store}>
        <Stack>
          <Stack.Screen name="firsttime" options={{ headerShown: false }} />
          <Stack.Screen name="(drawer)" options={{ headerShown: false }} />
          <Stack.Screen name="settings" options={{ headerShown: false }} />
          <Stack.Screen name="+not-found" />
          <Stack.Screen
            name="modal"
            options={{
              // Set the presentation mode to modal for our modal route.
              presentation: 'modal',
            }}
          />
        </Stack>
      </Provider>
    </ThemeProvider>
  );
}
