import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

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
   *
   * The selection belongs to the screen that made it (`selectionOwner`, a route key).
   * Every folder level of a media section is its own mounted screen, so each consumer must
   * ignore a selection it doesn't own — see MediaBrowserScreen.
   */
  selectedItems: Set<string>;
  selectionOwner: string | null;
  /** Toggles `key` for `owner`. A selection held by a different owner is discarded first. */
  toggleItemSelection: (key: string, owner: string) => void;
  /** Clears the selection; with `owner`, only if that owner still holds it. */
  clearItemSelection: (owner?: string) => void;
}

export interface Selection {
  owner: string | null;
  items: Set<string>;
}

const EMPTY_SELECTION: Selection = { owner: null, items: new Set<string>() };

/** Toggles `key` for `owner`, discarding a selection held by a different owner first. */
export function toggleSelection(prev: Selection, key: string, owner: string): Selection {
  const items = new Set(prev.owner === owner ? prev.items : []);
  if (items.has(key)) {
    items.delete(key);
  } else {
    items.add(key);
  }
  return { owner, items };
}

/** Clears the selection; with `owner`, only if that owner still holds it. */
export function clearSelection(prev: Selection, owner?: string): Selection {
  return owner === undefined || prev.owner === owner ? EMPTY_SELECTION : prev;
}

const EditModeContext = createContext<EditModeContextType>({
  editMode: false,
  setEditMode: () => {},
  drawerUnlocked: false,
  setDrawerUnlocked: () => {},
  selectedItems: EMPTY_SELECTION.items,
  selectionOwner: null,
  toggleItemSelection: () => {},
  clearItemSelection: () => {},
});

export function EditModeProvider({ children }: { children: React.ReactNode }) {
  const [editMode, _setEditMode] = useState(false);
  const [drawerUnlocked, setDrawerUnlocked] = useState(false);
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);

  // These are memoised because consumers use them as hook dependencies — notably
  // MediaBrowserScreen's navigateInto, which feeds the memo backing FlashList's `data`.
  // Recreating them each render invalidates that memo and forces the list to re-lay out.
  const setEditMode = useCallback((value: boolean) => {
    _setEditMode(value);
    // Clear any pending selection when leaving edit mode.
    if (!value) {
      setSelection(EMPTY_SELECTION);
    }
  }, []);

  const toggleItemSelection = useCallback((key: string, owner: string) => {
    setSelection((prev) => toggleSelection(prev, key, owner));
  }, []);

  const clearItemSelection = useCallback((owner?: string) => {
    setSelection((prev) => clearSelection(prev, owner));
  }, []);

  const { items: selectedItems, owner: selectionOwner } = selection;
  const value = useMemo(
    () => ({ editMode, setEditMode, drawerUnlocked, setDrawerUnlocked, selectedItems, selectionOwner, toggleItemSelection, clearItemSelection }),
    [editMode, setEditMode, drawerUnlocked, selectedItems, selectionOwner, toggleItemSelection, clearItemSelection],
  );

  return (
    <EditModeContext.Provider value={value}>
      {children}
    </EditModeContext.Provider>
  );
}

export function useEditMode() {
  return useContext(EditModeContext);
}
