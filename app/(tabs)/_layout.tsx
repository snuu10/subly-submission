import { SymbolView } from 'expo-symbols';
import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AssistantTabButton } from '@/components/AssistantTabButton';
import { useColorScheme } from '@/components/useColorScheme';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';

export const unstable_settings = {
  initialRouteName: 'home',
};

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const theme = colors[colorScheme === 'dark' ? 'dark' : 'light'];

  return (
    <View style={{ flex: 1 }}>
      <Tabs
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: theme.primary,
            tabBarInactiveTintColor: theme.muted,
            tabBarStyle: {
              backgroundColor: theme.tabBar,
              borderTopColor: theme.border,
              height: 72 + insets.bottom,
              paddingTop: 8,
              paddingBottom: insets.bottom,
              overflow: 'visible',
            },
            tabBarLabelStyle: {
              fontFamily: fonts.sansBold,
              fontSize: 11,
            },
          }}>
          <Tabs.Screen
            name="home"
            options={{
              title: '홈',
              tabBarIcon: ({ color }) => (
                <SymbolView
                  name={{ ios: 'house.fill', android: 'home', web: 'home' }}
                  tintColor={color}
                  size={24}
                />
              ),
            }}
          />
          <Tabs.Screen
            name="subscriptions"
            options={{
              title: '목록',
              tabBarIcon: ({ color }) => (
                <SymbolView
                  name={{ ios: 'list.bullet', android: 'list', web: 'list' }}
                  tintColor={color}
                  size={24}
                />
              ),
            }}
          />
          <Tabs.Screen
            name="assistant"
            options={{
              title: '비서',
              tabBarLabel: () => null,
              tabBarIcon: () => null,
              tabBarButton: (props) => (
                <AssistantTabButton
                  onPress={props.onPress}
                  accessibilityState={props.accessibilityState}
                />
              ),
            }}
          />
          <Tabs.Screen
            name="upcoming"
            options={{
              title: '예정',
              tabBarIcon: ({ color }) => (
                <SymbolView
                  name={{ ios: 'clock.fill', android: 'schedule', web: 'schedule' }}
                  tintColor={color}
                  size={24}
                />
              ),
            }}
          />
          <Tabs.Screen
            name="stats"
            options={{
              title: '통계',
              tabBarIcon: ({ color }) => (
                <SymbolView
                  name={{ ios: 'chart.pie.fill', android: 'pie_chart', web: 'pie_chart' }}
                  tintColor={color}
                  size={24}
                />
              ),
            }}
          />
          <Tabs.Screen
            name="settings"
            options={{
              href: null,
              tabBarStyle: { display: 'none' },
            }}
          />
          <Tabs.Screen name="add-subscription" options={{ href: null }} />
        </Tabs>
    </View>
  );
}
