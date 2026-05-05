import { useColorScheme } from "@/hooks/useColorScheme";
import { Drawer } from 'expo-router/drawer';
import { router } from 'expo-router';
import { Colors } from '@/constants/Colors';
import { DrawerContentScrollView, DrawerItemList, DrawerItem, DrawerContentComponentProps } from '@react-navigation/drawer';
import { useEditMode } from '@/contexts/EditModeContext';
import { useSelector } from 'react-redux';
import { selectPassword } from '@/store/settingsReducer';
import { useState } from 'react';
import { Modal, StyleSheet, TouchableOpacity, View } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { ThemedTextInput } from '@/components/ThemedTextInput';
import { logger } from '@/scripts/Logger';

const MAIN_ROUTES = ['index', 'tv', 'movies'];

function CustomDrawerContent(props: DrawerContentComponentProps) {
  const { editMode, setEditMode } = useEditMode();
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

  const handleEditModeToggle = () => {
    if (editMode) {
      logger.log('Drawer', 'Edit mode disabled');
      setEditMode(false);
      return;
    }
    if (!settingsPassword) {
      logger.log('Drawer', 'Edit mode enabled (no password set)');
      setEditMode(true);
      return;
    }
    setPasswordInput('');
    setPasswordError('');
    setShowPasswordModal(true);
  };

  const handleSettingsPress = () => {
    if (!settingsPassword) {
      logger.log('Drawer', 'No settings password set – bypassing prompt and opening settings directly');
      props.navigation.closeDrawer();
      router.push('/settings');
    } else {
      props.navigation.navigate('settingsprompt');
    }
  };

  const handleLogsPress = () => {
    props.navigation.navigate('logs');
  };

  const submitPassword = () => {
    if (passwordInput === settingsPassword) {
      logger.log('Drawer', 'Edit mode password accepted – enabling edit mode');
      setEditMode(true);
      setShowPasswordModal(false);
      setPasswordInput('');
      setPasswordError('');
    } else {
      logger.warn('Drawer', 'Edit mode password rejected');
      setPasswordError('Incorrect password.');
    }
  };

  const cancelPassword = () => {
    setShowPasswordModal(false);
    setPasswordInput('');
    setPasswordError('');
  };

  return (
    <DrawerContentScrollView {...props} contentContainerStyle={styles.drawerContent}>
      <DrawerItemList {...mainProps} />

      <View style={styles.drawerSpacer} />

      <View style={[styles.drawerSeparator, { backgroundColor: colorScheme === 'dark' ? '#444' : '#CCC' }]} />

      <DrawerItem
        label="⚙️ Settings"
        onPress={handleSettingsPress}
        focused={currentRouteName === 'settingsprompt'}
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

      {/* Password prompt modal */}
      <Modal
        visible={showPasswordModal}
        transparent
        animationType="fade"
        onRequestClose={cancelPassword}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <ThemedText type="subtitle" style={styles.modalTitle}>Enter Settings Password</ThemedText>
            <ThemedText style={styles.modalSubtitle}>Edit mode requires the settings password.</ThemedText>
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
              <TouchableOpacity onPress={cancelPassword} style={styles.modalButton}>
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
                title: "",
            }}
            />
            <Drawer.Screen
            name="tv"
            options={{
                drawerLabel: '📺 TV',
                title: "",
            }}
            />
            <Drawer.Screen
            name="movies"
            options={{
                drawerLabel: '🎬 Movies',
                title: "",
            }}
            />
            <Drawer.Screen
            name="settingsprompt"
            options={{
                drawerLabel: '⚙️ Settings',
                title: "",
            }}
            />
            <Drawer.Screen
            name="logs"
            options={{
                drawerLabel: '🪲 Debug Logs',
                title: "Debug Logs",
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBox: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 24,
    width: '80%',
    gap: 12,
  },
  modalTitle: {
    textAlign: 'center',
    color: '#11181C',
  },
  modalSubtitle: {
    textAlign: 'center',
    opacity: 0.7,
    color: '#11181C',
  },
  modalInput: {
    color: '#11181C',
    backgroundColor: '#F5F5F5',
    borderColor: '#CCC',
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
    borderColor: '#CCC',
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
