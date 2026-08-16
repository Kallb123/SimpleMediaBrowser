import { View, StyleSheet } from 'react-native';

// Root route rendered for a single frame while RootLayout's firstTimeSetupCheck
// decides whether to redirect to /firsttime or /(drawer). Kept visually blank
// (matching the native splash background) rather than the old Expo template
// content, which used to flash before the redirect landed.
export default function HomeScreen() {
  return <View style={styles.container} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#EC3013',
  },
});
