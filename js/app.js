// ---------------------------------------------
// ZöldNyom — állapot és perzisztencia (localStorage)
// ---------------------------------------------
const STORAGE_KEY = 'zoldnyom_state_v1';

const STAGES = [
  { min: 0,   name: 'Mag' },
  { min: 20,  name: 'Csíra' },
  { min: 150, name: 'Hajtás' },
  { min: 350, name: 'Fiatal fa' },
  { min: 700, name: 'Erdőjáró' }
];

const BADGE_DEFS = [
  { id: 'first',   ic: '🥇', name: 'Első jelentés', check: (s) => s.history.length >= 1 },
  { id: 'streak3', ic: '🔥', name: '3 napos sorozat', check: (s) => currentStreak(s) >= 3 },
  { id: 'ten',     ic: '♻️', name: '10 szemét', check: (s) => s.history.length >= 10 },
  { id: 'tree',    ic: '🌳', name: 'Fiatal fa szint', check: (s) => s.points >= 350 },
  { id: 'forest',  ic: '🌲', name: 'Erdőjáró szint', check: (s) => s.points >= 700 },
  { id: 'top3',    ic: '🏆', name: 'Top 3 hetente', check: () => false } // szerver nélkül nem eldönthető, jövőbeli funkció
];

function defaultState() {
  return {
    name: 'Te',
    joined: new Date().toISOString(),
    points: 0,
    history: [] // { id, label, icon, pts, photo (dataURL thumb), lat, lon, ts }
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return Object.assign(defaultState(), parsed);
  } catch (e) {
    console.warn('Állapot betöltése sikertelen, alapértelmezett állapot használata.', e);
    return defaultState();
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Állapot mentése sikertelen (pl. betelt a tárhely).', e);
  }
}

function currentStreak(s) {
  if (!s.history.length) return 0;
  const days = new Set(s.history.map(h => new Date(h.ts).toDateString()));
  let streak = 0;
  let d = new Date();
  while (days.has(d.toDateString())) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

let state = loadState();

// ---------------------------------------------
// Szint / haladás logika
// ---------------------------------------------
function stageIndex(points) {
  let idx = 0;
  STAGES.forEach((s, i) => { if (points >= s.min) idx = i; });
  return idx;
}

// ---------------------------------------------
// Navigáció
// ---------------------------------------------
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}

function switchTab(id, btn) {
  showPage(id);
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  stopCamera();
  if (id === 'page-home') renderHome();
  if (id === 'page-rank') renderRank();
  if (id === 'page-profile') renderProfile();
}

function goHome() {
  switchTab('page-home', document.querySelector('.nav-btn[data-nav="page-home"]'));
}

function goScan() {
  report = { photoThumb: null, foundLat: null, foundLon: null, disposeLat: null, disposeLon: null };
  const frame = document.getElementById('cam-frame');
  frame.innerHTML =
    '<div class="cam-placeholder" id="cam-placeholder">📷<br>Érintsd meg a kamera bekapcsolásához</div>' +
    '<div class="cam-corner cc-tl"></div><div class="cam-corner cc-tr"></div><div class="cam-corner cc-bl"></div><div class="cam-corner cc-br"></div>';
  showPage('page-scan1');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  enableCamera();
}

// ---------------------------------------------
// Jelentés folyamat (fotó -> felvétel -> GPS -> pont)
// ---------------------------------------------
let report = { photoThumb: null, foundLat: null, foundLon: null, disposeLat: null, disposeLon: null };
let stream = null;

async function enableCamera() {
  const frame = document.getElementById('cam-frame');
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const placeholder = document.getElementById('cam-placeholder');
    if (placeholder) placeholder.remove();
    const video = document.createElement('video');
    video.autoplay = true; video.playsInline = true; video.muted = true;
    video.srcObject = stream;
    frame.prepend(video);
  } catch (e) {
    const placeholder = document.getElementById('cam-placeholder');
    if (placeholder) {
      placeholder.innerHTML = '📷<br>Nincs kameraengedély<br><span style="opacity:.65">Engedélyezd a böngésző beállításaiban</span>';
    }
  }
  // közben a helyszínt is rögzítjük diszkréten, a "találás" pillanatában
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => { report.foundLat = pos.coords.latitude; report.foundLon = pos.coords.longitude; },
      () => {},
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }
}

function stopCamera() {
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
}

function capturePhoto() {
  const frame = document.getElementById('cam-frame');
  const video = frame.querySelector('video');
  if (video && video.videoWidth) {
    const canvas = document.createElement('canvas');
    // kicsinyített, tárhely-barát méret
    const targetW = 480;
    const ratio = video.videoHeight / video.videoWidth;
    canvas.width = targetW;
    canvas.height = Math.round(targetW * ratio);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    report.photoThumb = canvas.toDataURL('image/jpeg', 0.7);
    stopCamera();
  } else {
    report.photoThumb = null; // nincs kamera-engedély, demó módban folytatjuk fotó nélkül
  }
  showPage('page-scan2');
  const previewFrame = document.getElementById('scan2-preview');
  previewFrame.innerHTML = report.photoThumb
    ? `<img src="${report.photoThumb}" alt="Rögzített fotó">`
    : '<div class="cam-placeholder" style="font-size:44px;">✅</div>';
}

function toRad(v) { return (v * Math.PI) / 180; }
function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function startGPS() {
  const statusEl = document.getElementById('gps-status');
  const coordsEl = document.getElementById('gps-coords');
  const distEl = document.getElementById('gps-distance');
  const btn = document.getElementById('gps-confirm-btn');
  statusEl.textContent = 'Helymeghatározás folyamatban…';
  coordsEl.textContent = '— , —';
  distEl.textContent = '';
  btn.disabled = true;

  if (!navigator.geolocation) {
    statusEl.textContent = 'A böngésző nem támogatja a helymeghatározást';
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      report.disposeLat = pos.coords.latitude;
      report.disposeLon = pos.coords.longitude;
      coordsEl.textContent = report.disposeLat.toFixed(5) + ', ' + report.disposeLon.toFixed(5);
      statusEl.textContent = 'Helyszín rögzítve ✓';
      if (report.foundLat != null) {
        const d = Math.round(distanceMeters(report.foundLat, report.foundLon, report.disposeLat, report.disposeLon));
        distEl.textContent = 'Kb. ' + d + ' méterre a fotózás helyétől';
      }
      btn.disabled = false;
    },
    (err) => {
      statusEl.textContent = 'Nem sikerült rögzíteni a helyet — próbáld újra';
      coordsEl.textContent = err.message;
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

function finishReport() {
  const pts = 25;
  state.points += pts;
  state.history.unshift({
    id: 'r_' + Date.now(),
    label: 'Szemét — bejelentve',
    icon: '🗑️',
    pts,
    photo: report.photoThumb,
    lat: report.disposeLat,
    lon: report.disposeLon,
    ts: new Date().toISOString()
  });
  saveState();
  document.getElementById('earned-pts-label').textContent = '+' + pts;
  showPage('page-success');
}

// ---------------------------------------------
// Renderelés
// ---------------------------------------------
function renderHome() {
  document.getElementById('pts-display').textContent = state.points;
  document.getElementById('stat-count').textContent = state.history.length;
  document.getElementById('stat-streak').textContent = currentStreak(state);

  const idx = stageIndex(state.points);
  const stage = STAGES[idx];
  document.getElementById('lvl-name').textContent = stage.name;
  const next = STAGES[idx + 1];
  const fillEl = document.getElementById('progress-fill');
  const noteEl = document.getElementById('progress-note');
  if (next) {
    const span = next.min - stage.min;
    const prog = Math.min(100, Math.round(((state.points - stage.min) / span) * 100));
    fillEl.style.width = prog + '%';
    noteEl.textContent = (next.min - state.points) + ' pont a következő szintig: ' + next.name;
  } else {
    fillEl.style.width = '100%';
    noteEl.textContent = 'Elérted a legmagasabb szintet — Erdőjáró!';
  }
  ['leaf-l1', 'leaf-r1', 'leaf-l2'].forEach((id, i) => {
    document.getElementById(id).style.opacity = idx >= i + 1 ? 1 : (i === 0 ? 1 : 0.15);
  });

  const list = document.getElementById('recent-list');
  if (!state.history.length) {
    list.innerHTML = '<div class="empty-note">Még nincs jelentésed. Nyomd meg a "Szemetet találtam" gombot, hogy elkezdd!</div>';
  } else {
    list.innerHTML = state.history.slice(0, 3).map(h => `
      <div class="nearby-item">
        <div class="dot">${h.icon}</div>
        <div class="txt"><b>${h.label}</b><span>${new Date(h.ts).toLocaleString('hu-HU')}</span></div>
        <div class="pt">+${h.pts}</div>
      </div>
    `).join('');
  }
}

function renderRank() {
  // Statikus demó-mezőnyök (MVP-ben nincs szerver, ezért csak illusztráció) + a valódi "Te" sor
  const others = [
    { name: 'Balázs K.', stage: 'Erdőjáró', pts: 890, av: '🌳' },
    { name: 'Zsófi T.', stage: 'Fiatal fa', pts: 610, av: '🌳' },
    { name: 'Marci P.', stage: 'Hajtás', pts: 340, av: '🌿' },
    { name: 'Anna D.', stage: 'Hajtás', pts: 205, av: '🌿' },
    { name: 'Bence R.', stage: 'Csíra', pts: 35, av: '🌱' }
  ];
  const me = { name: state.name, stage: STAGES[stageIndex(state.points)].name, pts: state.points, av: '🌱', me: true };
  const all = [...others, me].sort((a, b) => b.pts - a.pts);
  const list = document.getElementById('rank-list');
  list.innerHTML = all.map((p, i) => `
    <div class="rank-item ${p.me ? 'me' : ''}">
      <div class="rank-num">${i + 1}</div>
      <div class="rank-av">${p.av}</div>
      <div class="rank-name">${p.me ? 'Te' : p.name}<span>${p.stage}</span></div>
      <div class="rank-pts">${p.pts}</div>
    </div>
  `).join('');
}

function renderProfile() {
  document.getElementById('profile-joined').textContent =
    'Csatlakozott: ' + new Date(state.joined).toLocaleDateString('hu-HU', { year: 'numeric', month: 'long' });

  const grid = document.getElementById('badge-grid');
  grid.innerHTML = BADGE_DEFS.map(b => {
    const unlocked = b.check(state);
    return `<div class="badge ${unlocked ? '' : 'locked'}"><span class="ic">${b.ic}</span><span class="nm">${b.name}</span></div>`;
  }).join('');

  const hist = document.getElementById('profile-history');
  if (!state.history.length) {
    hist.innerHTML = '<div class="empty-note">Az előzményeid itt fognak megjelenni.</div>';
  } else {
    hist.innerHTML = state.history.map(h => `
      <div class="history-row">
        <div class="ic">${h.photo ? `<img src="${h.photo}" alt="">` : h.icon}</div>
        <div class="tx"><b>${h.label}</b><span>${new Date(h.ts).toLocaleString('hu-HU')}</span></div>
        <div class="pt">+${h.pts}</div>
      </div>
    `).join('');
  }
}

function resetData() {
  if (confirm('Biztosan törlöd az összes helyi adatot (pontok, előzmények)? Ez nem vonható vissza.')) {
    state = defaultState();
    saveState();
    renderHome(); renderProfile(); renderRank();
    goHome();
  }
}

// ---------------------------------------------
// Telepítési banner (Add to Home Screen)
// ---------------------------------------------
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const banner = document.getElementById('install-banner');
  if (!localStorage.getItem('zoldnyom_install_dismissed')) {
    banner.classList.add('show');
  }
});

function installApp() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  deferredPrompt.userChoice.finally(() => {
    deferredPrompt = null;
    document.getElementById('install-banner').classList.remove('show');
  });
}

function dismissInstall() {
  document.getElementById('install-banner').classList.remove('show');
  localStorage.setItem('zoldnyom_install_dismissed', '1');
}

// ---------------------------------------------
// Óra a mock státuszsávban + service worker regisztráció
// ---------------------------------------------
function updateClock() {
  const el = document.getElementById('clock');
  if (!el) return;
  const now = new Date();
  el.textContent = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW regisztráció sikertelen', e));
  });
}

updateClock();
setInterval(updateClock, 30000);
renderHome();
renderRank();
renderProfile();
