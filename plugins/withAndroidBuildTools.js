const { withProjectBuildGradle, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// androidx.core:core:1.17.0 (pulled in transitively by RN 0.79) requires:
//   - Android Gradle Plugin ≥ 8.9.1
//   - compileSdk ≥ 36
//
// In the Expo SDK 55 / RN 0.79 project structure, the AGP version is NOT
// declared in android/build.gradle with an explicit version string.  Instead
// it is resolved transitively through the @react-native/gradle-plugin composite
// build, whose own version catalog (@react-native/gradle-plugin/gradle/
// libs.versions.toml) pins agp = "8.8.2".
//
// This plugin upgrades that catalog entry from 8.8.2 → 8.9.1 so that Gradle
// picks up AGP 8.9.1 when it resolves the buildscript classpath.  It also
// retains fall-back patches for older template formats that declare the version
// inline in build.gradle or settings.gradle.
//
// AGP 8.9.x requires Gradle ≥ 8.10.2; Gradle 8.13 satisfies this and is
// already enforced by withGradleWrapper.js.
//
// compileSdk 36 is set separately via expo-build-properties in app.json.
const AGP_VERSION = '8.9.1';

function withAndroidBuildTools(config) {
  // Primary fix: patch agp = "x.y.z" in @react-native/gradle-plugin's own
  // libs.versions.toml.  This is the version that actually governs AGP
  // resolution in the composite-build / no-version-in-build.gradle setup used
  // by Expo SDK 55 / RN 0.79.
  config = withDangerousMod(config, [
    'android',
    (config) => {
      const rngpToml = path.join(
        config.modRequest.projectRoot,
        'node_modules',
        '@react-native',
        'gradle-plugin',
        'gradle',
        'libs.versions.toml'
      );
      if (!fs.existsSync(rngpToml)) return config;

      const original = fs.readFileSync(rngpToml, 'utf-8');
      const patched = original.replace(/^agp\s*=\s*"[^"]+"/m, `agp = "${AGP_VERSION}"`);
      if (patched !== original) {
        fs.writeFileSync(rngpToml, patched, 'utf-8');
        console.log(`[withAndroidBuildTools] Patched AGP to ${AGP_VERSION} in @react-native/gradle-plugin/gradle/libs.versions.toml`);
      }
      return config;
    },
  ]);

  // Fall-back: patch classpath("com.android.tools.build:gradle:x.y.z") in
  // android/build.gradle for older template formats that include an explicit
  // version in the classpath declaration.
  config = withProjectBuildGradle(config, (gradleConfig) => {
    const original = gradleConfig.modResults.contents;
    const patched = original.replace(
      /classpath\("com\.android\.tools\.build:gradle:[^"]+"\)/,
      `classpath("com.android.tools.build:gradle:${AGP_VERSION}")`
    );
    if (patched !== original) {
      console.log(`[withAndroidBuildTools] Patched AGP classpath to ${AGP_VERSION} in build.gradle`);
    }
    gradleConfig.modResults.contents = patched;
    return gradleConfig;
  });

  // Fall-back: patch settings.gradle where some project templates declare the
  // AGP plugin version via: id("com.android.application") version "x.y.z" apply false
  config = withDangerousMod(config, [
    'android',
    (config) => {
      const settingsPath = path.join(
        config.modRequest.projectRoot,
        'android',
        'settings.gradle'
      );
      if (!fs.existsSync(settingsPath)) return config;

      const original = fs.readFileSync(settingsPath, 'utf-8');
      const patched = original.replace(
        /id\("com\.android\.application"\)\s+version\s+"[^"]+"/,
        `id("com.android.application") version "${AGP_VERSION}"`
      );
      if (patched !== original) {
        fs.writeFileSync(settingsPath, patched, 'utf-8');
        console.log(`[withAndroidBuildTools] Patched AGP version in settings.gradle to ${AGP_VERSION}`);
      }
      return config;
    },
  ]);

  return config;
}

module.exports = withAndroidBuildTools;
