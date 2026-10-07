// Two-player link: PeerJS (WebRTC data channel) through PeerJS's free cloud
// matchmaker, so no server of our own. The host makes a 4-letter room code; the
// friend types it in to connect straight to the host's browser.

let PeerCls = null;
async function loadPeer() {
  if (!PeerCls) PeerCls = (await import('https://cdn.jsdelivr.net/npm/peerjs@1.5.5/+esm')).default;
  return PeerCls;
}

const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const PREFIX = 'sportshall-tt-';
export const newCode = () => Array.from({ length: 4 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');
export const cleanCode = s => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);

// A link to the other player. `on` handlers: open(), data(msg), close(reason), status(text).
class Link {
  constructor(on) { this.on = on; this.peer = null; this.conn = null; }
  get connected() { return !!this.conn?.open; }
  send(msg) { if (this.conn?.open) { try { this.conn.send(msg); } catch { /* channel closing */ } } }
  _wire(conn) {
    this.conn = conn;
    conn.on('open', () => this.on.open?.());
    conn.on('data', m => this.on.data?.(m));
    conn.on('close', () => { if (this.conn === conn) { this.conn = null; this.on.close?.('The other player left'); } });
    conn.on('error', e => this.on.status?.(`Connection problem: ${e.type || e.message}`));
  }
  close() {
    try { this.conn?.close(); } catch { /* already closed */ }
    try { this.peer?.destroy(); } catch { /* already gone */ }
    this.conn = null; this.peer = null;
  }
}

// Host a game. Resolves with { link, code } once the room is open.
export async function hostGame(on, tries = 3) {
  const Peer = await loadPeer();
  const link = new Link(on);
  for (let i = 0; i < tries; i++) {
    const code = newCode();
    try {
      await new Promise((resolve, reject) => {
        const peer = new Peer(PREFIX + code.toLowerCase(), { debug: 0 });
        link.peer = peer;
        peer.on('open', resolve);
        peer.on('error', e => reject(e));
        peer.on('connection', conn => {
          if (link.connected) { conn.on('open', () => { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 300); }); return; }
          link._wire(conn);
        });
        peer.on('disconnected', () => { try { peer.reconnect(); } catch { /* destroyed */ } });
      });
      link.code = code;
      return { link, code };
    } catch (e) {
      try { link.peer?.destroy(); } catch { /* ignore */ }
      if (e?.type !== 'unavailable-id' || i === tries - 1) throw new Error(e?.type === 'network' || e?.type === 'server-error' ? 'Can\'t reach the matchmaking server. Check the internet connection.' : (e?.message || String(e)));
    }
  }
  throw new Error('Couldn\'t make a room');
}

// Join a friend's game by code. Resolves with the link once connected.
export async function joinGame(code, on, timeoutMs = 15000) {
  const Peer = await loadPeer();
  const link = new Link(on);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('No answer. Check the code, and that your friend still has the room open.')), timeoutMs);
    const peer = new Peer({ debug: 0 });
    link.peer = peer;
    peer.on('error', e => {
      clearTimeout(timer);
      reject(new Error(e?.type === 'peer-unavailable' ? `No game with code ${code}. Check the code on your friend's screen.` : e?.type === 'network' ? 'Can\'t reach the matchmaking server. Check the internet connection.' : (e?.message || String(e))));
    });
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + code.toLowerCase(), { serialization: 'json', reliable: true });
      const done = link.on.open;
      link.on = { ...link.on, open: () => { clearTimeout(timer); resolve(); done?.(); } };
      link._wire(conn);
    });
  });
  return link;
}
