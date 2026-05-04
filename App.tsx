import { ExpoRoot } from 'expo-router';

export default function App() {
  const ctx = require.context('./src/app');
  return <ExpoRoot context={ctx} />;
}
