import { useContext, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { DrawerToggleButton } from '@react-navigation/drawer';
import { Stack } from 'expo-router';
import { Colors } from '@/constants/Colors';
import { MiniPlayer, useMiniPlayerVisible } from '@/components/MiniPlayer';
import { useColorScheme } from '@/hooks/useColorScheme';

/**
 * Native stack for one drawer media section: `index` is the section root and each
 * `folder` push is one level deeper. Screens underneath stay mounted, which is what
 * keeps their scroll position when navigating back.
 */
export function MediaSectionStack() {
  const theme = useColorScheme();
  const drawerToggle = () => <DrawerToggleButton tintColor={Colors[theme].text} />;
  const miniPlayerVisible = useMiniPlayerVisible();
  // The mini-player owns the bottom edge while visible, so the screens above it must not pad for it too.
  const outerInsets = useContext(SafeAreaInsetsContext);
  const stackInsets = useMemo(
    () => (miniPlayerVisible && outerInsets ? { ...outerInsets, bottom: 0 } : outerInsets),
    [miniPlayerVisible, outerInsets],
  );
  return (
    <View style={styles.container}>
      <SafeAreaInsetsContext.Provider value={stackInsets}>
        <Stack
          screenOptions={{
            headerTintColor: Colors[theme].text,
            headerStyle: { backgroundColor: Colors[theme].background },
            // Folder levels keep the back arrow on the left, so the drawer button moves right.
            // Edge-swiping the drawer open isn't reliable with Android gesture navigation.
            headerRight: drawerToggle,
            // Covered levels skip re-rendering on every Redux update (e.g. scan progress)
            // until they are revealed again.
            freezeOnBlur: true,
          }}
        >
          <Stack.Screen name="index" options={{ headerLeft: drawerToggle, headerRight: undefined }} />
        </Stack>
      </SafeAreaInsetsContext.Provider>
      <MiniPlayer />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
