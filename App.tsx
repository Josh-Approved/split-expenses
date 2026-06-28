import React, { useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as Linking from 'expo-linking';
import { useColorScheme, AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  NavigationContainer,
  DefaultTheme,
  DarkTheme,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import type { RootStackParamList } from './src/navigation';
import { useAppFonts, lightColors, darkColors, useApplyThemePreference } from './src/theme';
import { useApplyLocalePreference, useLocaleVersion } from './src/i18n/localePreference';
import { useGroups } from './src/store/groups';
import { startSyncEngine, flushSyncEngine } from './src/sync/engine';
import { prefetchRates } from './src/data/fx';
import { ensureNotificationHandler } from './src/lib/reminders';
import { parseShareLink } from './src/sync/share';
import AnimatedSplash from './src/components/AnimatedSplash';

import GroupsHomeScreen from './src/screens/GroupsHomeScreen';
import GroupDetailScreen from './src/screens/GroupDetailScreen';
import ClaimMemberScreen from './src/screens/ClaimMemberScreen';
import AddEditExpenseScreen from './src/screens/AddEditExpenseScreen';
import MembersScreen from './src/screens/MembersScreen';
import SettleUpScreen from './src/screens/SettleUpScreen';
import ShareScreen from './src/screens/ShareScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import Credits from './src/components/Credits';
import { QA_MODE } from './src/qa/qaMode';

// Under QA_MODE the capture harness wants a deterministic first frame: skip the
// native splash hold and the animated splash so screenshots aren't of a splash.
if (!QA_MODE) SplashScreen.preventAutoHideAsync().catch(() => {});

const Stack = createNativeStackNavigator<RootStackParamList>();
export const navRef = createNavigationContainerRef<RootStackParamList>();

export default function App() {
  // Restore + apply the saved appearance preference (System/Light/Dark) before
  // first paint; drives useColorScheme() here and in every screen.
  useApplyThemePreference();
  // Restore + apply the saved language before first paint; the version below keys
  // the navigator so a switch re-renders the whole app (canon § Translations).
  useApplyLocalePreference();
  const localeVersion = useLocaleVersion();
  const scheme = useColorScheme();
  const [fontsLoaded] = useAppFonts();
  const hydrate = useGroups((s) => s.hydrate);
  const hydrated = useGroups((s) => s.hydrated);
  const joinShared = useGroups((s) => s.joinShared);
  const [splashDone, setSplashDone] = useState(false);

  useEffect(() => {
    void hydrate();
    void prefetchRates();
    ensureNotificationHandler();
  }, [hydrate]);

  // Start live sync once the store is populated.
  useEffect(() => {
    if (hydrated) startSyncEngine();
  }, [hydrated]);

  // On the way to the background, durably flush local state and push the latest
  // copy to peers immediately — a change made just before switching apps can
  // otherwise be lost (fire-and-forget save not yet landed) or never published
  // (the 700ms publish debounce is suspended mid-wait).
  useEffect(() => {
    if (!hydrated) return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'inactive' || next === 'background') {
        flushSyncEngine();
        void useGroups.getState().flushPending();
      }
    });
    return () => sub.remove();
  }, [hydrated]);

  // Handle a tapped/scanned share link: join the group, jump to it.
  const handledInitial = useRef(false);
  useEffect(() => {
    if (!hydrated) return;
    const onUrl = (url: string | null) => {
      const secret = url ? parseShareLink(url) : null;
      if (!secret) return;
      const groupId = joinShared(secret);
      // Land on "Which one are you?" so the joiner claims an existing member
      // instead of duplicating themselves (it forwards on once "me" is set).
      const go = () => navRef.isReady() && navRef.navigate('ClaimMember', { groupId });
      if (navRef.isReady()) go();
      else setTimeout(go, 300);
    };
    if (!handledInitial.current) {
      handledInitial.current = true;
      Linking.getInitialURL().then(onUrl);
    }
    const sub = Linking.addEventListener('url', (e) => onUrl(e.url));
    return () => sub.remove();
  }, [hydrated, joinShared]);

  const ready = fontsLoaded && hydrated;
  const navTheme = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const c = scheme === 'dark' ? darkColors : lightColors;
  const themed = {
    ...navTheme,
    colors: { ...navTheme.colors, background: c.bg, card: c.bg, text: c.fg, border: c.hairline, primary: c.appAccent },
  };

  return (
    <SafeAreaProvider>
      {ready && (
        <NavigationContainer key={localeVersion} ref={navRef} theme={themed}>
          <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg }, animation: QA_MODE ? 'none' : undefined }}>
            <Stack.Screen name="GroupsHome" component={GroupsHomeScreen} />
            <Stack.Screen name="GroupDetail" component={GroupDetailScreen} />
            <Stack.Screen name="ClaimMember" component={ClaimMemberScreen} />
            <Stack.Screen name="AddEditExpense" component={AddEditExpenseScreen} options={{ presentation: 'modal' }} />
            <Stack.Screen name="Members" component={MembersScreen} />
            <Stack.Screen name="SettleUp" component={SettleUpScreen} />
            <Stack.Screen name="Share" component={ShareScreen} options={{ presentation: 'modal' }} />
            <Stack.Screen name="Settings" component={SettingsScreen} />
            <Stack.Screen name="Acknowledgements">
              {({ navigation }) => <Credits onBack={() => navigation.goBack()} />}
            </Stack.Screen>
          </Stack.Navigator>
        </NavigationContainer>
      )}
      {!QA_MODE && !splashDone && <AnimatedSplash ready={ready} onFinish={() => setSplashDone(true)} />}
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
    </SafeAreaProvider>
  );
}
