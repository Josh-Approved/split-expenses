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

import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Linking, Share } from 'react-native';
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
import { paymentOptions, buildReminderMessage } from '../lib/payments';
import { useTheme, fontFamily, space, radius, type as ty, hairline, type Colors } from '../theme';
import { EmptyState, SectionLabel } from '../components/ui';
import { useActionMenu } from '../components/Dialogs';
import { t } from '../i18n';
import ReviewModal from '../components/ReviewModal';
import { recordSuccessfulCompletion } from '../storage/reviewPrompt';
import { IOS_APP_STORE_ID, ANDROID_PACKAGE } from '../lib/links';

type Props = NativeStackScreenProps<RootStackParamList, 'SettleUp'>;

export default function SettleUpScreen({ navigation, route }: Props) {
  const { groupId } = route.params;
  const { c } = useTheme();
  const s = makeStyles(c);
  const insets = useSafeAreaInsets();

  const group = useGroups((st) => st.groups.find((g) => g.id === groupId));
  const meId = useGroups((st) => st.me[groupId]);

  const menu = useActionMenu();
  const [reviewVisible, setReviewVisible] = useState(false);

  if (!group) {
    return (
      <View style={[s.screen, { paddingTop: insets.top }]}>
        <Topbar c={c} s={s} onBack={() => navigation.goBack()} />
        <EmptyState title={t('group.notFound')} />
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
        ? t('settle.noSettlements')
        : sum.settled > 0
          ? t('settle.paidOut', { amount: formatMoney(sum.settled, base) })
          : t('settle.received', { amount: formatMoney(-sum.settled, base) });
    const netPhrase =
      sum.net === 0
        ? t('settle.settledUp')
        : sum.net > 0
          ? t('settle.owedAmount', { amount: formatMoney(sum.net, base) })
          : t('settle.owesAmount', { amount: formatMoney(-sum.net, base) });
    menu.open({
      title: t('settle.workTitle', {
        name,
        paid: formatMoney(sum.paid, base),
        share: formatMoney(sum.share, base),
        settled: settledPhrase,
        net: netPhrase,
      }),
      options: [{ label: t('common.done'), onPress: () => {} }],
    });
  };

  /** Open the settle options for one planned payment. */
  const showSettle = (transfer: Transfer) => {
    const recipient = memberById(group, transfer.to);
    const fromName = transfer.from === meId ? t('settle.you') : memberName(group, transfer.from);
    const toName = transfer.to === meId ? t('settle.youLower') : memberName(group, transfer.to);

    const writeSettlement = (method: 'cash' | 'external') => {
      useGroups.getState().addSettlement(groupId, {
        fromMember: transfer.from,
        toMember: transfer.to,
        amount: transfer.amount,
        currency: base,
        rate: 1,
        method,
        date: Date.now(),
      });
      // Recording a settle-up is this app's genuine, satisfying success — the
      // canonical review prompt's only trigger here (never on launch/error).
      recordSuccessfulCompletion()
        .then((show) => {
          if (show) setReviewVisible(true);
        })
        .catch(() => {});
    };

    const iOwe = transfer.from === meId;
    const owedToMe = transfer.to === meId;

    const options = [];

    // Someone owes ME → I can nudge them from my own Messages app (the app
    // sends nothing; it hands a prefilled draft to the OS share sheet).
    if (owedToMe) {
      options.push({
        label: t('settle.askToPay', { name: memberName(group, transfer.from) }),
        onPress: () => {
          const message = buildReminderMessage({
            debtorName: memberName(group, transfer.from),
            groupName: group.name,
            amount: formatMoney(transfer.amount, base),
            handles: memberById(group, meId)?.handles,
          });
          Share.share({ message }).catch(() => {});
        },
      });
    }

    options.push({ label: t('settle.markCash'), onPress: () => writeSettlement('cash') });

    // The pay-with hand-offs only make sense when *I'm* the one paying; they
    // open the recipient's app prefilled. (Never shown when someone owes me.)
    if (iOwe) {
      for (const opt of paymentOptions(recipient?.handles, transfer.amount, base, group.name)) {
        options.push({
          label: opt.label,
          onPress: () => {
            Linking.openURL(opt.url).catch(() => Linking.openURL(opt.fallbackUrl).catch(() => {}));
            writeSettlement('external');
          },
        });
      }
    }

    menu.open({
      title: t('settle.transferTitle', {
        from: fromName,
        to: toName,
        amount: formatMoney(transfer.amount, base),
      }),
      options,
    });
  };

  return (
    <View style={[s.screen, { paddingTop: insets.top }]}>
      <Topbar c={c} s={s} onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={{ padding: space.s5, paddingBottom: insets.bottom + space.s8 }}>
        {/* ---- Balances ------------------------------------------------ */}
        <SectionLabel>{t('settle.balances')}</SectionLabel>
        <View style={s.group}>
          {members.map((m, i) => {
            const net = balances.get(m.id) ?? 0;
            const isMe = m.id === meId;
            const name = isMe ? t('settle.you') : m.displayName;
            const status =
              net === 0
                ? t('settle.settledUp')
                : net > 0
                  ? isMe
                    ? t('settle.owedYou', { amount: formatMoney(net, base) })
                    : t('settle.owedOther', { amount: formatMoney(net, base) })
                  : isMe
                    ? t('settle.owesYou', { amount: formatMoney(-net, base) })
                    : t('settle.owesOther', { amount: formatMoney(-net, base) });
            return (
              <Pressable
                key={m.id}
                onPress={() => showWork(m.id)}
                accessibilityRole="button"
                accessibilityLabel={t('settle.balanceRowA11y', { name, status })}
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
        <Text style={s.hint}>{t('settle.balanceHint')}</Text>

        {/* ---- The plan ------------------------------------------------ */}
        <SectionLabel>{t('settle.fewestPayments')}</SectionLabel>
        {plan.length === 0 ? (
          <EmptyState title={t('group.allSettledUp')} message={t('settle.noPaymentsNeeded')} />
        ) : (
          <View style={s.group}>
            {plan.map((tr, i) => {
              const fromName = tr.from === meId ? t('settle.you') : memberName(group, tr.from);
              const toName = tr.to === meId ? t('settle.you') : memberName(group, tr.to);
              return (
                <Pressable
                  key={`${tr.from}-${tr.to}-${i}`}
                  onPress={() => showSettle(tr)}
                  accessibilityRole="button"
                  accessibilityLabel={t('settle.planRowA11y', { from: fromName, to: toName, amount: formatMoney(tr.amount, base) })}
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

      <ReviewModal
        visible={reviewVisible}
        onDismiss={() => setReviewVisible(false)}
        appName="Split Expenses"
        iosAppStoreId={IOS_APP_STORE_ID}
        androidPackageName={ANDROID_PACKAGE}
      />
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
      <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel={t('common.back')} hitSlop={8} style={s.iconBtn}>
        <Text style={s.backChevron}>‹</Text>
      </Pressable>
      <Text style={s.topTitle} numberOfLines={1} accessibilityRole="header">
        {t('settle.title')}
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
    topTitle: { ...ty.md, fontFamily: fontFamily.sansSemibold, color: c.fg, flex: 1 },

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
    balanceName: { ...ty.base, fontFamily: fontFamily.sansMedium, color: c.fg, flex: 1 },
    balanceStatus: { ...ty.base, fontFamily: fontFamily.sansMedium, textAlign: 'right' },

    hint: { ...ty.sm, fontFamily: fontFamily.sans, color: c.fgMuted, marginTop: space.s3, paddingHorizontal: space.s2 },

    planRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.s4,
      paddingHorizontal: space.s5,
      paddingVertical: space.s4,
      minHeight: 52,
    },
    planPeople: { ...ty.base, fontFamily: fontFamily.sans, color: c.fg, flex: 1 },
    planFrom: { fontFamily: fontFamily.sansMedium, color: c.fg },
    planArrow: { color: c.fgMuted },
    planTo: { fontFamily: fontFamily.sansMedium, color: c.fg },
    planAmount: { ...ty.base, fontFamily: fontFamily.sansSemibold, color: c.fg },
  });
}
