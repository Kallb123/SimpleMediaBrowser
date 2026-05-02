const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// React Native 0.79's codegen TypeScript parser (componentsUtils.js) throws
// "Unknown prop type for '<name>': 'undefined'" when a NativeComponent spec
// contains a prop whose type it cannot resolve — here, 'accessibilityContainerViewIsModal'
// in react-native-screens. The prop is an iOS UIAccessibilityContainer concept
// and is not needed for Android. Removing it from every spec file in the
// react-native-screens package unblocks the Gradle codegen task.
function withFixRNScreensCodegen(config) {
  return withDangerousMod(config, [
    'android',
    (config) => {
      const rnScreensRoot = path.join(
        config.modRequest.projectRoot,
        'node_modules',
        'react-native-screens'
      );

      if (!fs.existsSync(rnScreensRoot)) {
        console.warn('[withFixRNScreensCodegen] react-native-screens not found — skipping.');
        return config;
      }

      // Walk all .ts files under node_modules/react-native-screens/src/
      const srcDir = path.join(rnScreensRoot, 'src');
      if (!fs.existsSync(srcDir)) {
        console.warn('[withFixRNScreensCodegen] react-native-screens/src not found — skipping.');
        return config;
      }

      const tsFiles = collectTsFiles(srcDir);
      let patchedCount = 0;

      for (const filePath of tsFiles) {
        let contents = fs.readFileSync(filePath, 'utf-8');
        if (!contents.includes('accessibilityContainerViewIsModal')) {
          continue;
        }
        // Remove the offending prop declaration. The line typically looks like:
        //   accessibilityContainerViewIsModal?: true;
        // or some other type the codegen cannot handle.
        const patched = contents.replace(
          /^[ \t]*accessibilityContainerViewIsModal\?:[^\n]*\n/gm,
          ''
        );
        if (patched !== contents) {
          fs.writeFileSync(filePath, patched, 'utf-8');
          console.log(
            `[withFixRNScreensCodegen] Removed accessibilityContainerViewIsModal from ${path.relative(rnScreensRoot, filePath)}`
          );
          patchedCount++;
        }
      }

      if (patchedCount === 0) {
        console.log('[withFixRNScreensCodegen] accessibilityContainerViewIsModal not found in any spec — no patch needed.');
      }

      return config;
    },
  ]);
}

/** Recursively collect all .ts files under a directory. */
function collectTsFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

module.exports = withFixRNScreensCodegen;
