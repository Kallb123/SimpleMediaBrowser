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

// expo-sqlite (the library store) on web: its worker imports a .wasm file and
// needs SharedArrayBuffer, i.e. a cross-origin-isolated page. Per the
// expo-sqlite web setup docs. Neither affects native bundles.
config.resolver.assetExts.push('wasm');
const upstreamEnhanceMiddleware = config.server.enhanceMiddleware;
config.server.enhanceMiddleware = (middleware, server) => {
  const base = upstreamEnhanceMiddleware ? upstreamEnhanceMiddleware(middleware, server) : middleware;
  return (req, res, next) => {
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    return base(req, res, next);
  };
};

module.exports = config;
