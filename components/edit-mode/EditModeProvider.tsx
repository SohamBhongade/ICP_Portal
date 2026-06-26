"use client";

// Edit Mode client context. `canEdit` is true only for admins; `editMode` is
// the global toggle state (seeded from app_settings on the server). Toggling
// persists to app_settings and refreshes the route so server-rendered overrides
// re-read.

import {
  createContext,
  useContext,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { setEditModeAction } from "@/app/actions/edit-mode";

type EditModeContextValue = {
  canEdit: boolean;
  editMode: boolean;
  /** True when admin AND edit mode is on — i.e. show editing affordances. */
  editing: boolean;
  toggle: () => void;
  pending: boolean;
};

const EditModeContext = createContext<EditModeContextValue | null>(null);

export function EditModeProvider({
  canEdit,
  initialEditMode,
  children,
}: {
  canEdit: boolean;
  initialEditMode: boolean;
  children: React.ReactNode;
}) {
  const [editMode, setEditMode] = useState(initialEditMode);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const toggle = () => {
    if (!canEdit) return;
    const next = !editMode;
    setEditMode(next); // optimistic
    startTransition(async () => {
      await setEditModeAction(next);
      router.refresh();
    });
  };

  return (
    <EditModeContext.Provider
      value={{
        canEdit,
        editMode,
        editing: canEdit && editMode,
        toggle,
        pending,
      }}
    >
      {children}
    </EditModeContext.Provider>
  );
}

export function useEditMode(): EditModeContextValue {
  const ctx = useContext(EditModeContext);
  if (!ctx) {
    // Safe default so components work even outside the provider (non-admins).
    return {
      canEdit: false,
      editMode: false,
      editing: false,
      toggle: () => {},
      pending: false,
    };
  }
  return ctx;
}
