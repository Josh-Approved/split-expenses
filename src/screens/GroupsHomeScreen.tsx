/**
 * Groups home — the user's groups, each showing their own net position in
 * plain words. Create a group, or open one. Per-group overflow (rename /
 * duplicate / delete / share) via the cross-platform action menu.
 */

import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Plus, Settings as SettingsIcon, MoreHorizontal } from 'lucide-react-native';

import type { RootStackParamList } from '../navigation';
import { useGroups } from '../store/groups';
import { computeBalances } from '../math/balances';
import { phraseSelfNet, phraseGroupSubtitle, activeMembers } from '../lib/format';
import { useTheme, fontFamily, space, radius, type as t, hairline, type Colors } from '../theme';
import { Avatar, Card, EmptyState, Divider } from '../components/ui';
import { useActionMenu, usePrompt, useConfirm } from '../components/Dialogs';
import { CreateGroupSheet } from '../components/CreateGroupSheet';
import type { Group } from '../data/types';

type Props = NativeStackScreenProps<RootStackParamList, 'GroupsHome'>;

export default function GroupsHomeScreen({ navigation }: Props) {
  const { c } = useTheme();
  const s = makeStyles(c);
  const insets = useSafeAreaInsets();
  const groups = useGroups((st) => st.groups);
  const me = useGroups((st) => st.me);
  const renameGroup = useGroups((st) => st.renameGroup);
  const deleteGroup = useGroups((st) => st.deleteGroup);
  const duplicateGroup = useGroups((st) => st.duplicateGroup);

  const menu = useActionMenu();
  const prompt = usePrompt();
  const confirm = useConfirm();
  const [creating, setCreating] = useState(false);

  const sorted = useMemo(
    () => [...groups].sort((a, b) => b.updatedAt - a.updatedAt),
    [groups],
  );

  const openMenu = (g: Group) => {
    menu.open({
      title: g.name,
      options: [
        {
          label: 'Rename',
          onPress: () =>
            prompt.open({
              title: 'Rename group',
              initialValue: g.name,
              selectAll: true,
              confirmLabel: 'Save',
              onSubmit: (text) => renameGroup(g.id, text),
            }),
        },
        { label: 'Share', onPress: () => navigation.navigate('Share', { groupId: g.id }) },
        { label: 'Duplicate', onPress: () => duplicateGroup(g.id) },
        {
          label: 'Delete',
          destructive: true,
          onPress: () =>
            confirm.open({
              title: `Delete "${g.name}"?`,
              message: 'This removes the group from this device. Anyone you shared it with keeps their copy.',
              confirmLabel: 'Delete',
              destructive: true,
              onConfirm: () => deleteGroup(g.id),
            }),
        },
      ],
    });
  };

  return (
    <View style={[s.screen, { paddingTop: insets.top }]}>
      <View style={s.topbar}>
        <Text style={s.title} accessibilityRole="header">
          Groups
        </Text>
        <Pressable
          onPress={() => navigation.navigate('Settings')}
          accessibilityRole="button"
          accessibilityLabel="Settings"
          hitSlop={8}
          style={({ pressed }) => [s.iconBtn, pressed && s.pressed]}
        >
          <SettingsIcon size={22} color={c.fgMuted} />
        </Pressable>
      </View>

      <FlatList
        data={sorted}
        keyExtractor={(g) => g.id}
        contentContainerStyle={{ padding: space.s5, paddingBottom: insets.bottom + 96 }}
        ListEmptyComponent={
          <EmptyState
            title="No groups yet"
            message="Make a group for a trip, a house, or a couple — then start adding what people pay for."
          />
        }
        renderItem={({ item }) => {
          const meId = me[item.id];
          const members = activeMembers(item);
          const expenseCount = item.expenses.filter((e) => e.deletedAt == null).length;
          let line = phraseGroupSubtitle(members.length, expenseCount);
          let strong = false;
          if (meId) {
            const net = computeBalances(item).get(meId) ?? 0;
            line = phraseSelfNet(net, item.baseCurrency);
            strong = net !== 0;
          }
          return (
            <Card style={{ marginBottom: space.s4 }}>
              <Pressable
                onPress={() => navigation.navigate('GroupDetail', { groupId: item.id })}
                accessibilityRole="button"
                accessibilityLabel={`${item.name}, ${line}`}
                style={({ pressed }) => [s.groupRow, pressed && s.pressed]}
              >
                <View style={s.avatars}>
                  {members.slice(0, 3).map((m, i) => (
                    <View key={m.id} style={{ marginLeft: i === 0 ? 0 : -10 }}>
                      <Avatar name={m.displayName} color={m.color} emoji={m.emoji} size={32} />
                    </View>
                  ))}
                </View>
                <View style={s.groupBody}>
                  <Text style={s.groupName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={[s.groupLine, strong && { color: c.fg, fontFamily: fontFamily.sansMedium }]} numberOfLines={1}>
                    {line}
                  </Text>
                </View>
                <Pressable
                  onPress={() => openMenu(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`More options for ${item.name}`}
                  hitSlop={10}
                  style={({ pressed }) => [s.iconBtn, pressed && s.pressed]}
                >
                  <MoreHorizontal size={20} color={c.fgSubtle} />
                </Pressable>
              </Pressable>
            </Card>
          );
        }}
      />

      <Pressable
        onPress={() => setCreating(true)}
        accessibilityRole="button"
        accessibilityLabel="New group"
        style={({ pressed }) => [s.fab, { bottom: insets.bottom + space.s5 }, pressed && s.pressed]}
      >
        <Plus size={26} color={c.fgOnAccent} />
      </Pressable>

      <CreateGroupSheet
        visible={creating}
        onClose={() => setCreating(false)}
        onCreated={(groupId) => {
          setCreating(false);
          navigation.navigate('GroupDetail', { groupId });
        }}
      />
      {menu.element}
      {prompt.element}
      {confirm.element}
    </View>
  );
}

function makeStyles(c: Colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    pressed: { opacity: 0.6 },
    topbar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: space.s5,
      paddingVertical: space.s4,
    },
    title: { fontSize: 28, lineHeight: 34, fontFamily: fontFamily.sansSemibold, color: c.fg },
    iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },

    groupRow: { flexDirection: 'row', alignItems: 'center', padding: space.s5, gap: space.s4 },
    avatars: { flexDirection: 'row' },
    groupBody: { flex: 1 },
    groupName: { ...t.base, fontFamily: fontFamily.sansSemibold, color: c.fg },
    groupLine: { ...t.sm, fontFamily: fontFamily.sans, color: c.fgMuted, marginTop: 2 },

    fab: {
      position: 'absolute',
      right: space.s5,
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: c.appAccent,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
      elevation: 4,
    },
  });
}
