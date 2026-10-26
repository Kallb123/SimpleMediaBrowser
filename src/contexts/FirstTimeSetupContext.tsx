import React, { createContext, useContext, useMemo } from 'react';

interface FirstTimeSetupContextType {
  /** True once first-time setup has been finished. The root layout's Stack.Protected guards key off this. */
  setupComplete: boolean;
  setSetupComplete: (value: boolean) => void;
}

const FirstTimeSetupContext = createContext<FirstTimeSetupContextType>({
  setupComplete: false,
  setSetupComplete: () => {},
});

/**
 * The root layout owns the state (it reads the persisted flag at startup and needs the
 * value for its guards); this just makes it reachable from firsttime and the About modal.
 * AsyncStorage stays the persisted source of truth, so callers write the key and then call
 * `setSetupComplete`.
 */
export function FirstTimeSetupProvider({
  setupComplete,
  setSetupComplete,
  children,
}: FirstTimeSetupContextType & { children: React.ReactNode }) {
  const value = useMemo(() => ({ setupComplete, setSetupComplete }), [setupComplete, setSetupComplete]);

  return (
    <FirstTimeSetupContext.Provider value={value}>
      {children}
    </FirstTimeSetupContext.Provider>
  );
}

export function useFirstTimeSetup() {
  return useContext(FirstTimeSetupContext);
}
