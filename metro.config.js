// Learn more https://docs.expo.dev/guides/customizing-metro/
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// `expo-file-system`'s File/Directory/Paths throw on web, which stops the app
// booting there (FileScanner and the providers construct Directory/File at
// module scope). Swap in a tiny no-op shim for the web platform only, so the
// UI can be exercised headlessly. Native resolution is untouched.
const WEB_FILE_SYSTEM_SHIM = path.resolve(__dirname, 'src/shims/expo-file-system.web.ts');
const upstreamResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName === 'expo-file-system') {
    return { type: 'sourceFile', filePath: WEB_FILE_SYSTEM_SHIM };
  }
  return (upstreamResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
