/**
 * "Which one are you?" — shown right after joining a shared group. The joiner
 * CLAIMS an existing member the organizer already entered, instead of silently
 * adding a duplicate (the thing that splits a balance across two of the same
 * person). Adding yourself as someone new is the secondary path.
 *
 * A joined group starts empty and fills in as it syncs from peers, so this
 * screen waits for the member list to arrive before asking.
 */

import React, { useEffect } from 'react';
import { View, Text, FlatList, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation';
import { useGroups } from '../store/groups';
import { activeMembers } from '../lib/format';
import { useTheme, fontFamily, space, radius, target, type as t, hairline, type Colors } from '../theme';
import { Avatar } from '../components/ui';
import { usePrompt } from '../components/Dialogs';

type Props = NativeStackScreenProps<RootStackParamList, 'ClaimMember'>;

export default function ClaimMemberScreen({ navigation, route }: Props) {
  const { groupId } = route.params;
  const { c } = useTheme();
  const s = makeStyles(c);
  const insets = useSafeAreaInsets();

  const group = useGroups((st) => st.groups.find((g) => g.id === groupId));
  const meId = useGroups((st) => st.me[groupId]);
  const setMe = useGroups((st) => st.setMe);
  const addMember = useGroups((st) => st.addMember);
  const prompt = usePrompt();

  const members = group ? activeMembers(group) : [];

  // If "me" is already set (e.g. a group you created), skip straight in.
  useEffect(() => {
    if (meId) navigation.replace('GroupDetail', { groupId });
  }, [meId, groupId, navigation]);

  const goToGroup = () => navigation.replace('GroupDetail', { groupId });

  const claim = (memberId: string) => {
    setMe(groupId, memberId);
    goToGroup();
  };

  const addSelf = () =>
    prompt.open({
      title: 'Add yourself',
      placeholder: 'Your name',
      confirmLabel: 'Add',
      autoCapitalize: 'words',
      onSubmit: (name) => {
        const id = addMember(groupId, name);
        setMe(groupId, id);
        goToGroup();
      },
    });

  return (
    <View style={[s.screen, { paddingTop: insets.top + space.s5 }]}>
      <Text style={s.title} accessibilityRole="header">
        Which one are you?
      </Text>
      <Text style={s.subtitle}>
        Pick yourself from the people in {group?.name ?? 'this group'} so your balance is yours. Tap the wrong one? You can change it later.
      </Text>

      {members.length === 0 ? (
        <View style={s.loading}>
          <ActivityIndicator color={c.appAccent} />
          <Text style={s.loadingText}>Getting the group from the others…</Text>
          <Pressable onPress={addSelf} accessibilityRole="button" style={({ pressed }) => [s.ghostBtn, pressed && { opacity: 0.6 }]}>
            <Text style={s.ghostText}>I’m someone new</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={members}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ paddingTop: space.s5, paddingBottom: insets.bottom + space.s7 }}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => claim(item.id)}
              accessibilityRole="button"
              accessibilityLabel={`I'm ${item.displayName}`}
              style={({ pressed }) => [s.row, pressed && { opacity: 0.6 }]}
            >
              <Avatar name={item.displayName} color={item.color} emoji={item.emoji} size={40} />
              <Text style={s.rowName}>{item.displayName}</Text>
            </Pressable>
          )}
          ListFooterComponent={
            <Pressable onPress={addSelf} accessibilityRole="button" style={({ pressed }) => [s.newRow, pressed && { opacity: 0.6 }]}>
              <Text style={s.newRowText}>I’m someone new</Text>
            </Pressable>
          }
        />
      )}

      <Pressable onPress={goToGroup} accessibilityRole="button" style={({ pressed }) => [s.skip, pressed && { opacity: 0.6 }]}>
        <Text style={s.skipText}>Skip for now</Text>
      </Pressable>
      {prompt.element}
    </View>
  );
}

function makeStyles(c: Colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg, paddingHorizontal: space.s6 },
    title: { fontSize: 26, lineHeight: 32, fontFamily: fontFamily.sansSemibold, color: c.fg },
    subtitle: { ...t.base, fontFamily: fontFamily.sans, color: c.fgMuted, marginTop: space.s3 },
    loading: { alignItems: 'center', justifyContent: 'center', flex: 1, gap: space.s5 },
    loadingText: { ...t.base, fontFamily: fontFamily.sans, color: c.fgMuted },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.s4,
      minHeight: target.min + 12,
      paddingVertical: space.s4,
      borderBottomWidth: hairline,
      borderBottomColor: c.hairline,
    },
    rowName: { ...t.md, fontFamily: fontFamily.sansMedium, color: c.fg },
    newRow: { minHeight: target.min, justifyContent: 'center', paddingVertical: space.s5 },
    newRowText: { ...t.base, fontFamily: fontFamily.sansSemibold, color: c.appAccent },
    ghostBtn: { minHeight: target.min, justifyContent: 'center', paddingHorizontal: space.s6 },
    ghostText: { ...t.base, fontFamily: fontFamily.sansSemibold, color: c.appAccent },
    skip: { alignSelf: 'center', minHeight: target.min, justifyContent: 'center', paddingBottom: space.s4 },
    skipText: { ...t.base, fontFamily: fontFamily.sans, color: c.fgSubtle },
  });
}
