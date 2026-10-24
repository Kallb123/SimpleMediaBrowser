export const StorageKeys = {
  DIRECTORY_KEY: "directory",
  FIRST_TIME_SETUP_KEY: 'firstTimeSetup',
  // Consecutive launches whose settings rehydrate failed (see store/rehydrateRecovery.ts).
  // Deliberately its own tiny entry, separate from persist:root, so it stays readable
  // when persist:root is not.
  REHYDRATE_FAILURE_KEY: 'persistRehydrateFailure',
};
