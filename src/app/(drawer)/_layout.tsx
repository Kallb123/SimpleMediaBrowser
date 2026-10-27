import { useColorScheme } from "@/hooks/useColorScheme";
import { Drawer } from 'expo-router/drawer';
import { Colors } from '@/constants/Colors';
import { DrawerContentScrollView, DrawerItem, DrawerContentComponentProps } from '@react-navigation/drawer';
import { CommonActions, DrawerActions, StackActions } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEditMode } from '@/contexts/EditModeContext';
import { useBedtime } from '@/contexts/BedtimeContext';
import { useDispatch, useSelector } from 'react-redux';
import { selectPassword, selectMediaSources, selectRescanOnStartup, selectDefaultPage, selectShowSidebarSort, selectSortOrder, setSortOrder } from '@/store/settingsReducer';
import { sortOrderOptions } from '@/constants/sortOrderOptions';
import { Dropdown } from '@/components/Dropdown';
import { useState, useEffect } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { PasswordPromptModal } from '@/components/PasswordPromptModal';
import { logger } from '@/scripts/Logger';
import { initialSection, type BedtimeSection } from '@/utils/bedtime';

/**
 * The media sections shown in the drawer's main list. The order matters: it is the declared
 * screen order, and when the focused screen is removed from the navigator (guarded) the drawer
 * falls back to the first remaining one, so it must match BEDTIME_SECTIONS (firstAllowedSection).
 */
const MEDIA_SECTIONS: readonly { name: BedtimeSection; drawerLabel: string; title: string; separatorBefore?: boolean }[] = [
  { name: '(home)', drawerLabel: '🏠 Library', title: 'Library' },
  { name: 'tv', drawerLabel: '📺 TV', title: 'TV' },
  { name: 'movies', drawerLabel: '🎬 Movies', title: 'Movies' },
  { name: 'audiobooks', drawerLabel: '🎧 Audiobooks', title: 'Audiobooks' },
  // Personal sits apart from the library sections above it (and is not part of the Library page).
  { name: 'personal', drawerLabel: '🎞️ Personal', title: 'Personal', separatorBefore: true },
];

/** What the shared password modal is asking for. */
type PasswordPrompt =
  | { kind: 'unlock' }
  | { kind: 'bedtime'; section: BedtimeSection; title: string };

function CustomDrawerContent(props: DrawerContentComponentProps) {
  const { editMode, setEditMode, drawerUnlocked, setDrawerUnlocked } = useEditMode();
  const { restrictedSections, bedtimeEnd, liftBedtime, recheckBedtime } = useBedtime();
  const settingsPassword = useSelector(selectPassword);
  const reduxDispatch = useDispatch();
  const showSidebarSort = useSelector(selectShowSidebarSort);
  const sortOrder = useSelector(selectSortOrder);
  // The prompt content outlives its visibility so the text doesn't change during the modal's fade-out.
  const [prompt, setPrompt] = useState<PasswordPrompt>({ kind: 'unlock' });
  const [promptVisible, setPromptVisible] = useState(false);
  // A bedtime-locked section the parent just unlocked; we navigate once it is back in the navigator.
  const [pendingSection, setPendingSection] = useState<BedtimeSection | null>(null);
  const colorScheme = useColorScheme() ?? 'light';

  const currentRouteName = props.state.routes[props.state.index]?.name;
  const textColor = Colors[colorScheme].text;
  const separatorColor = colorScheme === 'dark' ? '#444' : '#CCC';

  // Navigating to a guarded route is silently dropped (and not replayed), so after a bedtime
  // unlock wait until the section reappears in the navigator.
  const { routeNames, key: stateKey } = props.state;
  const { dispatch } = props.navigation;
  useEffect(() => {
    if (!pendingSection || !routeNames.includes(pendingSection)) return;
    dispatch({ ...CommonActions.navigate(pendingSection), target: stateKey });
    setPendingSection(null);
  }, [pendingSection, routeNames, stateKey, dispatch]);

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
    // Locking re-arms bedtime if it was lifted. Logs, settings and any newly restricted section
    // then leave the navigator (DrawerLayout's guards), which moves us to the first available section.
    recheckBedtime();
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

  const unlockBedtimeSection = (section: BedtimeSection) => {
    liftBedtime();
    setPendingSection(section);
  };

  const handleRestrictedPress = (section: BedtimeSection, title: string) => {
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
              unlockBedtimeSection(section);
            },
          },
        ],
      );
      return;
    }
    setPrompt({ kind: 'bedtime', section, title });
    setPromptVisible(true);
  };

  const handlePromptSuccess = () => {
    setPromptVisible(false);
    if (prompt.kind === 'unlock') {
      setDrawerUnlocked(true);
    } else {
      unlockBedtimeSection(prompt.section);
    }
  };

  return (
    <DrawerContentScrollView {...props} contentContainerStyle={styles.drawerContent}>
      {MEDIA_SECTIONS.map(({ name, drawerLabel: label, title, separatorBefore }) => {
        const separator = separatorBefore
          ? <View key={`${name}-separator`} style={[styles.drawerSeparator, { backgroundColor: separatorColor }]} />
          : null;
        // Restricted sections are removed from the navigator, so they have no route here.
        const restricted = restrictedSections.has(name);
        if (restricted) {
          return [
            separator,
            <DrawerItem
              key={name}
              label={label}
              onPress={() => handleRestrictedPress(name, title)}
              icon={({ color, size }) => <Ionicons name="bed" color={color} size={size} />}
              labelStyle={styles.restrictedLabel}
              accessibilityLabel={`${title}, locked for bedtime`}
            />,
          ];
        }
        const route = props.state.routes.find((r) => r.name === name);
        if (!route) return null;
        const focused = name === currentRouteName;
        // Each section is a stack of folder levels. Sections other than the current one are
        // always at their root (popToTopOnBlur), so only the current one can be deeper; its
        // entry then shows a back arrow, since tapping it returns to the section root.
        const nestedState = route.state;
        const isDeep = (nestedState?.index ?? 0) > 0;
        const onPress = () => {
          if (isDeep && nestedState?.key) {
            props.navigation.dispatch({ ...StackActions.popToTop(), target: nestedState.key });
          }
          props.navigation.dispatch({
            ...(focused ? DrawerActions.closeDrawer() : CommonActions.navigate(route)),
            target: props.state.key,
          });
        };
        return [
          separator,
          <DrawerItem
            key={route.key}
            label={label}
            focused={focused}
            onPress={onPress}
            icon={isDeep ? ({ color, size }) => <Ionicons name="arrow-back" color={color} size={size} /> : undefined}
            accessibilityLabel={isDeep ? `Back to ${title}` : undefined}
          />,
        ];
      })}

      {showSidebarSort && (
        <View style={styles.sortRow}>
          <Text style={[styles.sortLabel, { color: textColor }]}>Sort by</Text>
          <Dropdown
            options={sortOrderOptions}
            value={sortOrder}
            onChange={(next) => {
              if (next === sortOrder) return;
              logger.log('Drawer', `Sort order changed ${sortOrder} → ${next}`);
              reduxDispatch(setSortOrder(next));
            }}
            buttonStyle={styles.sortButton}
            accessibilityLabel="Sort by"
          />
        </View>
      )}

      <View style={styles.drawerSpacer} />

      <View style={[styles.drawerSeparator, { backgroundColor: separatorColor }]} />

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
    const defaultPage = useSelector(selectDefaultPage);
    const { restrictedSections } = useBedtime();
    const { drawerUnlocked } = useEditMode();

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
    // renders (the root layout awaits it before it renders the navigator), so
    // rescanOnStartup and mediaSources are already up-to-date at this point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
  
    // Guarded screens are removed from the navigator, so they can't be reached or rendered;
    // if one is focused when it becomes guarded, the drawer falls back to the first remaining
    // screen (MEDIA_SECTIONS order). initialRouteName must itself never be guarded or the
    // drawer throws, hence initialSection.
    return (
        <Drawer
          initialRouteName={initialSection(defaultPage, restrictedSections)}
          drawerContent={(props) => <CustomDrawerContent {...props} />}
          screenOptions={{
            headerTintColor: Colors[theme].text,
            headerStyle: { backgroundColor: Colors[theme].background },
        }}>
            {MEDIA_SECTIONS.map(({ name, drawerLabel, title }) => (
              <Drawer.Protected key={name} guard={!restrictedSections.has(name)}>
                <Drawer.Screen name={name} options={{ ...mediaSectionOptions, drawerLabel, title }} />
              </Drawer.Protected>
            ))}
            <Drawer.Protected guard={drawerUnlocked}>
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
            </Drawer.Protected>
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
  sortRow: {
    marginHorizontal: 16,
    marginTop: 8,
    gap: 4,
  },
  sortLabel: {
    fontSize: 13,
    opacity: 0.7,
  },
  sortButton: {
    width: '100%',
    height: 40,
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
