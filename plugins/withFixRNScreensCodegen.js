const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// React Native 0.79's codegen TypeScript parser (componentsUtils.js) throws
// "Unknown prop type for '<name>': 'undefined'" whenever a NativeComponent spec
// file uses a TypeScript qualified name (CT.X, where CT is an imported alias for
// CodegenTypes) as a prop type.  The parser only recognises bare identifiers such
// as WithDefault, DirectEventHandler, Int32, Float, Double — not CT.WithDefault,
// CT.DirectEventHandler, etc. — because it resolves typeName.name which is
// undefined for a TSQualifiedName node.
//
// react-native-screens 4.24.0 introduced this pattern widely across its fabric
// spec files.  This plugin applies three categories of fix during prebuild:
//
// Fix 1 – remove accessibilityContainerViewIsModal prop
//   The prop appears in several spec files (e.g. FullWindowOverlayNativeComponent)
//   with an unresolvable type.  Removing the prop declaration unblocks codegen.
//
// Fix 2 – delete src/fabric/gamma/ and src/fabric/tabs/ directories
//   These directories contain entire new components (SplitView and Tabs) that were
//   introduced in 4.24.0.  All their spec files use CT.X patterns that codegen
//   can't handle.  The app does not use either feature, so deleting the source
//   directories prevents codegen from ever processing them.
//
// Fix 3 – rewrite CT.X → X in remaining fabric spec files
//   Core navigation spec files (ScreenNativeComponent, ModalScreenNativeComponent,
//   ScreenStackNativeComponent, ScreenStackHeaderConfigNativeComponent,
//   ScreenStackHeaderSubviewNativeComponent, SafeAreaViewNativeComponent,
//   SearchBarNativeComponent) also use the CT.X pattern.  For each such file this
//   fix replaces every CT.WithDefault / CT.DirectEventHandler / CT.Int32 etc. with
//   the bare identifier, removes the two CT.UnsafeMixed[] props (iOS-only header
//   bar button lists) that have no codegen-safe equivalent, and inserts a direct
//   import of the needed types from react-native/Libraries/Types/CodegenTypes so
//   the bare identifiers resolve correctly.
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

      // --- Fix 2: delete src/fabric/gamma/, src/fabric/tabs/, src/components/gamma/,
      //           and src/components/tabs/ ---
      // The fabric sub-directories contain CT.X codegen specs that RN 0.79 can't handle.
      // The matching components sub-directories import from those deleted fabric dirs, so
      // they must also be removed — otherwise Metro bundling fails with "Unable to resolve
      // module ../../fabric/tabs/TabsHostNativeComponent" at JS bundle time.
      for (const subDir of ['gamma', 'tabs']) {
        for (const topDir of ['fabric', 'components']) {
          const dirToDelete = path.join(rnScreensRoot, 'src', topDir, subDir);
          if (fs.existsSync(dirToDelete)) {
            fs.rmSync(dirToDelete, { recursive: true, force: true });
            console.log(`[withFixRNScreensCodegen] Deleted src/${topDir}/${subDir}/ to prevent CT.WithDefault<LocalUnion> codegen / bundling errors.`);
          } else {
            console.log(`[withFixRNScreensCodegen] src/${topDir}/${subDir}/ not found — no patch needed.`);
          }
        }
      }

      // --- Fix 2b: remove export lines for deleted components from src/index.tsx ---
      // After deleting src/components/tabs/ and src/components/gamma/, src/index.tsx
      // still re-exports from those paths.  Metro will fail to resolve them at bundle
      // time even though codegen never sees them.  Strip any export line that references
      // './components/tabs' or './components/gamma'.
      const indexTsx = path.join(rnScreensRoot, 'src', 'index.tsx');
      if (fs.existsSync(indexTsx)) {
        let indexContents = fs.readFileSync(indexTsx, 'utf-8');
        const originalIndex = indexContents;
        // Remove any export { ... } from './components/tabs' or './components/gamma'
        indexContents = indexContents.replace(
          /^[^\n]*from\s+['"]\.\/components\/(?:tabs|gamma)['"]\s*;?\s*\n/gm,
          ''
        );
        if (indexContents !== originalIndex) {
          fs.writeFileSync(indexTsx, indexContents, 'utf-8');
          console.log('[withFixRNScreensCodegen] Removed tabs/gamma re-exports from src/index.tsx.');
        } else {
          console.log('[withFixRNScreensCodegen] No tabs/gamma re-exports found in src/index.tsx — no patch needed.');
        }
      }

      // --- Fix 3: rewrite CT.X → X in remaining fabric spec files ---
      const fabricDir = path.join(rnScreensRoot, 'src', 'fabric');
      if (fs.existsSync(fabricDir)) {
        const fabricTsFiles = collectTsFiles(fabricDir);
        let rewriteCount = 0;

        for (const filePath of fabricTsFiles) {
          let contents = fs.readFileSync(filePath, 'utf-8');

          // Only touch files that use the qualified CT. alias
          if (!contents.includes('CodegenTypes as CT')) {
            continue;
          }

          let patched = contents;

          // Replace CT.X<...> with bare X
          patched = patched.replace(/CT\.WithDefault</g, 'WithDefault<');
          patched = patched.replace(/CT\.DirectEventHandler</g, 'DirectEventHandler<');
          patched = patched.replace(/CT\.BubblingEventHandler</g, 'BubblingEventHandler<');

          // Replace CT.PrimitiveType (word-boundary safe via negative lookahead on word chars)
          patched = patched.replace(/CT\.Int32(?=[^a-zA-Z0-9_])/g, 'Int32');
          patched = patched.replace(/CT\.Float(?=[^a-zA-Z0-9_])/g, 'Float');
          patched = patched.replace(/CT\.Double(?=[^a-zA-Z0-9_])/g, 'Double');

          // Remove CT.UnsafeMixed[] props — these are iOS-only header button lists
          // with no codegen-safe TypeScript equivalent.
          patched = patched.replace(
            /^[ \t]*\w+\??\s*:\s*CT\.UnsafeMixed\[\];?\n/gm,
            ''
          );

          if (patched === contents) {
            continue;
          }

          // Insert a direct import of the needed bare type names immediately after
          // the first import statement so they are in scope.
          const firstImportIdx = patched.indexOf('import ');
          const firstImportNewline = firstImportIdx !== -1
            ? patched.indexOf('\n', firstImportIdx)
            : -1;
          if (firstImportNewline !== -1) {
            const codegenImport =
              "import type { WithDefault, DirectEventHandler, BubblingEventHandler, Int32, Float, Double } from 'react-native/Libraries/Types/CodegenTypes';\n";
            patched =
              patched.slice(0, firstImportNewline + 1) +
              codegenImport +
              patched.slice(firstImportNewline + 1);
          }

          fs.writeFileSync(filePath, patched, 'utf-8');
          console.log(
            `[withFixRNScreensCodegen] Rewrote CT.X → X in ${path.relative(rnScreensRoot, filePath)}`
          );
          rewriteCount++;
        }

        if (rewriteCount === 0) {
          console.log('[withFixRNScreensCodegen] No CT.X patterns found in fabric specs — no rewrite needed.');
        }
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
