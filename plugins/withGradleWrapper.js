const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// Expo SDK 55 generates gradle-wrapper.properties with Gradle 9.0.0, whose API JARs
// were compiled with Kotlin 2.2.0 metadata. The @react-native/gradle-plugin composite
// build uses Kotlin 2.0.21 (its libs.versions.toml), and Kotlin 2.0.21 cannot read
// Kotlin 2.2.0 metadata → 30+ "metadata 2.2.0, expected 2.0.0" errors at build time.
//
// Gradle 8.13 is what @react-native/gradle-plugin itself uses (its own
// gradle-wrapper.properties), is compatible with AGP 8.9.x (requires >= 8.11.1),
// and its API JARs have Kotlin 1.9.x metadata which Kotlin 2.0.21 can read.
const GRADLE_VERSION = '8.13';

function withGradleWrapper(config) {
  return withDangerousMod(config, [
    'android',
    (config) => {
      const wrapperPropsPath = path.join(
        config.modRequest.projectRoot,
        'android',
        'gradle',
        'wrapper',
        'gradle-wrapper.properties'
      );

      if (!fs.existsSync(wrapperPropsPath)) {
        console.warn(
          `[withGradleWrapper] gradle-wrapper.properties not found at ${wrapperPropsPath} — Gradle version not patched.`
        );
        return config;
      }

      let contents = fs.readFileSync(wrapperPropsPath, 'utf-8');
      contents = contents.replace(
        /^distributionUrl=.*$/gm,
        `distributionUrl=https\\://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip`
      );
      fs.writeFileSync(wrapperPropsPath, contents, 'utf-8');

      return config;
    },
  ]);
}

module.exports = withGradleWrapper;
