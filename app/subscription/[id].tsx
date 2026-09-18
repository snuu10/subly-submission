import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';

import { useSubscriptionModal } from '@/contexts/SubscriptionModalContext';
import { useThemeColors } from '@/constants/colors';

function normalizeParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default function EditSubscriptionRedirect() {
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const subscriptionId = normalizeParam(params.id);
  const { openEdit } = useSubscriptionModal();

  useEffect(() => {
    if (!subscriptionId) {
      router.replace('/(tabs)/home' as Href);
      return;
    }

    openEdit(subscriptionId);
    const timer = setTimeout(() => {
      router.replace('/(tabs)/home' as Href);
    }, 0);

    return () => clearTimeout(timer);
  }, [openEdit, subscriptionId]);

  return <View style={{ flex: 1, backgroundColor: colors.background }} />;
}
