const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// react-native-reanimated 3.16.x accesses `mutation.parentShadowView` — a
// field on facebook::react::ShadowViewMutation — throughout
// LayoutAnimationsProxy.cpp.  React Native 0.79 removed that field; the struct
// now exposes only `parentTag` (a Tag/int) instead of the full ShadowView.
//
// This plugin patches LayoutAnimationsProxy.cpp during prebuild so it compiles
// cleanly against React Native 0.79:
//
//   Fix 1 – .parentShadowView.tag → .parentTag
//            Covers all direct tag-access sites (parseRemoveMutations,
//            updateIndexForMutation, maybeUpdateWindowDimensions, etc.)
//
//   Fix 2 – .parentShadowView.layoutMetrics → .newChildShadowView.layoutMetrics
//            maybeUpdateWindowDimensions reads the parent's layout to discover
//            window dimensions.  Without parentShadowView, newChildShadowView
//            is the best available proxy (for a top-level root view the child
//            layout matches the surface/window size).
//
//   Fix 3 – std::make_shared<ShadowView>(mutation.parentShadowView) →
//            default-construct ShadowView and set .tag from parentTag.
//            Used in createLayoutAnimation and startEnteringAnimation to store
//            the parent context for in-flight animations.
//
//   Fix 4 – remaining mutation.parentShadowView → mutation.parentTag
//            Handles the InsertMutation / UpdateMutation factory-method
//            arguments where the deprecated ShadowView overloads are replaced
//            by the new Tag-accepting primary overloads in RN 0.79.
function withFixReanimatedLayoutAnimations(config) {
  return withDangerousMod(config, [
    'android',
    (config) => {
      const filePath = path.join(
        config.modRequest.projectRoot,
        'node_modules',
        'react-native-reanimated',
        'Common',
        'cpp',
        'reanimated',
        'LayoutAnimations',
        'LayoutAnimationsProxy.cpp'
      );

      if (!fs.existsSync(filePath)) {
        console.warn(
          '[withFixReanimatedLayoutAnimations] LayoutAnimationsProxy.cpp not found — skipping.'
        );
        return config;
      }

      let contents = fs.readFileSync(filePath, 'utf-8');

      if (
        !contents.includes('.parentShadowView.tag') &&
        !contents.includes('.parentShadowView.layoutMetrics') &&
        !contents.includes('make_shared<ShadowView>(mutation.parentShadowView)')
      ) {
        console.log(
          '[withFixReanimatedLayoutAnimations] No parentShadowView code patterns found — no patch needed.'
        );
        return config;
      }

      // Fix 1: .parentShadowView.tag → .parentTag
      contents = contents.replace(/\.parentShadowView\.tag\b/g, '.parentTag');

      // Fix 2: .parentShadowView.layoutMetrics → .newChildShadowView.layoutMetrics
      contents = contents.replace(
        /\.parentShadowView\.layoutMetrics/g,
        '.newChildShadowView.layoutMetrics'
      );

      // Fix 3: std::make_shared<ShadowView>(mutation.parentShadowView) →
      //   default-construct ShadowView from parentTag.
      //   Captures leading whitespace to preserve original indentation.
      //   Matches both `parentView` and `parent` variable names used in the file.
      contents = contents.replace(
        /([ \t]*)auto (parentView|parent) = std::make_shared<ShadowView>\(mutation\.parentShadowView\);/g,
        (match, indent, varName) =>
          `${indent}ShadowView _parentSVCompat{}; _parentSVCompat.tag = mutation.parentTag;\n${indent}auto ${varName} = std::make_shared<ShadowView>(_parentSVCompat);`
      );

      // Fix 4: any remaining mutation.parentShadowView → mutation.parentTag
      //   Covers InsertMutation(mutation.parentShadowView, ...) and
      //   UpdateMutation(..., mutation.parentShadowView) calls, which now use
      //   the Tag-based primary overloads in RN 0.79.
      contents = contents.replace(/mutation\.parentShadowView\b/g, 'mutation.parentTag');

      fs.writeFileSync(filePath, contents, 'utf-8');
      console.log(
        '[withFixReanimatedLayoutAnimations] Patched LayoutAnimationsProxy.cpp for RN 0.79 compatibility.'
      );

      return config;
    },
  ]);
}

module.exports = withFixReanimatedLayoutAnimations;
