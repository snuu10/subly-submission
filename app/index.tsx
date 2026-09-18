import { Redirect, type Href } from 'expo-router';

import { useAuthStore } from '@/stores/auth-store';

export default function Index() {
  const session = useAuthStore((state) => state.session);

  if (session) {
    return <Redirect href={'/(tabs)/home' as Href} />;
  }

  return <Redirect href={'/(onboarding)' as Href} />;
}
