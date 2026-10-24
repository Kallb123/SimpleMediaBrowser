import { DrawerToggleButton } from '@react-navigation/drawer';
import { Stack } from 'expo-router';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';

/**
 * Native stack for one drawer media section: `index` is the section root and each
 * `folder` push is one level deeper. Screens underneath stay mounted, which is what
 * keeps their scroll position when navigating back.
 */
export function MediaSectionStack() {
  const theme = useColorScheme();
  const drawerToggle = () => <DrawerToggleButton tintColor={Colors[theme].text} />;
  return (
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
  );
}
