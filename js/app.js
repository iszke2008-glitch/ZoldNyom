// ---------------------------------------------
// Kép-tartalom ellenőrzés — helyi, a telefonon futó szemét-felismerő modell
// ---------------------------------------------
// A modell forrása: NSTiwari/TFJS-TFLite-Object-Detection (MIT licenc), egy
// nyílt, "open litter / túltelt szemetes / műanyag / lebomló / orvosi hulladék"
// kategóriákon (részben TACO-adatokból) tanított TF Lite modell.
// Semmi nem megy ki szerverre — a modell letöltés után teljesen a böngészőben fut.
const WASTE_MODEL_PATH = './model/waste.tflite';
const WASTE_CLASS_LABELS = {
  0: 'Nyílt szemét',
  1: 'Túltelt szemetes',
  2: 'Műanyag hulladék',
  3: 'Lebomló hulladék',
  4: 'Orvosi hulladék'
};
// Nincs elfogadási küszöb — mindig a modell legjobb találatát mutatjuk meg,
// a hozzá tartozó bizonyossági százalékkal együtt (tisztán informatív, nem blokkoló).

let wasteDetector = null;
let wasteDetectorLoading = null;

function loadImageFromDataURL(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Nem sikerült betölteni a képet'));
    img.src = src;
  });
}

// Előtölti a modellt a háttérben, hogy fotózáskor már gyors legyen a válasz.
function preloadWasteDetector() {
  if (typeof tflite === 'undefined') return;
  if (!wasteDetector && !wasteDetectorLoading) {
    wasteDetectorLoading = tflite.loadTFLiteModel(WASTE_MODEL_PATH)
      .then((m) => { wasteDetector = m; return m; })
      .catch((e) => { console.warn('Szemét-felismerő modell betöltése sikertelen', e); wasteDetectorLoading = null; });
  }
}

// Visszaadja: { ok: boolean|null, labels: [{class, confidence}], error?: string }
async function verifyLitterPhoto(photoDataURL) {
  if (typeof tf === 'undefined' || typeof tflite === 'undefined') {
    return { ok: null, labels: [], error: 'a felismerő könyvtár nem töltődött be' };
  }
  let input = null;
  let outputs = null;
  try {
    if (!wasteDetector) {
      preloadWasteDetector();
      wasteDetector = await wasteDetectorLoading;
    }
    const img = await loadImageFromDataURL(photoDataURL);
    input = tf.cast(tf.expandDims(tf.image.resizeBilinear(tf.browser.fromPixels(img), [448, 448])), 'int32');

    const result = await wasteDetector.predict(input);
    const keys = Object.keys(result);
    outputs = keys.map((k) => result[k]);
    const boxes = Array.from(await outputs[0].data());
    const classes = Array.from(await outputs[1].data());
    const scores = Array.from(await outputs[2].data());
    const n = Array.from(await outputs[3].data())[0] || 0;

    const labels = [];
    for (let i = 0; i < n; i++) {
      labels.push({
        class: WASTE_CLASS_LABELS[classes[i]] || ('Kategória ' + classes[i]),
        confidence: Math.round(scores[i] * 100)
      });
    }
    labels.sort((a, b) => b.confidence - a.confidence);
    return { ok: labels.length > 0, labels };
  } catch (e) {
    console.warn('Litter-detekció sikertelen', e);
    return { ok: null, labels: [], error: 'a modell futtatása sikertelen' };
  } finally {
    if (input) input.dispose();
    if (outputs) outputs.forEach((t) => t && t.dispose && t.dispose());
  }
}

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
  { id: 'first',      ic: '🥇', name: 'Első jelentés', check: (s) => s.history.length >= 1 },
  { id: 'streak3',    ic: '🔥', name: '3 napos sorozat', check: (s) => currentStreak(s) >= 3 },
  { id: 'streak7',    ic: '📅', name: 'Hétköznapi hős', check: (s) => currentStreak(s) >= 7 },
  { id: 'streak30',   ic: '🛡️', name: 'Erdőőr', check: (s) => currentStreak(s) >= 30 },
  { id: 'ten',        ic: '♻️', name: '10 szemét', check: (s) => s.history.length >= 10 },
  { id: 'litterpatrol', ic: '🧹', name: 'Tisztasági őrjárat', check: (s) => countByWasteClass(s, 'Nyílt szemét') >= 10 },
  { id: 'plastichunter', ic: '🧴', name: 'Műanyag-vadász', check: (s) => countByWasteClass(s, 'Műanyag hulladék') >= 20 },
  { id: 'greenheart', ic: '💚', name: 'Zöld szív', check: (s) => countByWasteClass(s, 'Lebomló hulladék') >= 5 },
  { id: 'earlybird',  ic: '🌅', name: 'Hajnali madár', check: (s) => hasEarlyMorningReport(s) },
  { id: 'pioneer',    ic: '🧭', name: 'Úttörő', check: (s) => distinctLocationCount(s, 150) >= 3 },
  { id: 'tree',       ic: '🌳', name: 'Fiatal fa szint', check: (s) => s.points >= 350 },
  { id: 'forest',     ic: '🌲', name: 'Erdőjáró szint', check: (s) => s.points >= 700 },
  { id: 'top3',       ic: '🏆', name: 'Top 3 hetente', check: () => false } // szerver nélkül nem eldönthető, jövőbeli funkció
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

function countByWasteClass(s, className) {
  return s.history.filter(h => h.detection && h.detection.labels && h.detection.labels[0] && h.detection.labels[0].class === className).length;
}

function hasEarlyMorningReport(s) {
  return s.history.some(h => {
    const hour = new Date(h.ts).getHours();
    return hour >= 5 && hour < 8;
  });
}

// Mivel nincs szerver/közösségi adat, az "Úttörő" jelvényt lokálisan úgy értelmezzük:
// legalább 3, egymástól kellően távoli (150 m+) helyszínen jelentettél már — vagyis
// nem csak egyetlen helyre jársz vissza, hanem több különböző helyet is "felfedeztél".
function distinctLocationCount(s, thresholdMeters) {
  const points = s.history.filter(h => h.lat != null && h.lon != null);
  const clusters = [];
  points.forEach(p => {
    const isNew = clusters.every(c => distanceMeters(c.lat, c.lon, p.lat, p.lon) > thresholdMeters);
    if (isNew) clusters.push({ lat: p.lat, lon: p.lon });
  });
  return clusters.length;
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
  report = { photoThumb: null, foundLat: null, foundLon: null, disposeLat: null, disposeLon: null, detection: null };
  const frame = document.getElementById('cam-frame');
  frame.innerHTML =
    '<div class="cam-placeholder" id="cam-placeholder">📷<br>Érintsd meg a kamera bekapcsolásához</div>' +
    '<div class="cam-corner cc-tl"></div><div class="cam-corner cc-tr"></div><div class="cam-corner cc-bl"></div><div class="cam-corner cc-br"></div>';
  const statusEl = document.getElementById('detect-status');
  statusEl.className = 'detect-status';
  statusEl.textContent = '';
  showPage('page-scan1');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  enableCamera();
  preloadWasteDetector();
}

// ---------------------------------------------
// Jelentés folyamat (fotó -> felvétel -> GPS -> pont)
// ---------------------------------------------
let report = { photoThumb: null, foundLat: null, foundLon: null, disposeLat: null, disposeLon: null, detection: null };
let stream = null;

async function enableCamera() {
  const frame = document.getElementById('cam-frame');
  const existingVideo = frame.querySelector('video');
  if (existingVideo) existingVideo.remove();
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

async function capturePhoto() {
  const frame = document.getElementById('cam-frame');
  const video = frame.querySelector('video');
  const captureBtn = document.getElementById('capture-btn');
  const statusEl = document.getElementById('detect-status');

  if (video && video.videoWidth) {
    const canvas = document.createElement('canvas');
    // kicsinyített, tárhely-barát méret
    const targetW = 480;
    const ratio = video.videoHeight / video.videoWidth;
    canvas.width = targetW;
    canvas.height = Math.round(targetW * ratio);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    report.photoThumb = canvas.toDataURL('image/jpeg', 0.7);
  } else {
    report.photoThumb = null;
    statusEl.className = 'detect-status warn';
    statusEl.textContent = 'Nincs élő kamerakép — indítsd újra a kamerát, majd próbáld újra.';
    return;
  }

  report.detection = null;
  captureBtn.disabled = true;
  captureBtn.textContent = 'Kép elemzése…';
  statusEl.className = 'detect-status checking';
  statusEl.textContent = 'A fotó ellenőrzése folyamatban…';

  const result = await verifyLitterPhoto(report.photoThumb);
  report.detection = result;

  captureBtn.disabled = false;
  captureBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#F6F2E7" stroke-width="1.8"/></svg> Fotó készítése';

  if (result.ok === true) {
    // Van legjobb találat — kiírjuk a kategóriát és a bizonyossági százalékot, de nem blokkolunk vele.
    const top = result.labels[0];
    statusEl.className = 'detect-status ok';
    statusEl.textContent = `Felismerve: ${top.class} (${top.confidence}%)`;
  } else if (result.ok === false) {
    statusEl.className = 'detect-status muted';
    statusEl.textContent = 'A modell nem talált egyértelmű kategóriát a képen, de folytathatod.';
  } else {
    statusEl.className = 'detect-status muted';
    statusEl.textContent = 'A kép-ellenőrzés most nem elérhető, de folytathatod.';
  }

  stopCamera();
  showPage('page-scan2');
  const previewFrame = document.getElementById('scan2-preview');
  previewFrame.innerHTML = `<img src="${report.photoThumb}" alt="Rögzített fotó">`;

  const badge = document.getElementById('scan2-detect-badge');
  if (result.ok === true) {
    const top = result.labels[0];
    badge.className = 'detect-badge ok';
    badge.textContent = `Felismerve: ${top.class} (${top.confidence}%)`;
    badge.style.display = 'block';
  } else {
    badge.style.display = 'none';
  }
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
  const detectedLabel = (report.detection && report.detection.ok === true)
    ? report.detection.labels[0].class
    : null;
  state.history.unshift({
    id: 'r_' + Date.now(),
    label: detectedLabel ? ('Szemét — ' + detectedLabel) : 'Szemét — bejelentve',
    icon: '🗑️',
    pts,
    photo: report.photoThumb,
    lat: report.disposeLat,
    lon: report.disposeLon,
    detection: report.detection,
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
  document.querySelectorAll('.plant-stage').forEach((g) => g.classList.remove('active'));
  const stageEl = document.getElementById('plant-stage-' + idx);
  if (stageEl) stageEl.classList.add('active');

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
