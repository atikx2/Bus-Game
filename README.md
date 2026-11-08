# BD Bus Sim

Bangladesh themed bus simulator. **Babylon.js** diye game, **Capacitor** diye Android APK, **GitHub Actions** diye build — sob free, kono PC lagbe na.

- Web link: GitHub Pages
- APK: GitHub Actions → artifact `bd-bus-sim-apk` → `app-debug.apk`
- Package id: `com.bdbus.sim`
- Game file: `www/index.html` (Babylon.js demo build)

---

## Folder structure

```
www/index.html              ← game bootstrap (HUD, touch control, render loop)
www/js/core.js              ← simulation: route, physics, traffic, stops (pure JS)
www/js/graphics.js          ← Babylon.js scene: PBR, road, buildings, bus, camera
www/babylon.js              ← Babylon.js 8.34 engine (local, offline/APK er jonno)
test/core.test.js           ← 30 ta physics/gameplay test
test/scene.test.js          ← 11 ta scene test (NullEngine, GPU chara)
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

## Game feature (demo build)

- **রুট**: 1.63 কিমি বন্ধ লুপ (procedural), ৬টা বাস স্ট্যান্ড — মিরপুর, গুলশান, উত্তরা, মতিঝিল, যাত্রাবাড়ী, ধানমন্ডি
- **ড্রাইভিং মডেল**: ডিজেল টর্ক কার্ভ + ৫ স্পিড অটো গিয়ারবক্স + RPM, kinematic bicycle model, grip limit (understeer), ইঞ্জিন ব্রেকিং, সার্ভিস/হ্যান্ডব্রেক, রিভার্স গিয়ার
- **স্টিয়ারিং অ্যাসিস্ট**: curvature look-ahead + lane hold + traffic এর জন্য auto-brake (মোবাইলে চালানো সহজ করার জন্য; বন্ধ করা যায়)
- **ট্রাফিক**: car / CNG / রিকশা / বাস / ট্রাক, car-following logic, সংঘর্ষ
- **গ্রাফিক্স**: আপনার boulevard reference-এর ধাঁচে divided road + raised concrete median, দুই দিকের carriageway, asphalt grain/crack texture, kerb, lane marking, PBR material, shadow, clustered avenue trees, cross-arm streetlight, আর procedural CNG/রিকশা; কোনো bus-game asset কপি নয়
- **অ্যাডাপটিভ কোয়ালিটি**: FPS কমলে নিজেই shadow/graphics কমায় (low/med/high)
- **সাউন্ড**: procedural engine note (RPM অনুযায়ী), হর্ন, ক্রাশ — কোনো external asset নেই
- **কন্ট্রোল**: keyboard (WASD/arrows, Space, R, H, C) + মোবাইল টাচ বাটন

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
| Game (Babylon.js) | ✅ demo build ready (core 30/30, scene 11/11 test pass) |

Bistarito: `PROJECT_BRIEF.md`
