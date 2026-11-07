# BD Bus Sim

Bangladesh themed bus simulator. **Babylon.js** diye game, **Capacitor** diye Android APK, **GitHub Actions** diye build — sob free, kono PC lagbe na.

- Web link: GitHub Pages
- APK: GitHub Actions → artifact `bd-bus-sim-apk` → `app-debug.apk`
- Package id: `com.bdbus.sim`
- Game file: `www/index.html` (ekhon placeholder, game pore bosteche)

---

## Folder structure

```
www/index.html              ← game (Babylon.js) ekhane thake
package.json                ← Capacitor dependency
capacitor.config.json       ← appId / appName / webDir = www
.github/workflows/
  pages.yml                 ← www/ ke GitHub Pages e deploy kore
  build-apk.yml             ← Android debug APK banay
```

---

## Ekbar er setup (GitHub website theke)

1. Repo khulun → **Settings** → **Pages**
2. **Build and deployment** → **Source** = **GitHub Actions** select korun
3. Save. Bas, ar kichu lagbe na.

---

## Web link paben kivabe

- `main` branch e push korlei **Actions** tab e `Deploy to GitHub Pages` cholbe (2–3 min)
- Sesh hole link: `https://atikx2.github.io/Bus-Game/`
- Link ta phone browser e khullen → game cholbe

## APK paben kivabe

1. **Actions** tab → `Build Android APK` (prothom bar 6–10 min lagbe)
2. Run e dhuke niche scroll → **Artifacts** → `bd-bus-sim-apk` download
3. Zip ta extract korun → `app-debug.apk`
4. Phone e install korun (Settings → "Unknown sources" allow korte hobe)

> Debug APK ta testing er jonno. Play Store e dite signed AAB lagbe — oi kaj pore.

---

## Locally test (jodi kokhono computer pao)

```bash
npm install
npx cap add android      # ekbar e
npx cap sync android
npm run serve            # http://localhost:8001 e web version
cd android && ./gradlew assembleDebug
```

---

## Legal note

BUSSID ba onno kono game er asset, model, logo, sound copy kora hobe na.
Bangladeshi kono bus company er real logo/trademark use kora hobe na.
Shob asset CC0 (Poly Haven, Kenney) ba nijer banano hobe.

---

## Status

| Kaj | Obostha |
|---|---|
| Pages workflow | ✅ ready |
| APK workflow | ✅ ready (CI te verify korte hobe) |
| Game (Babylon.js) | ⏳ placeholder ache, game pore |

Bistarito: `PROJECT_BRIEF.md`
