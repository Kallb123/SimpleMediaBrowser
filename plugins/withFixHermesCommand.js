const { withAppBuildGradle } = require('@expo/config-plugins');

// React Native 0.79+ no longer ships a 'hermes-compiler' npm package.
// The Expo SDK 55 template generates a hermesCommand line in android/app/build.gradle
// that calls: require.resolve('hermes-compiler/package.json', ...) via node.
// Since the package doesn't exist, node exits with an error, the command's stdout
// is empty, new File("").getParentFile() returns null, and getAbsolutePath() on null
// throws: "Cannot invoke method getAbsolutePath() on null object" (build.gradle line 14).
//
// Removing the hermesCommand override lets @react-native/gradle-plugin use its own
// hermesc detection logic, which correctly finds hermesc at
// node_modules/react-native/sdks/hermesc/<platform>-bin/hermesc.
function withFixHermesCommand(config) {
  return withAppBuildGradle(config, (gradleConfig) => {
    gradleConfig.modResults.contents = gradleConfig.modResults.contents.replace(
      /[ \t]*hermesCommand\s*=\s*new File\(.*hermes-compiler.*\r?\n/,
      ''
    );
    return gradleConfig;
  });
}

module.exports = withFixHermesCommand;
