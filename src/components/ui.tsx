/**
 * Shared UI primitives — the building blocks every screen composes from, so
 * the app reads as one calm, restrained surface (the design-system look is this
 * app's headline differentiator). Hairlines do the work shadows would; touch
 * targets are ≥44dp; text scales with the system.
 */

import React from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  type ViewStyle,
  type StyleProp,
} from 'react-native';
import {
  useTheme,
  fontFamily,
  space,
  radius,
  target,
  type as t,
  tracking,
  hairline,
  type Colors,
} from '../theme';
import { initials } from '../lib/format';

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFFFFF', fontFamily: fontFamily.sansSemibold },
});

/* ---- Avatar -------------------------------------------------------- */

export function Avatar({
  name,
  color,
  emoji,
  size = 36,
}: {
  name: string;
  color?: string;
  emoji?: string;
  size?: number;
}) {
  const bg = color ?? '#6B6B72';
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: bg },
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text style={[styles.avatarText, { fontSize: size * 0.4 }]} allowFontScaling={false}>
        {emoji ?? initials(name)}
      </Text>
    </View>
  );
}

/* ---- Primary / ghost buttons --------------------------------------- */

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { c } = useTheme();
  const s = makeStyles(c);
  // Primary CTAs are always ink-on-paper (design system § Color: the per-app
  // accent is never a CTA fill).
  const bg = variant === 'ghost' ? 'transparent' : variant === 'danger' ? c.dangerBg : c.inkButton;
  const fg = variant === 'ghost' ? c.fg : variant === 'danger' ? c.danger : c.inkButtonText;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        s.btn,
        { backgroundColor: bg },
        variant === 'ghost' && { borderWidth: hairline, borderColor: c.hairlineStrong },
        (disabled || loading) && s.btnDisabled,
        pressed && s.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[s.btnText, { color: fg }]}>{label}</Text>
      )}
    </Pressable>
  );
}

/* ---- Card + rows --------------------------------------------------- */

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  const s = makeStyles(c);
  return <View style={[s.card, style]}>{children}</View>;
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  const { c } = useTheme();
  const s = makeStyles(c);
  return (
    <Text style={s.sectionLabel} accessibilityRole="header">
      {children}
    </Text>
  );
}

/** A tappable list row with optional leading element, title/subtitle, and a
 *  trailing element (e.g. an amount). */
export function Row({
  leading,
  title,
  subtitle,
  trailing,
  onPress,
  destructive,
}: {
  leading?: React.ReactNode;
  title: string;
  subtitle?: string;
  trailing?: React.ReactNode;
  onPress?: () => void;
  destructive?: boolean;
}) {
  const { c } = useTheme();
  const s = makeStyles(c);
  const body = (
    <>
      {leading ? <View style={s.rowLeading}>{leading}</View> : null}
      <View style={s.rowBody}>
        <Text style={[s.rowTitle, destructive && { color: c.danger }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={s.rowSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing ? <View style={s.rowTrailing}>{trailing}</View> : null}
    </>
  );
  if (!onPress) return <View style={s.row}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [s.row, pressed && s.pressed]}
    >
      {body}
    </Pressable>
  );
}

export function Divider() {
  const { c } = useTheme();
  return <View style={{ height: hairline, backgroundColor: c.hairline }} />;
}

/* ---- Empty state --------------------------------------------------- */

export function EmptyState({
  title,
  message,
  children,
}: {
  title: string;
  message?: string;
  children?: React.ReactNode;
}) {
  const { c } = useTheme();
  const s = makeStyles(c);
  return (
    <View style={s.empty}>
      <Text style={s.emptyTitle}>{title}</Text>
      {message ? <Text style={s.emptyMessage}>{message}</Text> : null}
      {children ? <View style={{ marginTop: space.s6 }}>{children}</View> : null}
    </View>
  );
}

/* ---- A header bar with a back chevron + title + optional action ----- */

export function HeaderBar({
  title,
  onBack,
  right,
}: {
  title: string;
  onBack?: () => void;
  right?: React.ReactNode;
}) {
  const { c } = useTheme();
  const s = makeStyles(c);
  return (
    <View style={s.header}>
      {onBack ? (
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back" style={s.headerBack} hitSlop={8}>
          <Text style={s.headerBackText}>‹</Text>
        </Pressable>
      ) : (
        <View style={s.headerBack} />
      )}
      <Text style={s.headerTitle} numberOfLines={1} accessibilityRole="header">
        {title}
      </Text>
      <View style={s.headerRight}>{right}</View>
    </View>
  );
}

function makeStyles(c: Colors) {
  return StyleSheet.create({
    pressed: { opacity: 0.6 },
    btn: {
      minHeight: target.min,
      borderRadius: radius.md,
      paddingHorizontal: space.s6,
      alignItems: 'center',
      justifyContent: 'center',
    },
    btnText: { ...t.base, fontFamily: fontFamily.sansSemibold },
    btnDisabled: { opacity: 0.4 },

    card: {
      backgroundColor: c.bgElevated,
      borderRadius: radius.lg,
      borderWidth: hairline,
      borderColor: c.hairline,
      overflow: 'hidden',
    },
    sectionLabel: {
      ...t.xs,
      fontFamily: fontFamily.sansSemibold,
      color: c.fgMuted,
      textTransform: 'uppercase',
      letterSpacing: tracking.wide,
      marginBottom: space.s3,
      marginTop: space.s6,
    },

    row: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: target.min + 8,
      paddingHorizontal: space.s5,
      paddingVertical: space.s4,
      gap: space.s4,
    },
    rowLeading: {},
    rowBody: { flex: 1 },
    rowTitle: { ...t.base, fontFamily: fontFamily.sansMedium, color: c.fg },
    rowSubtitle: { ...t.sm, fontFamily: fontFamily.sans, color: c.fgMuted, marginTop: 1 },
    rowTrailing: { alignItems: 'flex-end' },

    empty: { alignItems: 'center', paddingHorizontal: space.s7, paddingVertical: space.s9 },
    emptyTitle: { ...t.md, fontFamily: fontFamily.sansSemibold, color: c.fg, textAlign: 'center' },
    emptyMessage: { ...t.base, fontFamily: fontFamily.sans, color: c.fgMuted, textAlign: 'center', marginTop: space.s3 },

    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: space.s4,
      paddingVertical: space.s3,
      gap: space.s3,
    },
    headerBack: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    headerBackText: { fontSize: 30, lineHeight: 32, color: c.fg, fontFamily: fontFamily.sans },
    headerTitle: { ...t.md, fontFamily: fontFamily.sansSemibold, color: c.fg, flex: 1 },
    headerRight: { minWidth: 36, alignItems: 'flex-end' },
  });
}
