const { withProjectBuildGradle, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// androidx.core:core:1.17.0 (pulled in transitively by RN 0.79) requires:
//   - Android Gradle Plugin ≥ 8.9.1
//   - compileSdk ≥ 36
//
// This plugin upgrades the AGP classpath declaration in android/build.gradle
// from the Expo SDK 55 default of 8.8.2 to 8.9.1, and also patches
// settings.gradle in the rare case the version is declared there via the
// plugins {} block.
//
// AGP 8.9.x requires Gradle ≥ 8.10.2; Gradle 8.13 satisfies this and is
// already enforced by withGradleWrapper.js.
//
// compileSdk 36 is set separately via expo-build-properties in app.json.
const AGP_VERSION = '8.9.1';

function withAndroidBuildTools(config) {
  // Patch classpath("com.android.tools.build:gradle:x.y.z") in android/build.gradle
  config = withProjectBuildGradle(config, (gradleConfig) => {
    const original = gradleConfig.modResults.contents;
    const patched = original.replace(
      /classpath\("com\.android\.tools\.build:gradle:[^"]+"\)/,
      `classpath("com.android.tools.build:gradle:${AGP_VERSION}")`
    );
    if (patched !== original) {
      console.log(`[withAndroidBuildTools] Patched AGP classpath to ${AGP_VERSION} in build.gradle`);
    } else {
      console.warn('[withAndroidBuildTools] AGP classpath not found in build.gradle — version not patched.');
    }
    gradleConfig.modResults.contents = patched;
    return gradleConfig;
  });

  // Also patch settings.gradle where some project templates declare the AGP
  // plugin version via: id("com.android.application") version "x.y.z" apply false
  config = withDangerousMod(config, [
    'android',
    (config) => {
      const settingsPath = path.join(
        config.modRequest.projectRoot,
        'android',
        'settings.gradle'
      );
      if (!fs.existsSync(settingsPath)) return config;

      let contents = fs.readFileSync(settingsPath, 'utf-8');
      const patched = contents.replace(
        /id\("com\.android\.application"\)\s+version\s+"[^"]+"/,
        `id("com.android.application") version "${AGP_VERSION}"`
      );
      if (patched !== contents) {
        fs.writeFileSync(settingsPath, patched, 'utf-8');
        console.log(`[withAndroidBuildTools] Patched AGP version in settings.gradle to ${AGP_VERSION}`);
      }
      return config;
    },
  ]);

  return config;
}

module.exports = withAndroidBuildTools;
