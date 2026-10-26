import { View, StyleSheet } from 'react-native';

// The startup URL "/" resolves to this route. RootLayout guards it off
// (Stack.Protected guard={false}) so the stack opens on whichever screen the
// first-time guards allow, which means this is never actually shown. Kept as a
// trivial blank route (matching the native splash background) just so "/" has a
// root route to resolve to.
export default function HomeScreen() {
  return <View style={styles.container} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#EC3013',
  },
});
