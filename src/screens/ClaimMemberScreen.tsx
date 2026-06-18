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
import { useTheme, fontFamily, space, radius, target, type as ty, hairline, type Colors } from '../theme';
import { Avatar } from '../components/ui';
import { usePrompt } from '../components/Dialogs';
import { t } from '../i18n';

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
  // `change` mode = the deliberate "Change who I am" correction (reached from
  // Members), so we must NOT auto-skip even though "me" is already set.
  const change = route.params.change === true;

  // On join, if "me" is already set (e.g. a group you created, or a re-pair),
  // skip straight in. Never skip in change mode.
  useEffect(() => {
    if (meId && !change) navigation.replace('GroupDetail', { groupId });
  }, [meId, change, groupId, navigation]);

  // Join lands you in the group; an explicit change just returns you back.
  const done = () => (change ? navigation.goBack() : navigation.replace('GroupDetail', { groupId }));

  const claim = (memberId: string) => {
    setMe(groupId, memberId);
    done();
  };

  const addSelf = () =>
    prompt.open({
      title: t('claim.addSelfTitle'),
      placeholder: t('claim.yourName'),
      confirmLabel: t('common.add'),
      autoCapitalize: 'words',
      onSubmit: (name) => {
        const id = addMember(groupId, name);
        setMe(groupId, id);
        done();
      },
    });

  return (
    <View style={[s.screen, { paddingTop: insets.top + space.s5 }]}>
      <Text style={s.title} accessibilityRole="header">
        {change ? t('claim.changeTitle') : t('claim.whichTitle')}
      </Text>
      <Text style={s.subtitle}>
        {t('claim.subtitle', { group: group?.name ?? t('group.thisGroup') })}
      </Text>

      {members.length === 0 ? (
        <View style={s.loading}>
          <ActivityIndicator color={c.appAccent} />
          <Text style={s.loadingText}>{t('claim.loading')}</Text>
          <Pressable onPress={addSelf} accessibilityRole="button" style={({ pressed }) => [s.ghostBtn, pressed && { opacity: 0.6 }]}>
            <Text style={s.ghostText}>{t('claim.someoneNew')}</Text>
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
              accessibilityLabel={t('claim.imA11y', { name: item.displayName })}
              style={({ pressed }) => [s.row, pressed && { opacity: 0.6 }]}
            >
              <Avatar name={item.displayName} color={item.color} emoji={item.emoji} size={40} />
              <Text style={s.rowName}>{item.displayName}</Text>
              {item.id === meId ? <Text style={s.youNow}>{t('claim.youNow')}</Text> : null}
            </Pressable>
          )}
          ListFooterComponent={
            <Pressable onPress={addSelf} accessibilityRole="button" style={({ pressed }) => [s.newRow, pressed && { opacity: 0.6 }]}>
              <Text style={s.newRowText}>{t('claim.someoneNew')}</Text>
            </Pressable>
          }
        />
      )}

      <Pressable onPress={done} accessibilityRole="button" style={({ pressed }) => [s.skip, pressed && { opacity: 0.6 }]}>
        <Text style={s.skipText}>{change ? t('common.cancel') : t('claim.skip')}</Text>
      </Pressable>
      {prompt.element}
    </View>
  );
}

function makeStyles(c: Colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg, paddingHorizontal: space.s6 },
    title: { fontSize: 26, lineHeight: 32, fontFamily: fontFamily.sansSemibold, color: c.fg },
    subtitle: { ...ty.base, fontFamily: fontFamily.sans, color: c.fgMuted, marginTop: space.s3 },
    loading: { alignItems: 'center', justifyContent: 'center', flex: 1, gap: space.s5 },
    loadingText: { ...ty.base, fontFamily: fontFamily.sans, color: c.fgMuted },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.s4,
      minHeight: target.min + 12,
      paddingVertical: space.s4,
      borderBottomWidth: hairline,
      borderBottomColor: c.hairline,
    },
    rowName: { ...ty.md, fontFamily: fontFamily.sansMedium, color: c.fg, flex: 1 },
    youNow: {
      ...ty.xs,
      fontFamily: fontFamily.sansSemibold,
      color: c.appAccent,
      backgroundColor: c.appAccentBg,
      paddingHorizontal: space.s3,
      paddingVertical: 2,
      borderRadius: radius.pill,
      overflow: 'hidden',
    },
    newRow: { minHeight: target.min, justifyContent: 'center', paddingVertical: space.s5 },
    newRowText: { ...ty.base, fontFamily: fontFamily.sansSemibold, color: c.appAccent },
    ghostBtn: { minHeight: target.min, justifyContent: 'center', paddingHorizontal: space.s6 },
    ghostText: { ...ty.base, fontFamily: fontFamily.sansSemibold, color: c.appAccent },
    skip: { alignSelf: 'center', minHeight: target.min, justifyContent: 'center', paddingBottom: space.s4 },
    skipText: { ...ty.base, fontFamily: fontFamily.sans, color: c.fgSubtle },
  });
}
