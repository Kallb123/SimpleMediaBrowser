import React, { createContext, useContext, useState } from 'react';

interface EditModeContextType {
  editMode: boolean;
  setEditMode: (value: boolean) => void;
  drawerUnlocked: boolean;
  setDrawerUnlocked: (value: boolean) => void;
  /**
   * Set of override keys for currently selected items.
   * Keys use the same namespaced format as `mediaOverrides`:
   *   "show:<showName>"      – for a TV show folder
   *   "movie:<parsedPath>"   – for a movie file
   *   "episode:<parsedPath>" – for an episode file
   */
  selectedItems: Set<string>;
  toggleItemSelection: (key: string) => void;
  clearItemSelection: () => void;
}

const EditModeContext = createContext<EditModeContextType>({
  editMode: false,
  setEditMode: () => {},
  drawerUnlocked: false,
  setDrawerUnlocked: () => {},
  selectedItems: new Set<string>(),
  toggleItemSelection: () => {},
  clearItemSelection: () => {},
});

export function EditModeProvider({ children }: { children: React.ReactNode }) {
  const [editMode, _setEditMode] = useState(false);
  const [drawerUnlocked, setDrawerUnlocked] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

  const setEditMode = (value: boolean) => {
    _setEditMode(value);
    // Clear any pending selection when leaving edit mode.
    if (!value) {
      setSelectedItems(new Set());
    }
  };

  const toggleItemSelection = (key: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const clearItemSelection = () => setSelectedItems(new Set());

  return (
    <EditModeContext.Provider value={{ editMode, setEditMode, drawerUnlocked, setDrawerUnlocked, selectedItems, toggleItemSelection, clearItemSelection }}>
      {children}
    </EditModeContext.Provider>
  );
}

export function useEditMode() {
  return useContext(EditModeContext);
}
