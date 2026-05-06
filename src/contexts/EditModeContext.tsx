import React, { createContext, useContext, useState } from 'react';

interface EditModeContextType {
  editMode: boolean;
  setEditMode: (value: boolean) => void;
  drawerUnlocked: boolean;
  setDrawerUnlocked: (value: boolean) => void;
  selectedShows: Set<string>;
  toggleShowSelection: (key: string) => void;
  clearShowSelection: () => void;
}

const EditModeContext = createContext<EditModeContextType>({
  editMode: false,
  setEditMode: () => {},
  drawerUnlocked: false,
  setDrawerUnlocked: () => {},
  selectedShows: new Set(),
  toggleShowSelection: () => {},
  clearShowSelection: () => {},
});

export function EditModeProvider({ children }: { children: React.ReactNode }) {
  const [editMode, _setEditMode] = useState(false);
  const [drawerUnlocked, setDrawerUnlocked] = useState(false);
  const [selectedShows, setSelectedShows] = useState<Set<string>>(new Set());

  const setEditMode = (value: boolean) => {
    _setEditMode(value);
    // Clear any pending show selection when leaving edit mode.
    if (!value) {
      setSelectedShows(new Set());
    }
  };

  const toggleShowSelection = (key: string) => {
    setSelectedShows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const clearShowSelection = () => setSelectedShows(new Set());

  return (
    <EditModeContext.Provider value={{ editMode, setEditMode, drawerUnlocked, setDrawerUnlocked, selectedShows, toggleShowSelection, clearShowSelection }}>
      {children}
    </EditModeContext.Provider>
  );
}

export function useEditMode() {
  return useContext(EditModeContext);
}
