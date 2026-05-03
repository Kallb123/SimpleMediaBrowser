const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Patches react-native-scoped-storage's android/build.gradle to replace the
 * removed jcenter() repository with mavenCentral(). Gradle 7+ removed jcenter()
 * support, causing: "Could not find method jcenter() for arguments []".
 */
const withScopedStorageFix = (config) => {
  return withDangerousMod(config, [
    'android',
    (config) => {
      const buildGradlePath = path.join(
        config.modRequest.projectRoot,
        'node_modules',
        'react-native-scoped-storage',
        'android',
        'build.gradle'
      );

      if (!fs.existsSync(buildGradlePath)) {
        console.warn(
          '[withScopedStorageFix] react-native-scoped-storage build.gradle not found, skipping patch.'
        );
        return config;
      }

      let contents = fs.readFileSync(buildGradlePath, 'utf8');

      // Guard is sufficient for idempotency: after the first run jcenter() is
      // gone so subsequent prebuild runs return here without re-patching.
      if (!contents.includes('jcenter()')) {
        console.log('[withScopedStorageFix] jcenter() not found, no patch needed.');
        return config;
      }

      // Use a word-boundary regex so only repository declarations are matched,
      // not occurrences inside comments or string literals that happen to
      // contain the substring.
      contents = contents.replace(/\bjcenter\(\)/g, 'mavenCentral()');
      fs.writeFileSync(buildGradlePath, contents, 'utf8');
      console.log('[withScopedStorageFix] Replaced jcenter() with mavenCentral() in react-native-scoped-storage/android/build.gradle');

      return config;
    },
  ]);
};

module.exports = withScopedStorageFix;
