/**
 * Settle up — the second core screen. Two reads and one action:
 *  1. Balances: where everyone stands, in plain words, every row tappable to
 *     show the arithmetic behind it (paid · share · settlements → net).
 *  2. The plan: the fewest payments that clear every debt. Tapping a payment
 *     offers "mark as paid in cash" plus a hand-off to the recipient's own
 *     payment app (Venmo / PayPal / Cash App) — we open the link and record a
 *     settlement; we never move or hold money.
 *
 * Everything is derived live from the store, so the moment a settlement is
 * written the balances and plan recompute (this screen subscribes to the
 * group). Numbers are computed in the group's base currency.
 */

import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation';
import { useGroups } from '../store/groups';
import {
  computeBalances,
  computeSettlement,
  computeMemberSummary,
  type Transfer,
} from '../math/balances';
import { formatMoney } from '../data/money';
import { memberName, memberById, activeMembers } from '../lib/format';
import { paymentOptions } from '../lib/payments';
import { useTheme, fontFamily, space, radius, type as t, hairline, type Colors } from '../theme';
import { EmptyState, SectionLabel } from '../components/ui';
import { useActionMenu } from '../components/Dialogs';

type Props = NativeStackScreenProps<RootStackParamList, 'SettleUp'>;

export default function SettleUpScreen({ navigation, route }: Props) {
  const { groupId } = route.params;
  const { c } = useTheme();
  const s = makeStyles(c);
  const insets = useSafeAreaInsets();

  const group = useGroups((st) => st.groups.find((g) => g.id === groupId));
  const meId = useGroups((st) => st.me[groupId]);

  const menu = useActionMenu();

  if (!group) {
    return (
      <View style={[s.screen, { paddingTop: insets.top }]}>
        <Topbar c={c} s={s} onBack={() => navigation.goBack()} />
        <EmptyState title="Group not found" />
      </View>
    );
  }

  const base = group.baseCurrency;
  const members = activeMembers(group);
  const balances = computeBalances(group);
  const plan = computeSettlement(balances);

  /** Open the "show its work" derivation for a member's balance. */
  const showWork = (memberId: string) => {
    const sum = computeMemberSummary(group, memberId);
    const name = memberName(group, memberId);
    const settledPhrase =
      sum.settled === 0
        ? 'no settlements'
        : sum.settled > 0
          ? `paid out ${formatMoney(sum.settled, base)}`
          : `received ${formatMoney(-sum.settled, base)}`;
    const netPhrase =
      sum.net === 0
        ? 'settled up'
        : sum.net > 0
          ? `owed ${formatMoney(sum.net, base)}`
          : `owes ${formatMoney(-sum.net, base)}`;
    menu.open({
      title: `${name}\nPaid ${formatMoney(sum.paid, base)} · share ${formatMoney(
        sum.share,
        base,
      )} · ${settledPhrase}  →  ${netPhrase}`,
      options: [{ label: 'Done', onPress: () => {} }],
    });
  };

  /** Open the settle options for one planned payment. */
  const showSettle = (transfer: Transfer) => {
    const recipient = memberById(group, transfer.to);
    const fromName = transfer.from === meId ? 'You' : memberName(group, transfer.from);
    const toName = transfer.to === meId ? 'you' : memberName(group, transfer.to);

    const writeSettlement = (method: 'cash' | 'external') =>
      useGroups.getState().addSettlement(groupId, {
        fromMember: transfer.from,
        toMember: transfer.to,
        amount: transfer.amount,
        currency: base,
        rate: 1,
        method,
        date: Date.now(),
      });

    const options = [
      {
        label: 'Mark as paid in cash',
        onPress: () => writeSettlement('cash'),
      },
      // Only the recipient's shared handles produce hand-off rows; if they
      // shared none, the array is empty and only "cash" shows.
      ...paymentOptions(recipient?.handles, transfer.amount, base, group.name).map((opt) => ({
        label: opt.label,
        onPress: () => {
          // We never move money — just open the recipient's app prefilled,
          // then record that the user marked this transfer settled.
          Linking.openURL(opt.url).catch(() => Linking.openURL(opt.fallbackUrl).catch(() => {}));
          writeSettlement('external');
        },
      })),
    ];

    menu.open({
      title: `${fromName} → ${toName}   ${formatMoney(transfer.amount, base)}`,
      options,
    });
  };

  return (
    <View style={[s.screen, { paddingTop: insets.top }]}>
      <Topbar c={c} s={s} onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={{ padding: space.s5, paddingBottom: insets.bottom + space.s8 }}>
        {/* ---- Balances ------------------------------------------------ */}
        <SectionLabel>Balances</SectionLabel>
        <View style={s.group}>
          {members.map((m, i) => {
            const net = balances.get(m.id) ?? 0;
            const isMe = m.id === meId;
            const name = isMe ? 'You' : m.displayName;
            const status =
              net === 0
                ? 'settled up'
                : net > 0
                  ? `${isMe ? "you're" : 'is'} owed ${formatMoney(net, base)}`
                  : `${isMe ? 'you owe' : 'owes'} ${formatMoney(-net, base)}`;
            return (
              <Pressable
                key={m.id}
                onPress={() => showWork(m.id)}
                accessibilityRole="button"
                accessibilityLabel={`${name} ${status}. Tap to see how this is figured.`}
                style={({ pressed }) => [
                  s.balanceRow,
                  i > 0 && s.rowBorder,
                  pressed && s.pressed,
                ]}
              >
                <Text style={s.balanceName} numberOfLines={1}>
                  {name}
                </Text>
                <Text
                  style={[
                    s.balanceStatus,
                    net === 0 ? { color: c.fgMuted } : net > 0 ? { color: c.accent } : { color: c.fg },
                  ]}
                >
                  {status}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={s.hint}>Tap a person to see how their balance is figured.</Text>

        {/* ---- The plan ------------------------------------------------ */}
        <SectionLabel>The fewest payments to settle up</SectionLabel>
        {plan.length === 0 ? (
          <EmptyState title="All settled up" message="No payments needed." />
        ) : (
          <View style={s.group}>
            {plan.map((tr, i) => {
              const fromName = tr.from === meId ? 'You' : memberName(group, tr.from);
              const toName = tr.to === meId ? 'You' : memberName(group, tr.to);
              return (
                <Pressable
                  key={`${tr.from}-${tr.to}-${i}`}
                  onPress={() => showSettle(tr)}
                  accessibilityRole="button"
                  accessibilityLabel={`${fromName} pays ${toName} ${formatMoney(tr.amount, base)}. Tap to settle.`}
                  style={({ pressed }) => [
                    s.planRow,
                    i > 0 && s.rowBorder,
                    pressed && s.pressed,
                  ]}
                >
                  <Text style={s.planPeople} numberOfLines={1}>
                    <Text style={s.planFrom}>{fromName}</Text>
                    <Text style={s.planArrow}>{'  →  '}</Text>
                    <Text style={s.planTo}>{toName}</Text>
                  </Text>
                  <Text style={s.planAmount}>{formatMoney(tr.amount, base)}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>

      {menu.element}
    </View>
  );
}

function Topbar({
  c,
  s,
  onBack,
}: {
  c: Colors;
  s: ReturnType<typeof makeStyles>;
  onBack: () => void;
}) {
  return (
    <View style={s.topbar}>
      <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back" hitSlop={8} style={s.iconBtn}>
        <Text style={s.backChevron}>‹</Text>
      </Pressable>
      <Text style={s.topTitle} numberOfLines={1} accessibilityRole="header">
        Settle up
      </Text>
      <View style={s.iconBtn} />
    </View>
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

    group: {
      backgroundColor: c.bgElevated,
      borderRadius: radius.lg,
      borderWidth: hairline,
      borderColor: c.hairline,
      overflow: 'hidden',
    },
    rowBorder: { borderTopWidth: hairline, borderTopColor: c.hairline },

    balanceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.s4,
      paddingHorizontal: space.s5,
      paddingVertical: space.s4,
      minHeight: 52,
    },
    balanceName: { ...t.base, fontFamily: fontFamily.sansMedium, color: c.fg, flex: 1 },
    balanceStatus: { ...t.base, fontFamily: fontFamily.sansMedium, textAlign: 'right' },

    hint: { ...t.sm, fontFamily: fontFamily.sans, color: c.fgSubtle, marginTop: space.s3, paddingHorizontal: space.s2 },

    planRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.s4,
      paddingHorizontal: space.s5,
      paddingVertical: space.s4,
      minHeight: 52,
    },
    planPeople: { ...t.base, fontFamily: fontFamily.sans, color: c.fg, flex: 1 },
    planFrom: { fontFamily: fontFamily.sansMedium, color: c.fg },
    planArrow: { color: c.fgSubtle },
    planTo: { fontFamily: fontFamily.sansMedium, color: c.fg },
    planAmount: { ...t.base, fontFamily: fontFamily.sansSemibold, color: c.fg },
  });
}
