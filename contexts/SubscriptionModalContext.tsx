import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { useSubscriptionStore } from '@/stores/subscription-store';
import type { BillingCycle, Subscription } from '@/types/subscription';

type SavedCallback = (saved: Subscription) => void;

export type SubscriptionDraft = {
  name?: string;
  amount?: number;
  billing_cycle?: BillingCycle;
  category_id?: string;
  anchor_date?: string;
  account_id?: string;
  preset_id?: string | null;
};

type SubscriptionModalContextValue = {
  editingId: string | null;
  visible: boolean;
  draft: SubscriptionDraft | null;
  methodPickerVisible: boolean;
  onSavedCallback: SavedCallback | null;
  openAdd: (draft?: SubscriptionDraft, onSaved?: SavedCallback) => void;
  openEdit: (id: string, onSaved?: SavedCallback) => void;
  openMethodPicker: () => void;
  closeMethodPicker: () => void;
  close: () => void;
};

const SubscriptionModalContext = createContext<SubscriptionModalContextValue | null>(null);

export function SubscriptionModalProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SubscriptionDraft | null>(null);
  const [methodPickerVisible, setMethodPickerVisible] = useState(false);
  const [onSavedCallback, setOnSavedCallback] = useState<SavedCallback | null>(null);

  const openAdd = useCallback((nextDraft?: SubscriptionDraft, onSaved?: SavedCallback) => {
    setEditingId(null);
    setDraft(nextDraft ?? null);
    setMethodPickerVisible(false);
    setOnSavedCallback(() => onSaved ?? null);
    setVisible(true);
  }, []);

  const openEdit = useCallback((id: string, onSaved?: SavedCallback) => {
    setDraft(null);
    setEditingId(id);
    setMethodPickerVisible(false);
    setOnSavedCallback(() => onSaved ?? null);
    setVisible(true);
  }, []);

  const openMethodPicker = useCallback(() => {
    setMethodPickerVisible(true);
  }, []);

  const closeMethodPicker = useCallback(() => {
    setMethodPickerVisible(false);
  }, []);

  const close = useCallback(() => {
    setVisible(false);
    setEditingId(null);
    setDraft(null);
    setOnSavedCallback(null);
  }, []);

  const value = useMemo(
    () => ({
      editingId,
      visible,
      draft,
      methodPickerVisible,
      onSavedCallback,
      openAdd,
      openEdit,
      openMethodPicker,
      closeMethodPicker,
      close,
    }),
    [
      close,
      closeMethodPicker,
      draft,
      editingId,
      methodPickerVisible,
      onSavedCallback,
      openAdd,
      openEdit,
      openMethodPicker,
      visible,
    ]
  );

  return (
    <SubscriptionModalContext.Provider value={value}>{children}</SubscriptionModalContext.Provider>
  );
}

export function useSubscriptionModal() {
  const context = useContext(SubscriptionModalContext);
  if (!context) {
    throw new Error('useSubscriptionModal must be used within SubscriptionModalProvider');
  }
  return context;
}
