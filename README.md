# ZöldNyom — telepíthető PWA (MVP)

Fotózd le az eldobott szemetet → vedd fel → dobd szemetesbe → a GPS igazolja, hogy tényleg ott jártál → pontot kapsz.

Ez egy **működő PWA (Progressive Web App)**: valódi kamera- és GPS-hozzáférést használ, offline is működik, és Androidon "Hozzáadás a kezdőképernyőhöz" paranccsal telepíthető, natív alkalmazásként viselkedik. Adatok jelenleg csak a telefonon, a böngésző `localStorage`-ában tárolódnak — nincs szerver, nincs regisztráció.

## Fájlstruktúra

```
zoldnyom-pwa/
├── index.html          → az app egyetlen "oldala" (a képernyők JS-sel váltanak)
├── manifest.webmanifest → telepíthetőség (ikon, név, szín)
├── sw.js                → service worker, offline cache
├── css/styles.css       → teljes vizuális design
├── js/app.js            → állapotkezelés, kamera, GPS, pontszámítás
└── icons/               → app ikonok (192px, 512px, maskable)
```

## Kipróbálás a saját géped/telefonod böngészőjében

A kamera és a GPS API **csak HTTPS-en vagy localhoston** működik — sima fájlmegnyitással (`file://`) a böngésző letiltja ezeket.

Legegyszerűbb helyi teszt (ha van Python a gépeden):

```bash
cd zoldnyom-pwa
python3 -m http.server 8000
```

Utána nyisd meg: `http://localhost:8000`

## Éles telepítés — GitHub Pages (ez a repó erre van előkészítve)

A repó tartalmaz egy `.github/workflows/deploy.yml` fájlt, ami minden `main` ágra történő push után **automatikusan** kiteszi az oldalt GitHub Pages-re. Ennyi a teendőd:

1. Hozz létre egy **üres** repót a GitHub-on (ne pipáld be a README/gitignore/license auto-generálást, mert ezek már megvannak).
2. A projekt mappában (ahol ez a README is van) futtasd:
   ```bash
   git remote add origin https://github.com/<felhasznalonev>/<repo-nev>.git
   git branch -M main
   git push -u origin main
   ```
3. A GitHub repó **Settings → Pages** oldalán, a "Build and deployment" résznél állítsd a forrást **"GitHub Actions"**-re (ha nem áll be magától).
4. Néhány másodperc múlva a repó **Actions** fülén látod, ahogy lefut a deploy — a végén megkapod a linket, valahogy így: `https://<felhasznalonev>.github.io/<repo-nev>/`

> A projekt már egy inicializált git repó egy első commit-tal — nincs szükség `git init`-re, csak a `remote add` + `push` lépésekre.

### Alternatíva: Netlify Drop (fiók nélkül, 30 másodperc)

Ha nem akarsz GitHub-repót, húzd rá a kicsomagolt mappát a **https://app.netlify.com/drop** oldalra — azonnal kapsz egy HTTPS linket, fiók nélkül is.

Amint élesben fut egy HTTPS címen:
1. Nyisd meg a linket Chrome-ban Androidon.
2. Koppints a "Telepítés" gombra (az app fent felajánlja), vagy a Chrome menüjében: *Hozzáadás a kezdőképernyőhöz*.
3. Az app innentől saját ikonnal, teljes képernyőn, natív app-érzéssel nyílik meg.

## Amit tudnia kell mielőtt szélesebb körben kiosztod

- **Nincs csalás elleni védelem szerver oldalon.** Az adatok csak a saját eszközön élnek, bárki törölheti vagy módosíthatja a böngésző dev-eszközeiből. Ez rendben van egy MVP-teszthez, de egy közösségi ranglistához és megbízható pontrendszerhez **kell egy backend**, ami:
  - eltárolja a fotót és GPS-koordinátákat szerveren,
  - ellenőrzi, hogy a fotózás és a bedobás helye/időpontja hihető-e,
  - kezeli a felhasználói fiókokat és a valódi, közös ranglistát.
- A jelenlegi ranglista-képernyő **kitalált, statikus adatokkal** van feltöltve a te valódi pontjaid mellett — ez szándékosan illusztráció, amíg nincs szerver.
- iOS Safari nem támogatja a telepítési promptot ugyanúgy, mint Android Chrome — ott a Megosztás menüből kell "Hozzáadás a kezdőképernyőhöz"-t választani.

## Következő lépések, ha viszed tovább

1. **Backend** (pl. Firebase vagy egy egyszerű Node/Postgres API) a fiókokhoz, közös ranglistához, és a bejelentések tárolásához.
2. **Térkép nézet** a közeli, mások által bejelentett szemetekhez (pl. Leaflet + OpenStreetMap, API-kulcs nélkül).
3. **Moderáció** — mielőtt pontot adunk, egy admin vagy automatikus kép-osztályozó ellenőrizhetné, hogy tényleg szemétről van-e szó a fotón.
4. Ha inkább **natív Android app**-ra váltanál (Play Store jelenlét, mélyebb OS-integráció), ez a design és logika közvetlenül átültethető Kotlin + Jetpack Compose projektbe — szólj, ha ebbe az irányba mennél tovább.
