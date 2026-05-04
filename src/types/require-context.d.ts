// Type augmentation for Metro bundler's require.context API used by expo-router
interface NodeRequire {
  context(
    path: string,
    deep?: boolean,
    filter?: RegExp,
  ): {
    keys(): string[];
    (id: string): unknown;
    resolve(id: string): string;
    id: string;
  };
}
