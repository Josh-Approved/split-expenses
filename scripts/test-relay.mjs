// One-shot end-to-end verification of the shared-sync "drop box" path.
//
// Spins up two peers (alice, bob) that rendezvous through the same public
// Nostr relays the app ships with, using the same TweetNaCl-secretbox
// encryption and the same Nostr event shape. Bob publishes one encrypted
// message; alice should receive + decrypt it within seconds. Proves the
// transport+crypto round-trip works against real infrastructure, without
// needing two devices.
//
// Local-only (in .git/info/exclude). Run: `node scripts/test-relay.mjs`.

import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';

const { encodeBase64, decodeBase64, encodeUTF8, decodeUTF8 } = naclUtil;

const RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.nostr.band',
  'wss://nostr.mom',
];
const KIND = 20001;

function newSecret() {
  return encodeBase64(nacl.randomBytes(32));
}
function keyFromSecret(secret) {
  return nacl.hash(decodeBase64(secret)).slice(0, nacl.secretbox.keyLength);
}
function channelId(secret) {
  return encodeBase64(nacl.hash(decodeBase64(secret)).slice(32, 48));
}
function seal(secret, plaintext) {
  const key = keyFromSecret(secret);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const box = nacl.secretbox(decodeUTF8(plaintext), nonce, key);
  const out = new Uint8Array(nonce.length + box.length);
  out.set(nonce);
  out.set(box, nonce.length);
  return encodeBase64(out);
}
function open(secret, sealed) {
  const key = keyFromSecret(secret);
  const raw = decodeBase64(sealed);
  const nonce = raw.slice(0, nacl.secretbox.nonceLength);
  const box = raw.slice(nacl.secretbox.nonceLength);
  const plain = nacl.secretbox.open(box, nonce, key);
  return plain ? encodeUTF8(plain) : null;
}

class Peer {
  constructor(name, channel, onMsg) {
    this.name = name;
    this.channel = channel;
    this.onMsg = onMsg;
    this.priv = sha256(nacl.randomBytes(32));
    this.pub = bytesToHex(schnorr.getPublicKey(this.priv));
    this.subId = 's' + Math.random().toString(36).slice(2, 10);
    this.sockets = [];
    this.openRelays = new Set();
    this.seen = new Set();
    this.mine = new Set();
  }
  start() {
    for (const url of RELAYS) this.connect(url);
  }
  connect(url) {
    const ws = new WebSocket(url);
    this.sockets.push(ws);
    ws.addEventListener('open', () => {
      this.openRelays.add(url);
      console.log(`  [${this.name}] connected ${url}`);
      const since = Math.floor(Date.now() / 1000) - 120;
      ws.send(
        JSON.stringify([
          'REQ',
          this.subId,
          { kinds: [KIND], '#t': [this.channel], since },
        ])
      );
    });
    ws.addEventListener('message', (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (!Array.isArray(msg)) return;
      if (msg[0] === 'OK' && msg[2] === false) {
        console.log(`  [${this.name}] ${url} rejected event: ${msg[3]}`);
        return;
      }
      if (msg[0] !== 'EVENT') return;
      const ev = msg[2];
      if (!ev || ev.kind !== KIND) return;
      if (this.seen.has(ev.id) || this.mine.has(ev.id)) return;
      const tagged = ev.tags?.some((t) => t[0] === 't' && t[1] === this.channel);
      if (!tagged) return;
      this.seen.add(ev.id);
      this.onMsg(ev.content, url);
    });
    ws.addEventListener('error', () => {
      console.log(`  [${this.name}] error ${url}`);
    });
    ws.addEventListener('close', () => {
      this.openRelays.delete(url);
    });
  }
  publish(ciphertext) {
    const created_at = Math.floor(Date.now() / 1000);
    const tags = [['t', this.channel]];
    const serial = JSON.stringify([
      0,
      this.pub,
      created_at,
      KIND,
      tags,
      ciphertext,
    ]);
    const idBytes = sha256(utf8ToBytes(serial));
    const id = bytesToHex(idBytes);
    const sig = bytesToHex(schnorr.sign(idBytes, this.priv));
    this.mine.add(id);
    const ev = {
      id,
      pubkey: this.pub,
      created_at,
      kind: KIND,
      tags,
      content: ciphertext,
      sig,
    };
    const frame = JSON.stringify(['EVENT', ev]);
    let sent = 0;
    for (const ws of this.sockets) {
      if (ws.readyState === 1) {
        try {
          ws.send(frame);
          sent++;
        } catch {
          /* one drop is fine; another relay carries it */
        }
      }
    }
    return sent;
  }
  close() {
    for (const ws of this.sockets) {
      try {
        ws.close();
      } catch {
        /* already closing */
      }
    }
  }
}

async function main() {
  const secret = newSecret();
  const ch = channelId(secret);
  console.log('secret    :', secret);
  console.log('channel   :', ch);
  console.log('relays    :', RELAYS.join(', '));
  console.log('');

  let received = null;
  let receivedVia = null;
  const startedAt = Date.now();

  const alice = new Peer('alice', ch, (ct, via) => {
    if (received) return;
    const plain = open(secret, ct);
    if (!plain) {
      console.log(`  [alice] DECRYPT FAILED on payload from ${via}`);
      return;
    }
    received = plain;
    receivedVia = via;
    console.log(
      `  [alice] received via ${via} after ${Date.now() - startedAt}ms`
    );
  });
  const bob = new Peer('bob', ch, () => {});

  console.log('connecting...');
  alice.start();
  bob.start();

  // wait for some open sockets on bob's side
  const connectDeadline = Date.now() + 6000;
  while (bob.openRelays.size < 2 && Date.now() < connectDeadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log('');
  console.log(`bob open relays  : ${bob.openRelays.size} / ${RELAYS.length}`);
  console.log(`alice open relays: ${alice.openRelays.size} / ${RELAYS.length}`);

  // A realistic shared-group payload — the same JSON shape the engine seals,
  // with the local-only `receiptUri` already stripped from the expense.
  const expected = JSON.stringify({
    id: 'g-test',
    name: 'Trip to Lisbon',
    baseCurrency: 'USD',
    members: [
      { id: 'm1', displayName: 'Alice', createdAt: 1, updatedAt: 1 },
      { id: 'm2', displayName: 'Bob', createdAt: 1, updatedAt: 1 },
    ],
    expenses: [
      {
        id: 'e1',
        description: 'Dinner',
        amount: 5400,
        currency: 'EUR',
        rate: 1.08,
        payers: [{ memberId: 'm1', amount: 5400 }],
        splitMethod: 'equal',
        splits: [{ memberId: 'm1', value: 0 }, { memberId: 'm2', value: 0 }],
        category: 'food',
        date: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    settlements: [],
    shareIdentity: { secret, createdAt: 1 },
    createdAt: 1,
    updatedAt: 1,
    nonce: new Date().toISOString(),
  });
  console.log('');
  console.log(`bob publishing a sealed group (${expected.length} bytes plaintext)`);
  const ct = seal(secret, expected);
  const sent = bob.publish(ct);
  console.log(`bob published to ${sent} relays`);
  console.log('');
  console.log('waiting up to 15s for alice...');

  const deadline = Date.now() + 15000;
  while (!received && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }

  alice.close();
  bob.close();

  console.log('');
  if (received === expected) {
    console.log('===========================================================');
    console.log('  RELAY ROUND-TRIP VERIFIED');
    console.log(`  alice received bob's encrypted group via ${receivedVia}`);
    const g = JSON.parse(received);
    console.log(`  decrypted group: "${g.name}" with ${g.expenses.length} expense(s)`);
    console.log('===========================================================');
    process.exit(0);
  } else if (received) {
    console.log('UNEXPECTED PLAINTEXT (replay from a previous run?):');
    console.log(`  expected: "${expected}"`);
    console.log(`  received: "${received}"`);
    process.exit(2);
  } else {
    console.log('NO MESSAGE RECEIVED within 15s after publish.');
    console.log('Possible causes: all relays rejected the event kind,');
    console.log('rate-limited, or filtered by tag — try a different kind /');
    console.log('add another relay.');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
