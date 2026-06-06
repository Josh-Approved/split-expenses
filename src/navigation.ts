/** Route map for the single native stack. */
export type RootStackParamList = {
  GroupsHome: undefined;
  GroupDetail: { groupId: string };
  AddEditExpense: { groupId: string; expenseId?: string };
  Members: { groupId: string };
  SettleUp: { groupId: string };
  Share: { groupId: string };
  Settings: undefined;
  Acknowledgements: undefined;
};
