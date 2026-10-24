import { useColorScheme } from "@/hooks/useColorScheme";
import { Drawer } from 'expo-router/drawer';
import { router, useSegments } from 'expo-router';
import { Colors } from '@/constants/Colors';
import { DrawerContentScrollView, DrawerItem, DrawerContentComponentProps } from '@react-navigation/drawer';
import { CommonActions, DrawerActions, StackActions } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEditMode } from '@/contexts/EditModeContext';
import { useBedtime } from '@/contexts/BedtimeContext';
import { useSelector } from 'react-redux';
import { selectPassword, selectMediaSources, selectRescanOnStartup } from '@/store/settingsReducer';
import { useState, useEffect } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { PasswordPromptModal } from '@/components/PasswordPromptModal';
import { logger } from '@/scripts/Logger';
import { BEDTIME_SECTIONS, firstAllowedSection, type BedtimeSection } from '@/utils/bedtime';

const MAIN_ROUTES: string[] = [...BEDTIME_SECTIONS];

type DrawerRoute = DrawerContentComponentProps['state']['routes'][number];

/** What the shared password modal is asking for. */
type PasswordPrompt =
  | { kind: 'unlock' }
  | { kind: 'bedtime'; route: DrawerRoute; title: string };

function isBedtimeSection(name: string | undefined): name is BedtimeSection {
  return BEDTIME_SECTIONS.some((s) => s === name);
}

function CustomDrawerContent(props: DrawerContentComponentProps) {
  const { editMode, setEditMode, drawerUnlocked, setDrawerUnlocked } = useEditMode();
  const { restrictedSections, bedtimeEnd, liftBedtime, recheckBedtime } = useBedtime();
  const settingsPassword = useSelector(selectPassword);
  // The prompt content outlives its visibility so the text doesn't change during the modal's fade-out.
  const [prompt, setPrompt] = useState<PasswordPrompt>({ kind: 'unlock' });
  const [promptVisible, setPromptVisible] = useState(false);
  const colorScheme = useColorScheme() ?? 'light';

  const currentRouteName = props.state.routes[props.state.index]?.name;

  // Only the media sections go in the main list; the rest are behind the parent-mode unlock.
  const mainRoutes = props.state.routes.filter(r => MAIN_ROUTES.includes(r.name));

  const handleUnlockPress = () => {
    if (!settingsPassword) {
      logger.log('Drawer', 'Drawer unlocked (no password set)');
      setDrawerUnlocked(true);
      return;
    }
    setPrompt({ kind: 'unlock' });
    setPromptVisible(true);
  };

  const handleLockPress = () => {
    logger.log('Drawer', 'Drawer locked by user');
    setDrawerUnlocked(false);
    setEditMode(false);
    setPromptVisible(false);
    // Locking re-arms bedtime if it was lifted; DrawerLayout's guard then moves us off a restricted section.
    recheckBedtime();
    if (currentRouteName === 'logs') {
      props.navigation.navigate('(home)');
    }
  };

  const handleEditModeToggle = () => {
    if (editMode) {
      logger.log('Drawer', 'Edit mode disabled');
      setEditMode(false);
      return;
    }
    logger.log('Drawer', 'Edit mode enabled');
    setEditMode(true);
  };

  const handleSettingsPress = () => {
    props.navigation.closeDrawer();
    props.navigation.navigate('settings');
  };

  const handleLogsPress = () => {
    props.navigation.navigate('logs');
  };

  const navigateToRoute = (route: DrawerRoute) => {
    props.navigation.dispatch({
      ...CommonActions.navigate(route),
      target: props.state.key,
    });
  };

  const unlockBedtimeSection = (route: DrawerRoute) => {
    liftBedtime();
    navigateToRoute(route);
  };

  const handleRestrictedPress = (route: DrawerRoute, title: string) => {
    if (!settingsPassword) {
      Alert.alert(
        `${title} is locked`,
        `Locked for bedtime until ${bedtimeEnd}. No settings password is set, so anyone can unlock it.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Unlock',
            onPress: () => {
              logger.log('Bedtime', `${title} unlocked for bedtime (no password set)`);
              unlockBedtimeSection(route);
            },
          },
        ],
      );
      return;
    }
    setPrompt({ kind: 'bedtime', route, title });
    setPromptVisible(true);
  };

  const handlePromptSuccess = () => {
    setPromptVisible(false);
    if (prompt.kind === 'unlock') {
      setDrawerUnlocked(true);
    } else {
      unlockBedtimeSection(prompt.route);
    }
  };

  return (
    <DrawerContentScrollView {...props} contentContainerStyle={styles.drawerContent}>
      {mainRoutes.map((route) => {
        const focused = route.name === currentRouteName;
        const { drawerLabel, title } = props.descriptors[route.key].options;
        const label = typeof drawerLabel === 'string' ? drawerLabel : (title ?? route.name);
        const restricted = isBedtimeSection(route.name) && restrictedSections.has(route.name);
        // Each section is a stack of folder levels. Sections other than the current one are
        // always at their root (popToTopOnBlur), so only the current one can be deeper; its
        // entry then shows a back arrow, since tapping it returns to the section root.
        const nestedState = route.state;
        const isDeep = (nestedState?.index ?? 0) > 0;
        const onPress = () => {
          if (restricted) {
            handleRestrictedPress(route, title ?? route.name);
            return;
          }
          if (isDeep && nestedState?.key) {
            props.navigation.dispatch({ ...StackActions.popToTop(), target: nestedState.key });
          }
          props.navigation.dispatch({
            ...(focused ? DrawerActions.closeDrawer() : CommonActions.navigate(route)),
            target: props.state.key,
          });
        };
        return (
          <DrawerItem
            key={route.key}
            label={label}
            focused={focused}
            onPress={onPress}
            icon={restricted
              ? ({ color, size }) => <Ionicons name="bed" color={color} size={size} />
              : isDeep ? ({ color, size }) => <Ionicons name="arrow-back" color={color} size={size} /> : undefined}
            labelStyle={restricted ? styles.restrictedLabel : undefined}
            accessibilityLabel={restricted
              ? `${title ?? label}, locked for bedtime`
              : isDeep ? `Back to ${title ?? label}` : undefined}
          />
        );
      })}

      <View style={styles.drawerSpacer} />

      <View style={[styles.drawerSeparator, { backgroundColor: colorScheme === 'dark' ? '#444' : '#CCC' }]} />

      {drawerUnlocked ? (
        <>
          <DrawerItem
            label="⚙️ Settings"
            onPress={handleSettingsPress}
          />
          <DrawerItem
            label="🪲 Debug Logs"
            onPress={handleLogsPress}
            focused={currentRouteName === 'logs'}
          />
          <DrawerItem
            label={editMode ? '✏️ Exit Edit Mode' : '✏️ Enter Edit Mode'}
            onPress={handleEditModeToggle}
            labelStyle={editMode ? styles.editModeActiveLabel : undefined}
          />
          <DrawerItem
            label="🔒 Lock"
            onPress={handleLockPress}
            labelStyle={styles.lockLabel}
          />
        </>
      ) : (
        <DrawerItem
          label="🔓 Unlock"
          onPress={handleUnlockPress}
          labelStyle={styles.unlockLabel}
        />
      )}

      <PasswordPromptModal
        visible={promptVisible}
        title={prompt.kind === 'bedtime' ? 'Bedtime' : 'Enter Settings Password'}
        subtitle={prompt.kind === 'bedtime'
          ? `${prompt.title} is locked until ${bedtimeEnd}. Enter the settings password to unlock.`
          : 'Unlock protected app actions'}
        onSuccess={handlePromptSuccess}
        onCancel={() => setPromptVisible(false)}
      />
    </DrawerContentScrollView>
  );
}

export default function DrawerLayout() {
    const colorScheme = useColorScheme();
    const theme = (colorScheme ?? 'light') as 'light' | 'dark';
    const mediaSources = useSelector(selectMediaSources);
    const rescanOnStartup = useSelector(selectRescanOnStartup);
    const { restrictedSections } = useBedtime();
    // Cast: the typed-routes segment union doesn't include arbitrary section names.
    const segments = useSegments() as string[];
    const currentSection = segments[0] === '(drawer)' ? segments[1] : undefined;

    // Bedtime guard: whenever the visible media section becomes restricted (foreground entry
    // check, the Lock button, or the clock passing the bedtime start), move to an allowed one.
    // The target is never restricted, so this cannot loop.
    useEffect(() => {
      if (!isBedtimeSection(currentSection) || !restrictedSections.has(currentSection)) return;
      const target = firstAllowedSection(restrictedSections);
      if (!target) {
        logger.warn('Bedtime', `${currentSection} is restricted but no section is allowed – not redirecting`);
        return;
      }
      logger.log('Bedtime', `${currentSection} is locked for bedtime – redirecting to ${target}`);
      router.replace(target === '(home)' ? '/(drawer)/(home)' : `/(drawer)/${target}`);
    }, [currentSection, restrictedSections]);

    useEffect(() => {
      if (!rescanOnStartup) {
        logger.log('DrawerLayout', 'Rescan on startup is disabled – skipping startup scan');
        return;
      }
      if (!mediaSources || mediaSources.length === 0) {
        logger.log('DrawerLayout', 'No media sources configured – skipping startup scan');
        return;
      }
      logger.log('DrawerLayout', `Startup scan triggered for ${mediaSources.length} source(s)`);
      import('@/scripts/FileScanner').then(({ FileScanner }) => {
        FileScanner.getInstance().scanAllSources(mediaSources);
      }).catch((e: Error) => {
        logger.error('DrawerLayout', 'Exception during startup scan', e);
      });
    // Empty dependency array is intentional: this effect should fire only once on
    // mount (startup). redux-persist rehydration completes before the drawer layout
    // renders (guaranteed by the await in _layout.tsx's firstTimeSetupCheck), so
    // rescanOnStartup and mediaSources are already up-to-date at this point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
  
    return (
        <Drawer
          drawerContent={(props) => <CustomDrawerContent {...props} />}
          screenOptions={{
            headerTintColor: Colors[theme].text,
            headerStyle: { backgroundColor: Colors[theme].background },
        }}>
            <Drawer.Screen
            name="(home)"
            options={{
                ...mediaSectionOptions,
                drawerLabel: '🏠 Home',
                title: "Home",
            }}
            />
            <Drawer.Screen
            name="tv"
            options={{
                ...mediaSectionOptions,
                drawerLabel: '📺 TV',
                title: "TV",
            }}
            />
            <Drawer.Screen
            name="movies"
            options={{
                ...mediaSectionOptions,
                drawerLabel: '🎬 Movies',
                title: "Movies",
            }}
            />
            <Drawer.Screen
            name="audiobooks"
            options={{
                ...mediaSectionOptions,
                drawerLabel: '🎧 Audiobooks',
                title: "Audiobooks",
            }}
            />
            <Drawer.Screen
            name="logs"
            options={{
                drawerLabel: '🪲 Debug Logs',
                title: "Debug Logs",
            }}
            />
            <Drawer.Screen
            name="settings"
            options={{
                drawerLabel: '⚙️ Settings',
                title: "Settings",
                drawerItemStyle: { display: 'none' },
            }}
            />
        </Drawer>
    );
}

/** Options shared by the media sections, each of which is a nested stack (see MediaSectionStack). */
const mediaSectionOptions = {
  // The section's stack draws its own header (with the back arrow on folder levels).
  headerShown: false,
  // Leaving a section resets it to its root, so it is always entered at the top level.
  popToTopOnBlur: true,
  // Sections stay mounted once visited; without freezing, every visited section
  // rebuilds its item list on each library update (e.g. every scan progress tick).
  freezeOnBlur: true,
};

const styles = StyleSheet.create({
  drawerContent: {
    flexGrow: 1,
  },
  drawerSpacer: {
    flex: 1,
  },
  drawerSeparator: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 16,
    marginVertical: 8,
  },
  editModeActiveLabel: {
    color: '#E55',
    fontWeight: '700',
  },
  restrictedLabel: {
    opacity: 0.6,
  },
  unlockLabel: {
    color: '#0a7ea4',
    fontWeight: '700',
  },
  lockLabel: {
    color: '#E55',
    fontWeight: '700',
  },
});
