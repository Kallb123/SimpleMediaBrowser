const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// React Native 0.79's codegen TypeScript parser (componentsUtils.js) throws
// "Unknown prop type for '<name>': 'undefined'" when a NativeComponent spec
// contains a prop whose type it cannot resolve. Two known issues in
// react-native-screens are patched here:
//
// 1. 'accessibilityContainerViewIsModal' in various spec files — an iOS
//    UIAccessibilityContainer concept not needed for Android. The prop is
//    removed from every affected .ts file.
//
// 2. src/fabric/gamma/ — SplitViewHostNativeComponent.ts and
//    SplitViewScreenNativeComponent.ts use locally-defined TypeScript union
//    types wrapped in CT.WithDefault<> which the codegen cannot resolve
//    (e.g. 'preferredDisplayMode'). The entire gamma directory is deleted
//    from the codegen source tree so those specs are never processed.
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

      // --- Fix 1: remove accessibilityContainerViewIsModal from spec files ---
      const srcDir = path.join(rnScreensRoot, 'src');
      if (!fs.existsSync(srcDir)) {
        console.warn('[withFixRNScreensCodegen] react-native-screens/src not found — skipping prop patch.');
      } else {
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
      }

      // --- Fix 2: delete src/fabric/gamma/ so codegen never sees it ---
      const gammaDir = path.join(rnScreensRoot, 'src', 'fabric', 'gamma');
      if (fs.existsSync(gammaDir)) {
        fs.rmSync(gammaDir, { recursive: true, force: true });
        console.log('[withFixRNScreensCodegen] Deleted src/fabric/gamma/ to prevent CT.WithDefault<LocalUnion> codegen errors.');
      } else {
        console.log('[withFixRNScreensCodegen] src/fabric/gamma/ not found — no gamma patch needed.');
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
