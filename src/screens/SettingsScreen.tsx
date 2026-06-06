/**
 * Settings / About — the global settings screen (canon § Settings / About).
 *
 * App-specific settings sit ABOVE the canonical About block:
 *  1. Settle-up reminders — a per-device, off-by-default nudge about what YOU
 *     owe. We persist only the preference here; the actual scheduling is wired
 *     in a later step. We never message anyone but the person on this phone.
 *  2. How sharing works — a plain-language note on where group data lives.
 *
 * The About block (Buy Me a Coffee, feedback, review, privacy, source,
 * acknowledgements, version, the "josh approved" stamp) is the canonical floor,
 * modelled on grocery-list's SettingsScreen so every app reads as a sibling.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, Switch, StyleSheet, Linking, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  HandHeart,
  Mail,
  Star,
  Shield,
  Code2,
  Library,
  Check,
  ChevronRight,
} from 'lucide-react-native';
import Constants from 'expo-constants';

import type { RootStackParamList } from '../navigation';
import { getSetting, setSetting } from '../store/db';
import { useTheme, fontFamily, space, radius, target, type as t, hairline, type Colors } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

// Canonical external links (mirrors grocery-list/src/lib/links.ts).
const BMAC_URL = 'https://buymeacoffee.com/jtysonwilliams'; // from DonationModal
const STUDIO_URL = 'https://joshapproved.com';
const REPO_URL = 'https://github.com/Josh-Approved/split-expenses';
const PRIVACY_URL = 'https://github.com/Josh-Approved/split-expenses/blob/main/PRIVACY.md';
const FEEDBACK_EMAIL = 'info@joshapproved.com';

// TODO: fill the numeric App Store Connect id once the ASC record exists. Empty
// is the known pre-store state; the review deep link no-ops cleanly until then.
const IOS_APP_STORE_ID = '';
const ANDROID_PACKAGE = 'com.joshapproved.splitexpenses';

const REMINDERS_KEY = 'reminders_enabled';

function versionLabel(): string {
  const v = Constants.expoConfig?.version ?? '1.0.0';
  return v;
}

function openUrl(url: string) {
  Linking.openURL(url).catch(() => {});
}

function openFeedbackMail() {
  const subject = encodeURIComponent(`Split Expenses ${versionLabel()}`);
  openUrl(`mailto:${FEEDBACK_EMAIL}?subject=${subject}`);
}

function openReview() {
  const url =
    Platform.OS === 'ios'
      ? `itms-apps://apps.apple.com/app/id${IOS_APP_STORE_ID}?action=write-review`
      : `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}&showAllReviews=true`;
  openUrl(url);
}

export default function SettingsScreen({ navigation }: Props) {
  const { c } = useTheme();
  const s = makeStyles(c);
  const insets = useSafeAreaInsets();

  const [reminders, setReminders] = useState(false);

  useEffect(() => {
    let alive = true;
    getSetting(REMINDERS_KEY).then((v) => {
      if (alive) setReminders(v === '1');
    });
    return () => {
      alive = false;
    };
  }, []);

  const toggleReminders = (next: boolean) => {
    setReminders(next);
    void setSetting(REMINDERS_KEY, next ? '1' : '0');
    // scheduling wired in step 7
  };

  return (
    <View style={[s.screen, { paddingTop: insets.top }]}>
      <View style={s.topbar}>
        <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Back" hitSlop={8} style={s.iconBtn}>
          <Text style={s.backChevron}>‹</Text>
        </Pressable>
        <Text style={s.topTitle} numberOfLines={1} accessibilityRole="header">
          Settings
        </Text>
        <View style={s.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + space.s8 }}>
        {/* ---- Settle-up reminders (app-specific, above About) -------- */}
        <Text style={s.sectionLabel}>Settle-up reminders</Text>
        <View style={s.card}>
          <View style={s.switchRow}>
            <Text style={s.switchLabel}>Remind me what I owe</Text>
            <Switch
              value={reminders}
              onValueChange={toggleReminders}
              trackColor={{ false: c.hairlineStrong, true: c.appAccent }}
              thumbColor={c.bgElevated}
              ios_backgroundColor={c.hairlineStrong}
              accessibilityLabel="Settle-up reminders"
            />
          </View>
        </View>
        <Text style={s.helper}>
          A gentle nudge on YOUR phone about what YOU owe. Off until you turn it on — we never message anyone else.
        </Text>

        {/* ---- How sharing works ------------------------------------- */}
        <Text style={s.sectionLabel}>How sharing works</Text>
        <View style={s.card}>
          <Text style={s.bodyText}>
            Your groups live on this device. When you share a group, it&apos;s also passed —
            encrypted — through free public drop boxes we don&apos;t run and can&apos;t read. There&apos;s
            no account, ever.
          </Text>
        </View>

        {/* ---- About (canonical) ------------------------------------- */}
        <Text style={s.sectionLabel}>About</Text>
        <View style={s.card}>
          <AboutRow c={c} s={s} icon={HandHeart} label="Buy Me a Coffee" onPress={() => openUrl(BMAC_URL)} first />
          <AboutRow c={c} s={s} icon={Mail} label="Send feedback" onPress={openFeedbackMail} />
          <AboutRow c={c} s={s} icon={Star} label="Leave a review" onPress={openReview} />
          <AboutRow c={c} s={s} icon={Shield} label="Privacy policy" onPress={() => openUrl(PRIVACY_URL)} />
          <AboutRow c={c} s={s} icon={Code2} label="Source code" onPress={() => openUrl(REPO_URL)} />
          <AboutRow c={c} s={s} icon={Library} label="Acknowledgements" onPress={() => navigation.navigate('Acknowledgements')} chevron />
          <View style={[s.aboutRow, s.rowBorder]}>
            <View style={s.aboutIcon} />
            <Text style={s.aboutLabel}>Version</Text>
            <Text style={s.aboutValue}>{versionLabel()}</Text>
          </View>
        </View>

        {/* ---- Stamp -------------------------------------------------- */}
        <Pressable
          style={s.stamp}
          onPress={() => openUrl(STUDIO_URL)}
          accessibilityRole="button"
          accessibilityLabel="josh approved — learn more at joshapproved.com"
        >
          <View style={s.wordmark} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Check size={18} color={c.accent} strokeWidth={3} />
            <Text style={s.wordmarkText}>josh approved</Text>
          </View>
          <Text style={s.stampLine}>
            Privacy-first replacements for paywalled utility apps. Open source. Pay what you want.
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function AboutRow({
  c,
  s,
  icon: Icon,
  label,
  onPress,
  first,
  chevron,
}: {
  c: Colors;
  s: ReturnType<typeof makeStyles>;
  icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  label: string;
  onPress: () => void;
  first?: boolean;
  chevron?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [s.aboutRow, !first && s.rowBorder, pressed && s.pressed]}
    >
      <View style={s.aboutIcon}>
        <Icon size={20} color={c.fgMuted} strokeWidth={1.5} />
      </View>
      <Text style={s.aboutLabel}>{label}</Text>
      {chevron ? <ChevronRight size={18} color={c.fgSubtle} strokeWidth={1.5} /> : null}
    </Pressable>
  );
}

function makeStyles(c: Colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    pressed: { opacity: 0.6 },

    iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    backChevron: { fontSize: 30, lineHeight: 32, color: c.fg, fontFamily: fontFamily.sans },
    topbar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.s4, paddingVertical: space.s3, gap: space.s2 },
    topTitle: { ...t.md, fontFamily: fontFamily.sansSemibold, color: c.fg, flex: 1 },

    sectionLabel: {
      ...t.xs,
      fontFamily: fontFamily.sansSemibold,
      color: c.fgMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      paddingHorizontal: space.s6,
      paddingTop: space.s7,
      paddingBottom: space.s3,
    },

    card: {
      marginHorizontal: space.s5,
      backgroundColor: c.bgElevated,
      borderRadius: radius.lg,
      borderWidth: hairline,
      borderColor: c.hairline,
      overflow: 'hidden',
    },
    rowBorder: { borderTopWidth: hairline, borderTopColor: c.hairline },

    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: space.s5,
      paddingVertical: space.s4,
      minHeight: target.min + 8,
    },
    switchLabel: { ...t.base, fontFamily: fontFamily.sansMedium, color: c.fg, flex: 1, marginRight: space.s4 },
    helper: { ...t.sm, fontFamily: fontFamily.sans, color: c.fgMuted, paddingHorizontal: space.s6, paddingTop: space.s3 },

    bodyText: { ...t.sm, fontFamily: fontFamily.sans, color: c.fgMuted, padding: space.s5, lineHeight: 21 },

    aboutRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.s4,
      paddingHorizontal: space.s5,
      minHeight: target.min + 8,
    },
    aboutIcon: { width: 24, alignItems: 'center' },
    aboutLabel: { ...t.base, fontFamily: fontFamily.sansMedium, color: c.fg, flex: 1 },
    aboutValue: { ...t.base, fontFamily: fontFamily.sans, color: c.fgMuted },

    stamp: { alignItems: 'center', paddingHorizontal: space.s7, paddingTop: space.s9, gap: space.s3 },
    wordmark: { flexDirection: 'row', alignItems: 'center', gap: space.s2 },
    wordmarkText: { fontFamily: fontFamily.sansSemibold, fontSize: 16, lineHeight: 20, color: c.fg },
    stampLine: { ...t.sm, fontFamily: fontFamily.sans, color: c.fgMuted, textAlign: 'center' },
  });
}
