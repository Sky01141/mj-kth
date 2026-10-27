// オンライン対戦レイヤー。index.html 内のゲーム本体(描画・演出)を再利用し、進行はサーバーに従う。
let ws = null, NET = false, mySeat = 0, names = [], chars = [], hostF = false, room = '', dlAt = 0, cutWho = null, q = Promise.resolve();
const tok = (() => { let t = ''; try { t = localStorage.getItem('mj_tok') || ''; } catch {} if (!t) { t = Math.random().toString(36).slice(2) + Date.now().toString(36); try { localStorage.setItem('mj_tok', t); } catch {} } return t; })();
const rel = s => (s - mySeat + 4) % 4;
const tmEl = document.createElement('span'); tmEl.id = 'tm'; $('hud').appendChild(tmEl);
setInterval(() => { const l = dlAt - Date.now(); tmEl.textContent = NET && l > 0 && (phase == 'pd' || phase == 'ron') ? '⏱' + Math.ceil(l / 1000) + '秒' : ''; }, 250);
const tmr = ms => { dlAt = Date.now() + ms; };

// カットインは選択キャラ／発動したキャラの画像を使う
cut = function (txt, mood, col) { $('cimg').src = mood == 'guide' ? IMG.la : IMG[cutWho || me]; $('ctxt').textContent = txt; $('cut').style.setProperty('--cc', col); scr('cut'); };

// ===== 接続 =====
$('svu').value = (() => { try { return localStorage.getItem('mj_ws') || ''; } catch { return ''; } })() || window.MAHJONG_WS || '';
function wsUrl() {
  const u = $('svu').value.trim();
  if (u) return u;
  if (!location.host) return '';
  return (location.protocol == 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
}
function openWs(create, code) {
  const url = wsUrl();
  if (!url) { $('ons').textContent = 'サーバーURL (wss://…/ws) を入力してください'; return; }
  try { localStorage.setItem('mj_ws', $('svu').value.trim()); } catch {}
  $('ons').textContent = '接続中…（無料のRenderは起動に1分ほどかかります）';
  let w; try { w = new WebSocket(url); } catch { $('ons').textContent = 'サーバーURLが正しくありません'; return; }
  ws = w;
  w.onopen = () => { NET = true; $('ons').textContent = ''; net({ t: create ? 'create' : 'join', code, name: $('pn').value.trim() || 'Player', char: me, token: tok }); };
  w.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } q = q.then(() => onNet(m)).catch(console.error); };
  w.onclose = () => {
    if (ws !== w) return;
    if (room) { say('接続が切れました。再接続中…'); setTimeout(() => ws === w && openWs(false, room), 2000); }
    else $('ons').textContent = $('ons').textContent || '接続できませんでした';
  };
}
const net = m => { if (ws && ws.readyState == 1) ws.send(JSON.stringify(m)); };
$('onl').onclick = () => { $('ov').classList.add('hide'); $('on').classList.remove('hide'); };
$('ob').onclick = () => { $('on').classList.add('hide'); $('ov').classList.remove('hide'); };
$('mk').onclick = () => openWs(true, '');
$('jn').onclick = () => { const c = $('rc').value.trim().toUpperCase(); if (!c) { $('ons').textContent = 'ルームコードを入力してください'; return; } openWs(false, c); };
$('st').onclick = () => net({ t: 'start' });
$('again').onclick = () => { snd(440, .2); NET ? net({ t: 'next' }) : start(); };

// ===== 受信 =====
async function onNet(m) {
  switch (m.t) {
    case 'err': room = ''; $('ons').textContent = m.msg; say(m.msg); break;
    case 'lobby': room = m.code; mySeat = m.you; hostF = m.host; showLobby(m); break;
    case 'deal': return dealNet(m);
    case 'sync': return syncNet(m);
    case 'draw': wall = { length: m.wall }; hud(); if (m.seat == mySeat) myDraw(m); else oppGlow(rel(m.seat)); break;
    case 'discard': return discNet(m);
    case 'ronq': phase = 'ron'; show('bO', 1); show('bP', 1); pend = sendAct; say('ロンできるよ！'); tmr(m.left); break;
    case 'win': return winNet(m);
    case 'ryu': phase = 'over'; resultShow('流局', ['牌山が尽きました']); break;
  }
}
function showLobby(m) {
  $('on1').classList.add('hide'); $('on2').classList.remove('hide');
  $('code').textContent = m.code;
  $('pl').innerHTML = m.players.map(p => `<li>${p.seat == m.you ? '▶ ' : ''}${p.name.replace(/[<>&]/g, '')}（${(CH.find(c => c[0] == p.char) || [0, p.char])[1]}）</li>`).join('');
  $('st').classList.toggle('hide', !m.host);
  $('ons').textContent = m.host ? '友達にコードを共有。空席はCPUが入ります' : 'ホストの開始を待っています…';
}
const sendAct = a => { phase = 'x'; hideBtns(); allowed = null; if (a.type == 'd') net({ t: 'discard', id: a.t.id, rii: !!a.rii }); else net({ t: a.type }); };

function buildOppNet() {
  $('opp').innerHTML = '';
  for (let s = 1; s < 4; s++) {
    const sv = (mySeat + s) % 4, d = document.createElement('div'); d.id = 'o' + s;
    d.innerHTML = `<img src="${IMG[chars[sv]]}" alt=""><span></span>`; d.lastChild.textContent = names[sv];
    $('opp').appendChild(d);
  }
}
function boardNet(m, anim) {
  mySeat = m.you; names = m.names; chars = m.chars; me = chars[mySeat];
  clearBoard(); buildOppNet();
  riichi = !!(m.riichi && m.riichi[mySeat]); drawn = null; phase = 'x'; pend = null;
  H = [[], [], [], []]; river = [[], [], [], []]; wall = { length: m.wall }; dora = { ...m.dora }; hud();
  doraM = mk(dora); doraM.rotation.x = -Math.PI / 2; doraM.scale.setScalar(1.15); doraM.position.set(0, .3, 0); scene.add(doraM);
  H[0] = m.hand.map(t => ({ ...t })); sortH(H[0]);
  H[0].forEach((t, i) => {
    t.m = mk(t); const x = (i - 6) * .86; g4[0].add(t.m);
    if (anim) { t.m.position.set(x, 6 + Math.random() * 4, 6.9); t.m.rotation.set(Math.random() * 3, Math.random() * 3, 0); setTimeout(() => { place(t, x); setTimeout(() => fxLand(t.m), 380); }, i * 80); }
    else { t.m.position.set(x, .62, 6.9); t.m.rotation.x = -.32; t.m.userData.by = .62; }
  });
  for (let s = 1; s < 4; s++) for (let i = 0; i < 13; i++) {
    const b = mk({ k: 0 }, false); b.scale.setScalar(.75); b.position.set((i - 6) * .62, anim ? 5 + Math.random() * 3 : .45, 6.9); g4[s].add(b);
    if (anim) setTimeout(() => mv(b, { y: .45 }, .4), i * 60 + s * 150);
  }
  if (!anim) {
    (m.river || []).forEach((r, sv) => r.forEach((t, i) => { const s = rel(sv), d = { ...t }; d.m = mk(d); const p = rpos(i); d.m.position.set(p.x, p.y, p.z); d.m.rotation.set(-Math.PI / 2, 0, t.rii ? Math.PI / 2 : 0); g4[s].add(d.m); river[s].push(d); }));
    if (riichi) { aura = new THREE.Mesh(new THREE.TorusGeometry(7.4, .06, 8, 80), new THREE.MeshBasicMaterial({ color: 0x19c6ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); aura.rotation.x = -Math.PI / 2; aura.position.y = .5; scene.add(aura); $('vig').classList.add('on'); }
  }
}
async function dealNet(m) {
  ['on', 'ov', 'res'].forEach(i => $(i).classList.add('hide'));
  boardNet(m, true); cutWho = null; cut('配牌', 'guide', '#ffb300'); say('LΛが案内するよ。牌をタップで打牌！'); snd(440, .4, 'triangle', .06);
  await sleep(1900);
}
async function syncNet(m) {
  ['on', 'ov', 'res'].forEach(i => $(i).classList.add('hide'));
  boardNet(m, false); say('再接続しました');
  if (m.result) return onNet(m.result);
  if (m.draw) myDraw({ tile: { ...m.draw }, tsumo: m.tsumo, rii: m.rii, left: 25000 });
  if (m.ronq) { phase = 'ron'; show('bO', 1); show('bP', 1); pend = sendAct; tmr(8000); }
}
function myDraw(m) {
  const t = m.tile; drawn = t; t.m = mk(t); t.m.position.set(6.5, 5, 6.9); g4[0].add(t.m); layout(); snd(660, .1, 'triangle', .05);
  phase = 'pd'; riiOn = false; $('bR').textContent = 'リーチ'; allowed = riichi ? new Set([t.k]) : null;
  riiSet = m.rii ? new Set(m.rii) : null; show('bT', !!m.tsumo); show('bR', !!riiSet && !riichi); pend = sendAct; tmr(m.left);
}
async function discNet(m) {
  const s = rel(m.seat), t = m.tile; let d;
  if (s == 0) {
    d = drawn && drawn.id === t.id ? drawn : H[0].find(x => x.id === t.id);
    if (!d) { d = { ...t }; d.m = mk(d); g4[0].add(d.m); }
    if (d !== drawn) { H[0] = H[0].filter(x => x !== d); if (drawn) { H[0].push(drawn); sortH(H[0]); } }
    drawn = null; layout(); phase = 'x'; hideBtns();
  } else { d = { ...t }; d.m = mk(d); d.m.position.set((Math.random() - .5) * 5, .8, 6.9); g4[s].add(d.m); }
  if (m.rii) { if (s == 0) riichi = true; cutWho = chars[m.seat]; await riichiFx(); cutWho = null; }
  await toRiver(s, d, m.rii);
}
async function winNet(m) {
  phase = 'over'; hideBtns(); cutWho = chars[m.seat]; winFx(m.type); await sleep(2600); cutWho = null;
  const who = m.seat == mySeat ? 'あなた' : names[m.seat];
  resultShow(who + (m.type == 'tsumo' ? 'のツモ和了' : 'のロン和了'), m.L.map(x => `${x[0]}　${x[1]}翻`).concat(['合計 ' + m.han + '翻']));
}
function resultShow(t, l) {
  $('rt').textContent = t; $('rl').innerHTML = l.map(x => `<li>${x}</li>`).join('') + (hostF ? '' : '<li><small>ホストの開始待ち</small></li>');
  $('again').classList.toggle('hide', !hostF); $('res').classList.remove('hide');
}
