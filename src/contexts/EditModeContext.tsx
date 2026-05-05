import React, { createContext, useContext, useState } from 'react';

interface EditModeContextType {
  editMode: boolean;
  setEditMode: (value: boolean) => void;
  drawerUnlocked: boolean;
  setDrawerUnlocked: (value: boolean) => void;
}

const EditModeContext = createContext<EditModeContextType>({
  editMode: false,
  setEditMode: () => {},
  drawerUnlocked: false,
  setDrawerUnlocked: () => {},
});

export function EditModeProvider({ children }: { children: React.ReactNode }) {
  const [editMode, setEditMode] = useState(false);
  const [drawerUnlocked, setDrawerUnlocked] = useState(false);
  return (
    <EditModeContext.Provider value={{ editMode, setEditMode, drawerUnlocked, setDrawerUnlocked }}>
      {children}
    </EditModeContext.Provider>
  );
}

export function useEditMode() {
  return useContext(EditModeContext);
}
