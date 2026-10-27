// 雀華 オンライン対戦サーバー (Node.js + ws)。サーバー権威型: 牌山・配牌・合法性・和了判定はすべてここで行う。
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const PORT = process.env.PORT || 3000;
const ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean); // 空なら全許可
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const CHARS = ['lux', 'noctics', 'shirogane', 'vesper'];
const NAMES = { lux: 'Lux', noctics: 'Noctics', shirogane: 'Shirogane', vesper: 'Vesper' };
const J = JSON.stringify;

// ===== ルール (クライアントと同一ロジック) =====
const cnt = tl => { const c = Array(34).fill(0); for (const t of tl) c[t.k]++; return c; };
function mel(c, i = 0) {
  while (i < 34 && !c[i]) i++;
  if (i >= 34) return true;
  if (c[i] >= 3) { c[i] -= 3; const r = mel(c, i); c[i] += 3; if (r) return true; }
  if (i < 27 && i % 9 < 7 && c[i + 1] && c[i + 2]) { c[i]--; c[i + 1]--; c[i + 2]--; const r = mel(c, i); c[i]++; c[i + 1]++; c[i + 2]++; if (r) return true; }
  return false;
}
function isWin(c) {
  let p = 0; for (let i = 0; i < 34; i++) if (c[i] == 2) p++;
  if (p == 7) return 1;
  for (let i = 0; i < 34; i++) if (c[i] >= 2) { c[i] -= 2; const r = mel(c); c[i] += 2; if (r) return 2; }
  return 0;
}
function tenpaiD(c) {
  const s = new Set();
  for (let k = 0; k < 34; k++) if (c[k]) { c[k]--; for (let w = 0; w < 34; w++) if (c[w] < 4) { c[w]++; if (isWin(c)) s.add(k); c[w]--; } c[k]++; }
  return s;
}
const doraK = k => k < 27 ? (k % 9 == 8 ? k - 8 : k + 1) : k < 31 ? 27 + (k - 26) % 4 : 31 + (k - 30) % 3;
const sortH = a => a.sort((x, y) => x.k - y.k || y.red - x.red);

class Room {
  constructor(code) { this.code = code; this.seats = [null, null, null, null]; this.phase = 'lobby'; this.host = -1; this.t = null; this.result = null; this.empty = Date.now(); }
  send(i, m) { const s = this.seats[i]; if (s && s.ws && s.ws.readyState == 1) s.ws.send(J(m)); }
  all(m) { for (let i = 0; i < 4; i++) this.send(i, m); }
  clr() { clearTimeout(this.t); }
  info() { return { names: this.seats.map(s => s.name), chars: this.seats.map(s => s.char) }; }
  connected() { return this.seats.some(s => s && !s.cpu && s.ws); }
  lobby() {
    const players = this.seats.map((s, i) => s && { seat: i, name: s.name, char: s.char }).filter(Boolean);
    for (let i = 0; i < 4; i++) this.send(i, { t: 'lobby', code: this.code, you: i, host: i == this.host, players });
  }
  join(ws, name, char, token) {
    let i = this.seats.findIndex(s => s && s.token === token);
    if (i < 0) {
      if (this.phase != 'lobby') return ws.send(J({ t: 'err', msg: '対局中のルームには参加できません' }));
      i = this.seats.findIndex(s => !s);
      if (i < 0) return ws.send(J({ t: 'err', msg: 'ルームが満員です' }));
      this.seats[i] = { token, name, char, ws };
      if (this.host < 0) this.host = i;
    }
    const s = this.seats[i];
    if (s.ws && s.ws !== ws) try { s.ws.close(); } catch {}
    s.ws = ws; s.name = name;
    if (this.phase == 'lobby') s.char = char;
    ws.room = this; ws.seat = i;
    if (this.phase == 'lobby') this.lobby(); else this.sync(i);
  }
  leave(ws) {
    const s = this.seats[ws.seat];
    if (!s || s.ws !== ws) return;
    s.ws = null;
    if (this.phase == 'lobby') {
      this.seats[ws.seat] = null;
      if (this.host == ws.seat) this.host = this.seats.findIndex(x => x && !x.cpu);
      this.lobby();
    }
    if (!this.connected()) this.empty = Date.now();
  }
  start() {
    this.clr(); this.result = null;
    const used = new Set();
    for (let i = 0; i < 4; i++) { const s = this.seats[i]; if (s) { if (used.has(s.char) || !CHARS.includes(s.char)) s.char = null; else used.add(s.char); } }
    for (let i = 0; i < 4; i++) {
      let s = this.seats[i];
      if (!s) s = this.seats[i] = { cpu: true, token: null, ws: null };
      if (!s.char) { s.char = CHARS.find(c => !used.has(c)); used.add(s.char); }
      if (s.cpu) s.name = NAMES[s.char];
    }
    const w = []; let id = 0;
    for (let k = 0; k < 34; k++) for (let c = 0; c < 4; c++) w.push({ id: id++, k, red: c == 0 && (k == 4 || k == 13 || k == 22) });
    for (let i = w.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [w[i], w[j]] = [w[j], w[i]]; }
    this.wall = w;
    this.H = [0, 1, 2, 3].map(() => sortH(w.splice(-13)));
    this.dora = w.pop(); this.river = [[], [], [], []]; this.riichi = [0, 0, 0, 0];
    this.turn = 0; this.drawn = null; this.phase = 'play';
    for (let i = 0; i < 4; i++) this.send(i, { t: 'deal', you: i, hand: this.H[i], dora: this.dora, wall: w.length, ...this.info() });
    this.t = setTimeout(() => this.next(), 3500);
  }
  yaku(i, tl, type) {
    const c = cnt(tl), L = [];
    if (this.riichi[i]) L.push(['立直', 1]);
    if (type == 'tsumo') L.push(['門前清自摸和', 1]);
    if (tl.every(t => t.k < 27 && t.k % 9 > 0 && t.k % 9 < 8)) L.push(['断么九', 1]);
    if (isWin(c) == 1) L.push(['七対子', 2]);
    const ok = L.length > 0, dk = doraK(this.dora.k);
    const d = tl.filter(t => t.k == dk).length, a = tl.filter(t => t.red).length;
    if (d) L.push(['ドラ', d]); if (a) L.push(['赤ドラ', a]);
    return { L, ok, han: L.reduce((s, x) => s + x[1], 0) };
  }
  next() {
    if (this.phase != 'play') return;
    if (!this.wall.length) return this.over({ t: 'ryu' });
    const s = this.turn, t = this.wall.pop(); this.drawn = t;
    const c = cnt([...this.H[s], t]), w = !!isWin(c);
    let rs = null;
    if (!this.riichi[s]) { const set = tenpaiD(c); if (set.size) rs = [...set]; }
    this.tsumoOk = w; this.riiSet = rs;
    for (let i = 0; i < 4; i++) this.send(i, i == s ? { t: 'draw', seat: s, tile: t, wall: this.wall.length, tsumo: w, rii: rs, left: 25000 } : { t: 'draw', seat: s, wall: this.wall.length });
    const p = this.seats[s];
    if (p.cpu || !p.ws) {
      this.t = setTimeout(() => { if (w && p.cpu) return this.win(s, 'tsumo', [...this.H[s], t]); this.discard(s, this.cpuPick(s, t), false); }, 800);
    } else {
      this.t = setTimeout(() => this.discard(s, t, false), this.riichi[s] && !w ? 900 : 25000); // 持ち時間切れ・リーチ後はツモ切り
    }
  }
  cpuPick(s, t) {
    const pool = [...this.H[s], t], w = pool.map(x => x.k >= 27 ? 3 : (x.k % 9 == 0 || x.k % 9 == 8 ? 2 : 1));
    let r = Math.random() * w.reduce((a, b) => a + b), i = 0;
    while ((r -= w[i]) > 0) i++;
    return pool[Math.min(i, pool.length - 1)];
  }
  discard(s, d, rii) {
    this.clr();
    if (d !== this.drawn) { this.H[s] = this.H[s].filter(x => x !== d); this.H[s].push(this.drawn); sortH(this.H[s]); }
    this.drawn = null;
    if (rii) this.riichi[s] = 1;
    this.river[s].push({ ...d, rii: !!rii });
    this.all({ t: 'discard', seat: s, tile: d, rii: !!rii });
    const el = new Set();
    for (let i = 0; i < 4; i++) {
      const p = this.seats[i];
      if (i == s || !p || p.cpu || !p.ws) continue;
      const c = cnt(this.H[i]); c[d.k]++;
      if (isWin(c) && this.yaku(i, [...this.H[i], d], 'ron').ok) el.add(i);
    }
    if (el.size) {
      this.phase = 'ron'; this.ron = { el, tile: d, from: s };
      for (const i of el) this.send(i, { t: 'ronq', tile: d, from: s, left: 8000 });
      this.t = setTimeout(() => this.adv(), 8000);
    } else this.adv();
  }
  adv() { this.clr(); this.phase = 'play'; this.turn = (this.turn + 1) % 4; this.t = setTimeout(() => this.next(), 550); }
  win(s, type, tl, from = null) {
    const y = this.yaku(s, tl, type);
    this.over({ t: 'win', seat: s, type, from, tiles: tl.map(x => ({ k: x.k, red: x.red })), L: y.L, han: y.han });
  }
  over(m) { this.clr(); this.phase = 'over'; this.result = m; this.all(m); }
  sync(i) {
    const m = { t: 'sync', you: i, phase: this.phase, hand: this.H[i], wall: this.wall.length, dora: this.dora, riichi: this.riichi, river: this.river, result: this.result, ...this.info() };
    if (this.phase == 'play' && this.turn == i && this.drawn) { m.draw = this.drawn; m.tsumo = this.tsumoOk; m.rii = this.riiSet; }
    if (this.phase == 'ron' && this.ron.el.has(i)) m.ronq = this.ron.tile;
    this.send(i, m);
  }
  act(i, m) {
    switch (m.t) {
      case 'start': if (i == this.host && this.phase == 'lobby') this.start(); break;
      case 'next': if (i == this.host && this.phase == 'over') this.start(); break;
      case 'discard': {
        if (this.phase != 'play' || this.turn != i || !this.drawn) break;
        const d = [...this.H[i], this.drawn].find(t => t.id === m.id);
        if (!d) break;
        if (this.riichi[i] && d !== this.drawn) break;
        let rii = false;
        if (m.rii && !this.riichi[i]) { if (!this.riiSet || !this.riiSet.includes(d.k)) break; rii = true; }
        this.discard(i, d, rii); break;
      }
      case 'tsumo': if (this.phase == 'play' && this.turn == i && this.drawn && this.tsumoOk) this.win(i, 'tsumo', [...this.H[i], this.drawn]); break;
      case 'ron': if (this.phase == 'ron' && this.ron.el.has(i)) { const r = this.ron; this.win(i, 'ron', [...this.H[i], r.tile], r.from); } break;
      case 'pass': if (this.phase == 'ron' && this.ron.el.delete(i) && !this.ron.el.size) this.adv(); break;
    }
  }
}

// ===== HTTP + WebSocket =====
const rooms = new Map();
const srv = http.createServer((q, r) => {
  if (q.url == '/healthz') { r.end('ok'); return; }
  let p = decodeURIComponent(q.url.split('?')[0]);
  if (p == '/') p = '/index.html';
  const f = path.normalize(path.join(DIR, p));
  if (!f.startsWith(DIR) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; r.end('not found'); return; }
  r.setHeader('content-type', MIME[path.extname(f)] || 'application/octet-stream');
  fs.createReadStream(f).pipe(r);
});
const wss = new WebSocketServer({ server: srv, path: '/ws', maxPayload: 4096 });
wss.on('connection', (ws, req) => {
  if (ORIGINS.length && !ORIGINS.includes(req.headers.origin)) return ws.close(1008, 'origin');
  ws.alive = true; ws.on('pong', () => ws.alive = true);
  ws.on('message', d => {
    let m; try { m = JSON.parse(d); } catch { return; }
    if (!m || typeof m.t != 'string') return;
    if (m.t == 'create' || m.t == 'join') {
      const name = String(m.name || 'Player').slice(0, 12), token = String(m.token || '').slice(0, 64), char = CHARS.includes(m.char) ? m.char : 'lux';
      if (!token) return;
      let code = String(m.code || '').toUpperCase().slice(0, 6), room;
      if (m.t == 'create') {
        do { code = Math.random().toString(36).slice(2, 6).toUpperCase(); } while (rooms.has(code));
        room = new Room(code); rooms.set(code, room);
      } else {
        room = rooms.get(code);
        if (!room) return ws.send(J({ t: 'err', msg: 'ルームが見つかりません' }));
      }
      if (ws.room) return;
      room.join(ws, name, char, token);
    } else if (ws.room) ws.room.act(ws.seat, m);
  });
  ws.on('close', () => ws.room && ws.room.leave(ws));
});
setInterval(() => { for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; ws.ping(); } }, 25000);
setInterval(() => { for (const [c, r] of rooms) if (!r.connected() && Date.now() - r.empty > 5 * 60 * 1000) { r.clr(); rooms.delete(c); } }, 60000);
srv.listen(PORT, () => console.log('mahjong server on :' + PORT));
