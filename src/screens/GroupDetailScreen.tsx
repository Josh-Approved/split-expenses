/**
 * Group detail — the core screen. A prominent balance header (the device's own
 * net in plain words), a Settle-up entry point, a clean reverse-chronological
 * expense feed, and a big, obvious Add-expense action. Fast is the whole game.
 */

import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as LucideIcons from 'lucide-react-native';
import { Plus, Users, Share2, MoreHorizontal } from 'lucide-react-native';

import type { RootStackParamList } from '../navigation';
import { useGroups } from '../store/groups';
import { computeBalances } from '../math/balances';
import { computeOwed, computePaid } from '../math/split';
import { formatMoney } from '../data/money';
import { category } from '../data/categories';
import { phraseSelfNet, memberName, activeMembers, formatDate } from '../lib/format';
import { exportGroupCsv } from '../lib/csv';
import { useTheme, fontFamily, space, radius, type as t, hairline, type Colors } from '../theme';
import { Avatar, EmptyState } from '../components/ui';
import { useActionMenu, usePrompt, useConfirm } from '../components/Dialogs';
import { CurrencyPicker } from '../components/CurrencyPicker';
import type { Expense, Group } from '../data/types';

type Props = NativeStackScreenProps<RootStackParamList, 'GroupDetail'>;

export default function GroupDetailScreen({ navigation, route }: Props) {
  const { groupId } = route.params;
  const { c } = useTheme();
  const s = makeStyles(c);
  const insets = useSafeAreaInsets();

  const group = useGroups((st) => st.groups.find((g) => g.id === groupId));
  const meId = useGroups((st) => st.me[groupId]);
  const renameGroup = useGroups((st) => st.renameGroup);
  const setBaseCurrency = useGroups((st) => st.setBaseCurrency);
  const deleteGroup = useGroups((st) => st.deleteGroup);

  const menu = useActionMenu();
  const prompt = usePrompt();
  const confirm = useConfirm();
  const [pickingCurrency, setPickingCurrency] = useState(false);

  const expenses = useMemo(
    () =>
      group
        ? group.expenses.filter((e) => e.deletedAt == null).sort((a, b) => b.date - a.date || b.createdAt - a.createdAt)
        : [],
    [group],
  );

  if (!group) {
    return (
      <View style={[s.screen, { paddingTop: insets.top }]}>
        <EmptyState title="Group not found" />
      </View>
    );
  }

  const balances = computeBalances(group);
  const selfNet = meId ? balances.get(meId) ?? 0 : null;
  const anyOwed = [...balances.values()].some((v) => v !== 0);

  const openMenu = () => {
    menu.open({
      title: group.name,
      options: [
        { label: 'Members', onPress: () => navigation.navigate('Members', { groupId }) },
        { label: 'Share group', onPress: () => navigation.navigate('Share', { groupId }) },
        {
          label: 'Rename group',
          onPress: () =>
            prompt.open({ title: 'Rename group', initialValue: group.name, selectAll: true, onSubmit: (txt) => renameGroup(groupId, txt) }),
        },
        { label: 'Change currency', onPress: () => setPickingCurrency(true) },
        { label: 'Export expenses (CSV)', onPress: () => void exportGroupCsv(group) },
        {
          label: 'Delete group',
          destructive: true,
          onPress: () =>
            confirm.open({
              title: `Delete "${group.name}"?`,
              message: 'Removes it from this device. Anyone you shared with keeps their copy.',
              confirmLabel: 'Delete',
              destructive: true,
              onConfirm: () => {
                deleteGroup(groupId);
                navigation.goBack();
              },
            }),
        },
      ],
    });
  };

  return (
    <View style={[s.screen, { paddingTop: insets.top }]}>
      <View style={s.topbar}>
        <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Back" hitSlop={8} style={s.iconBtn}>
          <Text style={s.backChevron}>‹</Text>
        </Pressable>
        <Text style={s.topTitle} numberOfLines={1} accessibilityRole="header">
          {group.name}
        </Text>
        <View style={s.topActions}>
          <Pressable onPress={() => navigation.navigate('Members', { groupId })} accessibilityRole="button" accessibilityLabel="Members" hitSlop={8} style={s.iconBtn}>
            <Users size={20} color={c.fgMuted} />
          </Pressable>
          <Pressable onPress={() => navigation.navigate('Share', { groupId })} accessibilityRole="button" accessibilityLabel="Share group" hitSlop={8} style={s.iconBtn}>
            <Share2 size={20} color={c.fgMuted} />
          </Pressable>
          <Pressable onPress={openMenu} accessibilityRole="button" accessibilityLabel="More options" hitSlop={8} style={s.iconBtn}>
            <MoreHorizontal size={20} color={c.fgMuted} />
          </Pressable>
        </View>
      </View>

      {/* Balance header */}
      <Pressable
        onPress={() => meId && navigation.navigate('SettleUp', { groupId })}
        accessibilityRole="button"
        accessibilityLabel={selfNet != null ? phraseSelfNet(selfNet, group.baseCurrency) : 'Set who you are to see your balance'}
        style={s.balanceHeader}
      >
        {meId ? (
          <>
            <Text style={[s.balanceAmount, selfNet === 0 ? { color: c.fgMuted } : selfNet! > 0 ? { color: c.accent } : { color: c.fg }]}>
              {selfNet === 0 ? 'All settled up' : formatMoney(Math.abs(selfNet!), group.baseCurrency)}
            </Text>
            {selfNet !== 0 ? <Text style={s.balanceCaption}>{selfNet! > 0 ? "you're owed" : 'you owe'}</Text> : null}
          </>
        ) : (
          <Pressable onPress={() => navigation.navigate('ClaimMember', { groupId })} style={s.claimPrompt} accessibilityRole="button">
            <Text style={s.claimText}>Tap to choose which person is you</Text>
          </Pressable>
        )}
      </Pressable>

      {anyOwed ? (
        <Pressable onPress={() => navigation.navigate('SettleUp', { groupId })} accessibilityRole="button" accessibilityLabel="Settle up" style={({ pressed }) => [s.settleBtn, pressed && { opacity: 0.6 }]}>
          <Text style={s.settleBtnText}>Settle up</Text>
        </Pressable>
      ) : null}

      <FlatList
        data={expenses}
        keyExtractor={(e) => e.id}
        contentContainerStyle={{ padding: space.s5, paddingBottom: insets.bottom + 96 }}
        ListEmptyComponent={
          <EmptyState title="No expenses yet" message="Add the first thing someone paid for. Splitting is two taps from here." />
        }
        renderItem={({ item }) => (
          <ExpenseRow group={group} expense={item} c={c} s={s} onPress={() => navigation.navigate('AddEditExpense', { groupId, expenseId: item.id })} />
        )}
      />

      <Pressable
        onPress={() => navigation.navigate('AddEditExpense', { groupId })}
        accessibilityRole="button"
        accessibilityLabel="Add expense"
        style={({ pressed }) => [s.fab, { bottom: insets.bottom + space.s5 }, pressed && { opacity: 0.85 }]}
      >
        <Plus size={22} color={c.inkButtonText} />
        <Text style={s.fabText}>Add expense</Text>
      </Pressable>

      <CurrencyPicker visible={pickingCurrency} selected={group.baseCurrency} onPick={(code) => setBaseCurrency(groupId, code)} onClose={() => setPickingCurrency(false)} />
      {menu.element}
      {prompt.element}
      {confirm.element}
    </View>
  );
}

function ExpenseRow({
  group,
  expense,
  c,
  s,
  onPress,
}: {
  group: Group;
  expense: Expense;
  c: Colors;
  s: ReturnType<typeof makeStyles>;
  onPress: () => void;
}) {
  const cat = category(expense.category);
  const Icon = (LucideIcons as any)[cat.icon] ?? LucideIcons.Receipt;
  const payerNames = expense.payers.map((p) => memberName(group, p.memberId)).join(', ');
  const splitCount = expense.splits.length;
  const sub = `${payerNames || 'Someone'} paid · split ${splitCount} way${splitCount === 1 ? '' : 's'}`;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${expense.description}, ${formatMoney(expense.amount, expense.currency)}`} style={({ pressed }) => [s.expenseRow, pressed && { opacity: 0.6 }]}>
      <View style={[s.catBadge, { backgroundColor: c.appAccentBg }]}>
        <Icon size={18} color={c.appAccent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.expenseTitle} numberOfLines={1}>
          {expense.description || cat.label}
        </Text>
        <Text style={s.expenseSub} numberOfLines={1}>
          {sub} · {formatDate(expense.date)}
        </Text>
      </View>
      <Text style={s.expenseAmount}>{formatMoney(expense.amount, expense.currency)}</Text>
    </Pressable>
  );
}

function makeStyles(c: Colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    backChevron: { fontSize: 30, lineHeight: 32, color: c.fg, fontFamily: fontFamily.sans },
    topbar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.s4, paddingVertical: space.s3, gap: space.s2 },
    topTitle: { ...t.md, fontFamily: fontFamily.sansSemibold, color: c.fg, flex: 1 },
    topActions: { flexDirection: 'row' },

    balanceHeader: { alignItems: 'center', paddingTop: space.s5, paddingBottom: space.s4 },
    balanceAmount: { fontSize: 40, lineHeight: 46, fontFamily: fontFamily.sansSemibold, letterSpacing: -0.5 },
    balanceCaption: { ...t.base, fontFamily: fontFamily.sans, color: c.fgMuted, marginTop: 2 },
    claimPrompt: { paddingVertical: space.s4 },
    claimText: { ...t.base, fontFamily: fontFamily.sansMedium, color: c.appAccent },

    settleBtn: { alignSelf: 'center', borderWidth: hairline, borderColor: c.hairlineStrong, borderRadius: radius.pill, paddingHorizontal: space.s6, height: 40, alignItems: 'center', justifyContent: 'center', marginBottom: space.s4 },
    settleBtnText: { ...t.sm, fontFamily: fontFamily.sansSemibold, color: c.fg },

    expenseRow: { flexDirection: 'row', alignItems: 'center', gap: space.s4, paddingVertical: space.s4, borderBottomWidth: hairline, borderBottomColor: c.hairline },
    catBadge: { width: 38, height: 38, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
    expenseTitle: { ...t.base, fontFamily: fontFamily.sansMedium, color: c.fg },
    expenseSub: { ...t.sm, fontFamily: fontFamily.sans, color: c.fgMuted, marginTop: 1 },
    expenseAmount: { ...t.base, fontFamily: fontFamily.sansSemibold, color: c.fg },

    fab: {
      position: 'absolute',
      alignSelf: 'center',
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.s3,
      backgroundColor: c.inkButton,
      borderRadius: radius.pill,
      paddingHorizontal: space.s6,
      height: 52,
      shadowColor: c.fg,
      shadowOpacity: 0.12,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
      elevation: 4,
    },
    fabText: { ...t.base, fontFamily: fontFamily.sansSemibold, color: c.inkButtonText },
  });
}
