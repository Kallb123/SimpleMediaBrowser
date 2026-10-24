// App entry ("main" in package.json). Mounts App.tsx, which hands expo-router
// the src/app route tree directly. Release builds have always started this way
// (the EAS workflow used to swap "main" to expo/AppEntry.js, which does the same).
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
