import { useColorScheme } from "@/hooks/useColorScheme";
import { Drawer } from 'expo-router/drawer';
import { Colors } from '@/constants/Colors';
import { DrawerContentScrollView, DrawerItemList, DrawerItem, DrawerContentComponentProps } from '@react-navigation/drawer';
import { useEditMode } from '@/contexts/EditModeContext';
import { useSelector } from 'react-redux';
import { selectPassword, selectMediaSources, selectRescanOnStartup } from '@/store/settingsReducer';
import { useState, useEffect } from 'react';
import { Modal, StyleSheet, TouchableOpacity, View } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { ThemedTextInput } from '@/components/ThemedTextInput';
import { logger } from '@/scripts/Logger';

const MAIN_ROUTES = ['index', 'tv', 'movies'];

function CustomDrawerContent(props: DrawerContentComponentProps) {
  const { editMode, setEditMode, drawerUnlocked, setDrawerUnlocked } = useEditMode();
  const settingsPassword = useSelector(selectPassword);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const colorScheme = useColorScheme() ?? 'light';

  const currentRouteName = props.state.routes[props.state.index]?.name;

  // Only show Home, TV, Movies in the main list; adjust index to match filtered routes
  const mainRoutes = props.state.routes.filter(r => MAIN_ROUTES.includes(r.name));
  const mainIndex = mainRoutes.findIndex(r => r.name === currentRouteName);
  const mainProps = {
    ...props,
    state: {
      ...props.state,
      routes: mainRoutes,
      index: mainIndex >= 0 ? mainIndex : 0,
    },
  };

  const resetPasswordModal = () => {
    setShowPasswordModal(false);
    setPasswordInput('');
    setPasswordError('');
  };

  const handleUnlockPress = () => {
    if (!settingsPassword) {
      logger.log('Drawer', 'Drawer unlocked (no password set)');
      setDrawerUnlocked(true);
      return;
    }
    setPasswordInput('');
    setPasswordError('');
    setShowPasswordModal(true);
  };

  const handleLockPress = () => {
    logger.log('Drawer', 'Drawer locked by user');
    setDrawerUnlocked(false);
    setEditMode(false);
    resetPasswordModal();
    if (currentRouteName === 'logs') {
      props.navigation.navigate('index');
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

  const submitPassword = () => {
    if (passwordInput === settingsPassword) {
      logger.log('Drawer', 'Drawer password accepted – unlocked protected actions');
      setDrawerUnlocked(true);
      resetPasswordModal();
    } else {
      logger.warn('Drawer', 'Drawer password rejected');
      setPasswordError('Incorrect password.');
    }
  };

  const cancelPassword = () => {
    resetPasswordModal();
  };

  return (
    <DrawerContentScrollView {...props} contentContainerStyle={styles.drawerContent}>
      <DrawerItemList {...mainProps} />

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

      {/* Password prompt modal */}
      <Modal
        visible={showPasswordModal}
        transparent
        animationType="fade"
        onRequestClose={cancelPassword}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: colorScheme === 'dark' ? '#1E2022' : '#fff' }]}>
            <ThemedText type="subtitle" style={styles.modalTitle}>Enter Settings Password</ThemedText>
            <ThemedText style={styles.modalSubtitle}>Unlock protected app actions</ThemedText>
            <ThemedTextInput
              value={passwordInput}
              onChangeText={(v) => {
                setPasswordInput(v);
                setPasswordError('');
              }}
              placeholder="Password"
              secureTextEntry
              style={styles.modalInput}
              autoFocus
              onSubmitEditing={submitPassword}
            />
            {passwordError !== '' && (
              <ThemedText style={styles.errorText}>{passwordError}</ThemedText>
            )}
            <View style={styles.modalButtons}>
              <TouchableOpacity onPress={cancelPassword} style={[styles.modalButton, { borderColor: colorScheme === 'dark' ? '#555' : '#CCC' }]}>
                <ThemedText>Cancel</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity onPress={submitPassword} style={[styles.modalButton, styles.modalButtonPrimary]}>
                <ThemedText style={styles.modalButtonPrimaryText}>Unlock</ThemedText>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </DrawerContentScrollView>
  );
}

export default function DrawerLayout() {
    const colorScheme = useColorScheme();
    const theme = (colorScheme ?? 'light') as 'light' | 'dark';
    const mediaSources = useSelector(selectMediaSources);
    const rescanOnStartup = useSelector(selectRescanOnStartup);

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
            name="index"
            options={{
                drawerLabel: '🏠 Home',
                title: "Home",
            }}
            />
            <Drawer.Screen
            name="tv"
            options={{
                drawerLabel: '📺 TV',
                title: "TV",
            }}
            />
            <Drawer.Screen
            name="movies"
            options={{
                drawerLabel: '🎬 Movies',
                title: "Movies",
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
  unlockLabel: {
    color: '#0a7ea4',
    fontWeight: '700',
  },
  lockLabel: {
    color: '#E55',
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBox: {
    borderRadius: 12,
    padding: 24,
    width: '80%',
    gap: 12,
  },
  modalTitle: {
    textAlign: 'center',
  },
  modalSubtitle: {
    textAlign: 'center',
    opacity: 0.7,
  },
  modalInput: {
    paddingVertical: 12,
  },
  errorText: {
    color: '#E55',
    fontSize: 13,
    textAlign: 'center',
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  modalButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  modalButtonPrimary: {
    backgroundColor: '#0a7ea4',
    borderColor: '#0a7ea4',
  },
  modalButtonPrimaryText: {
    color: '#fff',
    fontWeight: '600',
  },
});
