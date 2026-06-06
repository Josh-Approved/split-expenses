/**
 * Manual export / import — the canon "Backup & restore" Layer 3 guarantee.
 *
 * A shared trip re-syncs from other members, but a solo group lives only on
 * this device. A backup is the user's own copy: a single JSON file they can
 * save anywhere and bring back later (or onto a new phone). No account, no
 * server — the file is theirs.
 *
 * The export strips `receiptUri` from every expense: those are local-only file
 * paths (see data/types.ts) that won't resolve on another device, so carrying
 * them into a portable file would only dangle.
 */

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';

import type { Group } from '../data/types';
import { useGroups } from '../store/groups';

const APP_TAG = 'split-expenses';
const ENVELOPE_VERSION = 1;

interface BackupEnvelope {
  app: typeof APP_TAG;
  version: number;
  exportedAt: number;
  groups: Group[];
}

/** A group with every local-only field stripped (matches the sync wire form):
 *  receipt photos are local file paths that don't travel in a portable file. */
function stripLocalOnly(group: Group): Group {
  return {
    ...group,
    expenses: group.expenses.map(({ receiptUri, ...rest }) => rest),
  };
}

function dateStamp(): string {
  // Local date, file-name safe — used only for the suggested filename.
  return new Date().toISOString().slice(0, 10);
}

/**
 * Serialize every group to a pretty-printed JSON envelope, write it to a temp
 * file, and present the system share sheet so the user can save it anywhere.
 */
export async function exportAllGroups(): Promise<void> {
  const groups = useGroups.getState().groups.map(stripLocalOnly);
  const envelope: BackupEnvelope = {
    app: APP_TAG,
    version: ENVELOPE_VERSION,
    exportedAt: Date.now(),
    groups,
  };

  const file = new File(Paths.cache, `split-expenses-backup-${dateStamp()}.json`);
  if (file.exists) file.delete();
  file.create();
  file.write(JSON.stringify(envelope, null, 2));

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/json',
      dialogTitle: 'Save your backup',
      UTI: 'public.json',
    });
  }
}

function isValidEnvelope(value: unknown): value is BackupEnvelope {
  if (!value || typeof value !== 'object') return false;
  const env = value as Record<string, unknown>;
  return env.app === APP_TAG && Array.isArray(env.groups);
}

/**
 * Let the user pick a backup file, validate it, and import its groups with
 * FRESH ids (a copy — never a silent overwrite; see store importGroups).
 * Returns the imported count, or a calm error string. Never throws.
 */
export async function importGroupsFromFile(): Promise<{ count: number } | { error: string }> {
  let result: DocumentPicker.DocumentPickerResult;
  try {
    result = await DocumentPicker.getDocumentAsync({
      type: 'application/json',
      copyToCacheDirectory: true,
    });
  } catch {
    return { error: "Couldn't open that file. Try again." };
  }

  if (result.canceled) return { count: 0 };

  const asset = result.assets?.[0];
  if (!asset) return { count: 0 };

  let text: string;
  try {
    text = await new File(asset.uri).text();
  } catch {
    return { error: "Couldn't read that file." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "That doesn't look like a Split Expenses backup." };
  }

  if (!isValidEnvelope(parsed)) {
    return { error: "That doesn't look like a Split Expenses backup." };
  }

  const count = useGroups.getState().importGroups(parsed.groups);
  return { count };
}
