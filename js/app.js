// ---------------------------------------------
// Kép-tartalom ellenőrzés — helyi, a telefonon futó szemét-felismerő modell
// ---------------------------------------------
// A modell forrása: NSTiwari/TFJS-TFLite-Object-Detection (MIT licenc), egy
// nyílt, "open litter / túltelt szemetes / műanyag / lebomló / orvosi hulladék"
// kategóriákon (részben TACO-adatokból) tanított TF Lite modell.
// Semmi nem megy ki szerverre — a modell letöltés után teljesen a böngészőben fut.
const WASTE_MODEL_PATH = './model/waste.tflite';

// Ez a modell SAJÁT, belső szótára — ezt ő "gondolja", amikor ránéz a képre.
// Ez NEM egyezik meg az app tényleges kategóriáival (lásd APP_CATEGORIES lejjebb) —
// egyelőre csak egy tájékoztató "AI-becslés" jelzésként mutatjuk meg a felhasználónak.
const AI_MODEL_LABELS = {
  0: 'Nyílt szemét',
  1: 'Túltelt szemetes',
  2: 'Műanyag hulladék',
  3: 'Lebomló hulladék',
  4: 'Orvosi hulladék'
};
// Nincs elfogadási küszöb — mindig a modell legjobb találatát mutatjuk meg,
// a hozzá tartozó bizonyossági százalékkal együtt (tisztán informatív, nem blokkoló).

// Az app TÉNYLEGES, szabadon szerkeszthető kategóriái — ezt látja és ebből választ
// a felhasználó, ez kerül elmentésre minden jelentés mellé. Egy jövőbeli saját
// modell pontosan ezekre a kategóriákra lenne betanítva, mihelyt elég (fotó + emberi
// címke) pár gyűlik össze belőle.
const APP_CATEGORIES = [
  'Cigarettacsikk',
  'Műanyaghulladék',
  'Papírhulladék',
  'Kommunális hulladék',
  'Szövethulladék',
  'Elektronikai hulladék',
  'Elem',
  'Üveg',
  'Fém hulladék'
];
const NOT_LITTER_OPTION = 'Nem szemét volt';

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

    const raw = [];
    for (let i = 0; i < n; i++) {
      raw.push({
        class: AI_MODEL_LABELS[classes[i]] || ('Kategória ' + classes[i]),
        confidence: Math.round(scores[i] * 100)
      });
    }
    // Osztályonként csak a legjobb (legmagasabb %) találatot tartjuk meg,
    // hogy ne szerepelhessen ugyanaz a kategória többször a top listában.
    const bestByClass = new Map();
    raw.forEach((r) => {
      const existing = bestByClass.get(r.class);
      if (!existing || r.confidence > existing.confidence) bestByClass.set(r.class, r);
    });
    const labels = Array.from(bestByClass.values()).sort((a, b) => b.confidence - a.confidence);
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
  { min: 0,    name: 'Mag' },
  { min: 25,   name: 'Csíra' },
  { min: 75,   name: 'Gyököcske' },
  { min: 150,  name: 'Sziklevél' },
  { min: 250,  name: 'Magonc' },
  { min: 400,  name: 'Suháng' },
  { min: 600,  name: 'Koronás csemete' },
  { min: 850,  name: 'Fiatal fa' },
  { min: 1150, name: 'Felnőtt fa' },
  { min: 1500, name: 'Fa csoport' },
  { min: 2000, name: 'Liget' },
  { min: 2600, name: 'Erdő' },
  { min: 3500, name: 'Őserdő' }
];

const BADGE_DEFS = [
  { id: 'first',      ic: '🥇', name: 'Első jelentés', check: (s) => s.history.length >= 1 },
  { id: 'streak3',    ic: '🔥', name: '3 napos sorozat', check: (s) => currentStreak(s) >= 3 },
  { id: 'streak7',    ic: '📅', name: 'Hétköznapi hős', check: (s) => currentStreak(s) >= 7 },
  { id: 'streak30',   ic: '🛡️', name: 'Erdőőr', check: (s) => currentStreak(s) >= 30 },
  { id: 'ten',        ic: '♻️', name: '10 szemét', check: (s) => s.history.length >= 10 },
  { id: 'litterpatrol', ic: '🧹', name: 'Tisztasági őrjárat', check: (s) => countByUserLabel(s, 'Kommunális hulladék') >= 10 },
  { id: 'plastichunter', ic: '🧴', name: 'Műanyag-vadász', check: (s) => countByUserLabel(s, 'Műanyaghulladék') >= 20 },
  { id: 'buttcollector', ic: '🚬', name: 'Csikk-vadász', check: (s) => countByUserLabel(s, 'Cigarettacsikk') >= 15 },
  { id: 'batteryrescue', ic: '🔋', name: 'Elem-mentő', check: (s) => countByUserLabel(s, 'Elem') >= 5 },
  { id: 'glasscollector', ic: '🍾', name: 'Üveg-gyűjtő', check: (s) => countByUserLabel(s, 'Üveg') >= 5 },
  { id: 'metalcollector', ic: '🔩', name: 'Fém-gyűjtő', check: (s) => countByUserLabel(s, 'Fém hulladék') >= 10 },
  { id: 'earlybird',  ic: '🌅', name: 'Hajnali madár', check: (s) => hasEarlyMorningReport(s) },
  { id: 'pioneer',    ic: '🧭', name: 'Úttörő', check: (s) => distinctLocationCount(s, 150) >= 3 },
  { id: 'tree',       ic: '🌳', name: 'Fiatal fa szint', check: (s) => s.points >= 850 },
  { id: 'forest',     ic: '🌲', name: 'Őserdő szint', check: (s) => s.points >= 3500 },
  { id: 'top3',       ic: '🏆', name: 'Top 3 hetente', check: () => false } // szerver nélkül nem eldönthető, jövőbeli funkció
];

function defaultState() {
  return {
    name: 'Te',
    joined: new Date().toISOString(),
    points: 0,
    trainingConsent: false, // alapból KIKAPCSOLVA — explicit hozzájárulás kell a Profil oldalon
    history: [] // { id, label, icon, pts, photo (dataURL thumb), lat, lon, ts, userLabel }
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

// A jelvényekhez a FELHASZNÁLÓ ÁLTAL MEGERŐSÍTETT kategóriát számoljuk (h.userLabel),
// nem a modell saját, belső becslését — hiszen a valódi kategóriarendszert most már
// a felhasználó választása adja.
function countByUserLabel(s, label) {
  return s.history.filter((h) => h.userLabel === label).length;
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
  report = { photoThumb: null, foundLat: null, foundLon: null, disposeLat: null, disposeLon: null, detection: null, userLabel: null };
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
let report = { photoThumb: null, foundLat: null, foundLon: null, disposeLat: null, disposeLon: null, detection: null, userLabel: null };
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

// Legfeljebb 3 legjobb találatot jelenít meg apró "chip" formában, %-kal.
function renderDetectChips(container, labels) {
  if (!labels || !labels.length) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = labels.slice(0, 3).map((l, i) => `
    <span class="detect-chip ${i === 0 ? 'top' : ''}">${l.class} <span class="pct">${l.confidence}%</span></span>
  `).join('');
}

// A felhasználói visszajelzés-választó (melyik kategória volt valójában) — nincs
// előre kiválasztott alapérték, mert a modell saját belső kategóriái nem egyeznek
// meg az app kategóriáival. "Nem szemét volt" opció a negatív példák gyűjtéséhez
// (ezek nélkül egy jövőbeli újratanítás torzított lenne).
const FEEDBACK_OPTIONS = [...APP_CATEGORIES, NOT_LITTER_OPTION];

function renderFeedbackChips() {
  const container = document.getElementById('feedback-chips');
  container.innerHTML = FEEDBACK_OPTIONS.map((label) => {
    const isNotLitter = label === NOT_LITTER_OPTION;
    const selected = report.userLabel === label;
    return `<button type="button" class="feedback-chip ${isNotLitter ? 'not-litter' : ''} ${selected ? 'selected' : ''}" data-label="${label}">${label}</button>`;
  }).join('');
}

function selectFeedback(label) {
  report.userLabel = label;
  renderFeedbackChips();
}

document.addEventListener('click', (e) => {
  const chip = e.target.closest('.feedback-chip');
  if (chip) selectFeedback(chip.dataset.label);
});

async function capturePhoto() {
  const frame = document.getElementById('cam-frame');
  const video = frame.querySelector('video');
  const captureBtn = document.getElementById('capture-btn');
  const statusEl = document.getElementById('detect-status');
  const listEl = document.getElementById('detect-list');

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
  listEl.innerHTML = '';

  const result = await verifyLitterPhoto(report.photoThumb);
  report.detection = result;

  captureBtn.disabled = false;
  captureBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#F6F2E7" stroke-width="1.8"/></svg> Fotó készítése';

  if (result.ok === true) {
    // Ez a modell SAJÁT, belső becslése — tájékoztató jellegű, nem az app kategóriái.
    statusEl.className = 'detect-status muted';
    statusEl.textContent = 'AI-becslés (a modell saját kategóriái):';
    renderDetectChips(listEl, result.labels);
    report.userLabel = null; // a tényleges kategóriát a felhasználó választja lent
  } else if (result.ok === false) {
    statusEl.className = 'detect-status muted';
    statusEl.textContent = 'A modell nem talált egyértelmű kategóriát a képen, de folytathatod.';
    report.userLabel = null;
  } else {
    statusEl.className = 'detect-status muted';
    statusEl.textContent = 'A kép-ellenőrzés most nem elérhető, de folytathatod.';
  }

  stopCamera();
  showPage('page-scan2');
  const previewFrame = document.getElementById('scan2-preview');
  previewFrame.innerHTML = `<img src="${report.photoThumb}" alt="Rögzített fotó">`;

  const scan2List = document.getElementById('scan2-detect-list');
  renderDetectChips(scan2List, result.ok === true ? result.labels : []);
  renderFeedbackChips();
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
    label: report.userLabel ? ('Szemét — ' + report.userLabel) : 'Szemét — bejelentve',
    icon: '🗑️',
    pts,
    photo: report.photoThumb,
    lat: report.disposeLat,
    lon: report.disposeLon,
    detection: report.detection,
    userLabel: report.userLabel || null,
    ts: new Date().toISOString()
  });
  saveState();
  uploadTrainingSample(); // csak akkor csinál bármit, ha a felhasználó hozzájárult
  syncLeaderboardEntry(); // csak akkor csinál bármit, ha van beállított becenév
  document.getElementById('earned-pts-label').textContent = '+' + pts;
  showPage('page-success');
}

// ---------------------------------------------
// Tanító adat feltöltése (Firebase) — csak explicit hozzájárulás esetén.
// Sosem blokkolja a folyamatot: ha bármi hiba történik (nincs net, Firebase
// hiba stb.), csendben kihagyjuk, a felhasználó pontja/jelentése attól függetlenül megvan.
// ---------------------------------------------
async function uploadTrainingSample() {
  if (!state.trainingConsent) return;
  if (!report.userLabel) return; // nincs értelmes címke, amiből tanulni lehetne
  if (!report.photoThumb) return;
  if (typeof firebase === 'undefined' || !navigator.onLine) return;

  try {
    if (typeof fbReady !== 'undefined') await fbReady;
    const uid = (fbAuth.currentUser && fbAuth.currentUser.uid) || 'ismeretlen';
    const path = `training-photos/${uid}/${Date.now()}.jpg`;

    const blob = await (await fetch(report.photoThumb)).blob();
    await fbStorage.ref(path).put(blob);

    await fbDb.collection('trainingSubmissions').add({
      category: report.userLabel,
      aiGuess: (report.detection && report.detection.ok === true) ? report.detection.labels.slice(0, 3) : [],
      lat: report.disposeLat || null,
      lon: report.disposeLon || null,
      photoPath: path,
      moderationStatus: 'pending',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) {
    console.warn('Tanító adat feltöltése sikertelen (nem blokkoló):', e);
  }
}

function toggleTrainingConsent() {
  state.trainingConsent = !state.trainingConsent;
  saveState();
  renderProfile();
}
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

const STAGE_EMOJI = ['🌰', '🌱', '🌿', '🍀', '🪴', '🌾', '🌳', '🌳', '🌲', '🌲', '🌲', '🌲', '🌲'];

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

async function renderRank() {
  const list = document.getElementById('rank-list');
  if (typeof fbDb === 'undefined') {
    list.innerHTML = '<div class="empty-note">A ranglista jelenleg nem érhető el.</div>';
    return;
  }
  list.innerHTML = '<div class="empty-note">Ranglista betöltése…</div>';
  try {
    if (typeof fbReady !== 'undefined') await fbReady;
    const snap = await fbDb.collection('leaderboard').orderBy('points', 'desc').limit(100).get();
    const all = [];
    snap.forEach((doc) => all.push({ uid: doc.id, ...doc.data() }));

    if (!all.length) {
      list.innerHTML = '<div class="empty-note">Még senki nincs a ranglistán — állíts be egy becenevet a Profil oldalon, és legyél te az első!</div>';
      return;
    }

    const myUid = fbAuth.currentUser && fbAuth.currentUser.uid;
    const top = all.slice(0, 20);
    const myIndex = all.findIndex((p) => p.uid === myUid);
    const meInTop = top.some((p) => p.uid === myUid);

    const rowHtml = (p, i) => `
      <div class="rank-item ${p.uid === myUid ? 'me' : ''}">
        <div class="rank-num">${i + 1}</div>
        <div class="rank-av">${STAGE_EMOJI[stageIndex(p.points || 0)]}</div>
        <div class="rank-name">${p.uid === myUid ? 'Te' : escapeHtml(p.nickname || 'Névtelen')}<span>${STAGES[stageIndex(p.points || 0)].name}</span></div>
        <div class="rank-pts">${p.points || 0}</div>
      </div>
    `;

    let html = top.map(rowHtml).join('');
    if (!meInTop && myIndex >= 0) {
      html += rowHtml(all[myIndex], myIndex);
    }
    list.innerHTML = html;
  } catch (e) {
    console.warn('Ranglista betöltése sikertelen:', e);
    list.innerHTML = '<div class="empty-note">Nem sikerült betölteni a ranglistát — ellenőrizd az internetkapcsolatot.</div>';
  }
}

// A profilod (becenév + pontszám) szinkronizálása a közös ranglistába.
// Csak akkor ír bármit, ha már van beállított becenév — enélkül nem kerülsz be a listára.
async function syncLeaderboardEntry() {
  if (!state.name || state.name === 'Te') return;
  if (typeof fbDb === 'undefined' || !navigator.onLine) return;
  try {
    if (typeof fbReady !== 'undefined') await fbReady;
    const uid = fbAuth.currentUser && fbAuth.currentUser.uid;
    if (!uid) return;
    await fbDb.collection('leaderboard').doc(uid).set({
      nickname: state.name,
      points: state.points,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } catch (e) {
    console.warn('Ranglista-szinkron sikertelen (nem blokkoló):', e);
  }
}

const NICKNAME_BLOCKLIST = ['fasz', 'kurva', 'geci', 'buzi', 'picsa'];

async function saveNickname() {
  const input = document.getElementById('nickname-input');
  const hint = document.getElementById('nickname-hint');
  const value = input.value.trim();

  if (value.length < 2 || value.length > 20) {
    hint.textContent = 'A becenév 2 és 20 karakter között legyen.';
    hint.className = 'nickname-hint warn';
    return;
  }
  if (!/^[\p{L}0-9 _-]+$/u.test(value)) {
    hint.textContent = 'Csak betűket, számokat, szóközt és - _ jeleket használj.';
    hint.className = 'nickname-hint warn';
    return;
  }
  const normalized = value.toLowerCase();
  if (NICKNAME_BLOCKLIST.some((bad) => normalized.includes(bad))) {
    hint.textContent = 'Ez a becenév nem használható, válassz másikat.';
    hint.className = 'nickname-hint warn';
    return;
  }

  if (typeof fbDb === 'undefined' || !navigator.onLine) {
    hint.textContent = 'A becenév egyediségének ellenőrzéséhez internetkapcsolat kell — próbáld újra, ha van net.';
    hint.className = 'nickname-hint warn';
    return;
  }

  hint.textContent = 'Ellenőrzés…';
  hint.className = 'nickname-hint';

  const oldNormalized = (state.name && state.name !== 'Te') ? state.name.trim().toLowerCase() : null;

  try {
    await fbReady;
    const uid = fbAuth.currentUser && fbAuth.currentUser.uid;
    if (!uid) throw new Error('NO_AUTH');

    if (normalized !== oldNormalized) {
      // Tranzakció: csak akkor foglaljuk le az új nevet, ha az még nem másé —
      // ha közben más is épp ugyanezt próbálná, a tranzakció automatikusan újrapróbálkozik/elbukik.
      await fbDb.runTransaction(async (tx) => {
        const newRef = fbDb.collection('nicknames').doc(normalized);
        const newDoc = await tx.get(newRef);
        if (newDoc.exists && newDoc.data().uid !== uid) {
          throw new Error('TAKEN');
        }
        if (oldNormalized) {
          tx.delete(fbDb.collection('nicknames').doc(oldNormalized));
        }
        tx.set(newRef, { uid, nickname: value });
      });
    }

    state.name = value;
    saveState();
    hint.textContent = 'Mentve! Mostantól ez a neved a ranglistán.';
    hint.className = 'nickname-hint ok';
    renderProfile();
    renderHome();
    await syncLeaderboardEntry();
    renderRank();
  } catch (e) {
    if (e && e.message === 'TAKEN') {
      hint.textContent = 'Ezt a becenevet már valaki más használja — válassz másikat.';
    } else {
      hint.textContent = 'Nem sikerült menteni, próbáld újra.';
      console.warn('Becenév mentése sikertelen:', e);
    }
    hint.className = 'nickname-hint warn';
  }
}

function renderProfile() {
  document.getElementById('profile-joined').textContent =
    'Csatlakozott: ' + new Date(state.joined).toLocaleDateString('hu-HU', { year: 'numeric', month: 'long' });

  const nicknameInput = document.getElementById('nickname-input');
  if (nicknameInput && document.activeElement !== nicknameInput) {
    nicknameInput.value = (state.name && state.name !== 'Te') ? state.name : '';
  }

  const consentToggle = document.getElementById('consent-toggle');
  if (consentToggle) consentToggle.checked = !!state.trainingConsent;

  const grid = document.getElementById('badge-grid');
  grid.innerHTML = BADGE_DEFS.map(b => {
    const unlocked = b.check(state);
    return `<div class="badge ${unlocked ? '' : 'locked'}"><span class="ic">${b.ic}</span><span class="nm">${b.name}</span></div>`;
  }).join('');

  const hist = document.getElementById('profile-history');
  if (!state.history.length) {
    hist.innerHTML = '<div class="empty-note">Az előzményeid itt fognak megjelenni.</div>';
  } else {
    hist.innerHTML = renderHistoryGroups(state.history);
  }
}

// Naponkénti csoportosítás — alapból csak a legfrissebb nap van nyitva, a többi
// egy sornyi összegzésként (dátum + darabszám + pont) jelenik meg, koppintásra nyílik ki.
let expandedHistoryDays = null; // null = "még nincs explicit állítva", ilyenkor a legfrissebb nap nyíljon

function renderHistoryGroups(history) {
  const groups = [];
  const byKey = new Map();
  history.forEach((h) => {
    const d = new Date(h.ts);
    const key = d.toDateString();
    if (!byKey.has(key)) {
      const group = { key, date: d, items: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    byKey.get(key).items.push(h);
  });

  if (expandedHistoryDays === null) {
    expandedHistoryDays = new Set(groups.length ? [groups[0].key] : []);
  }

  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();

  return groups.map((g) => {
    const isOpen = expandedHistoryDays.has(g.key);
    const totalPts = g.items.reduce((sum, h) => sum + h.pts, 0);
    let dateLabel;
    if (g.key === today) dateLabel = 'Ma';
    else if (g.key === yesterday) dateLabel = 'Tegnap';
    else dateLabel = g.date.toLocaleDateString('hu-HU', { month: 'long', day: 'numeric' });

    const rows = g.items.map((h) => `
      <div class="history-row">
        <div class="ic">${h.photo ? `<img src="${h.photo}" alt="">` : h.icon}</div>
        <div class="tx"><b>${h.label}</b><span>${new Date(h.ts).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })}</span></div>
        <div class="pt">+${h.pts}</div>
      </div>
    `).join('');

    return `
      <div class="history-day">
        <button type="button" class="history-day-head" onclick="toggleHistoryDay('${g.key}')">
          <span class="hd-date">${dateLabel}</span>
          <span class="hd-summary">${g.items.length} db · +${totalPts} pont</span>
          <span class="hd-chevron ${isOpen ? 'open' : ''}">▾</span>
        </button>
        <div class="history-day-body ${isOpen ? 'open' : ''}"><div class="hdb-inner">${rows}</div></div>
      </div>
    `;
  }).join('');
}

function toggleHistoryDay(key) {
  if (expandedHistoryDays.has(key)) expandedHistoryDays.delete(key);
  else expandedHistoryDays.add(key);
  renderProfile();
}

function resetData() {
  if (confirm('Biztosan törlöd az összes helyi adatot (pontok, előzmények)? Ez nem vonható vissza.')) {
    state = defaultState();
    expandedHistoryDays = null;
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
