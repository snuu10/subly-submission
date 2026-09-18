import { create } from 'zustand';

import { supabase } from '@/lib/supabase';
import type {
  PaymentInstrument,
  PaymentInstrumentKind,
  PaymentInstrumentWrite,
} from '@/types/payment-instrument';

const TABLE = 'payment_instruments';

function sortInstruments(rows: PaymentInstrument[]): PaymentInstrument[] {
  return [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

type PaymentInstrumentState = {
  instruments: PaymentInstrument[];
  loading: boolean;
  error: string | null;
  fetchInstruments: () => Promise<void>;
  addInstrument: (input: PaymentInstrumentWrite) => Promise<PaymentInstrument | null>;
  updateInstrument: (id: string, input: PaymentInstrumentWrite) => Promise<boolean>;
  deleteInstrument: (id: string) => Promise<boolean>;
};

export function instrumentsOfKind(
  instruments: PaymentInstrument[],
  kind: PaymentInstrumentKind
): PaymentInstrument[] {
  return instruments.filter((item) => item.kind === kind);
}

export function findInstrument(
  instruments: PaymentInstrument[],
  id: string | null | undefined
): PaymentInstrument | undefined {
  if (!id) return undefined;
  return instruments.find((item) => item.id === id);
}

export const usePaymentInstrumentStore = create<PaymentInstrumentState>((set, get) => ({
  instruments: [],
  loading: false,
  error: null,

  fetchInstruments: async () => {
    const { data: auth } = await supabase.auth.getSession();
    if (!auth.session) {
      set({ instruments: [], loading: false, error: null });
      return;
    }

    const quiet = get().instruments.length > 0;
    if (!quiet) set({ loading: true, error: null });
    else set({ error: null });

    const { data, error } = await supabase.from(TABLE).select('*').order('created_at', { ascending: false });
    if (error) {
      set({ loading: false, error: error.message });
      return;
    }

    set({
      instruments: sortInstruments((data ?? []) as PaymentInstrument[]),
      loading: false,
      error: null,
    });
  },

  addInstrument: async (input) => {
    const { data: auth } = await supabase.auth.getSession();
    const userId = auth.session?.user?.id;
    if (!userId) {
      set({ error: '로그인이 필요합니다.' });
      return null;
    }

    const payload = toRow(input);
    const { data, error } = await supabase
      .from(TABLE)
      .insert({ user_id: userId, ...payload })
      .select()
      .single();

    if (error || !data) {
      set({ error: error?.message ?? '결제수단을 추가하지 못했습니다.' });
      return null;
    }

    const created = data as PaymentInstrument;
    set((state) => ({
      instruments: sortInstruments([created, ...state.instruments]),
      error: null,
    }));
    return created;
  },

  updateInstrument: async (id, input) => {
    const previous = get().instruments;
    const current = previous.find((item) => item.id === id);
    if (!current) return false;

    const payload = toRow(input);
    const updated: PaymentInstrument = {
      ...current,
      ...payload,
      updated_at: new Date().toISOString(),
    };
    set({
      instruments: previous.map((item) => (item.id === id ? updated : item)),
      error: null,
    });

    const { error } = await supabase
      .from(TABLE)
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      set({ instruments: previous, error: error.message });
      return false;
    }
    return true;
  },

  deleteInstrument: async (id) => {
    const previous = get().instruments;
    set({ instruments: previous.filter((item) => item.id !== id), error: null });

    const { error } = await supabase.from(TABLE).delete().eq('id', id);
    if (error) {
      set({ instruments: previous, error: error.message });
      return false;
    }
    return true;
  },
}));

function toRow(input: PaymentInstrumentWrite) {
  const isCard = input.kind === 'card';
  return {
    kind: input.kind,
    institution_key: input.institution_key,
    name: input.name.trim(),
    number_last4: input.number_last4,
    status: input.status,
    classification: input.classification,
    card_type: isCard ? (input.card_type ?? 'credit') : null,
    expiry_month: isCard ? (input.expiry_month ?? null) : null,
    expiry_year: isCard ? (input.expiry_year ?? null) : null,
    memo: input.memo?.trim() || null,
  };
}
