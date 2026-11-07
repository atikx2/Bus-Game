# PROJECT BRIEF: Bangladesh Bus Simulator (Babylon.js + GitHub + APK)

Read this first if you are a new session. It explains what the user wants, what has been built, where everything is, what is unverified, and what to do next.

---

## 1. The user's goal (in their words, paraphrased)

- The user is in Bangladesh (Dhaka, Asia/Dhaka timezone). They prefer replies in Bangla or Banglish (Bangla written in English letters). Keep replies short, clear, and practical.
- They played **Bus Simulator Indonesia (BUSSID)** on mobile and want to make a **similar-feeling mobile game set in Bangladesh**.
- They want it to **feel** similar (driving, controls, camera, passenger/stop gameplay, bus customization ideas) and look **as realistic as possible**.
- **They explicitly said they do NOT want to copy BUSSID.** Feel and genre are fine. Assets, models, logos, sounds, UI, code must be original.
- They want an **Android APK** (and optionally a web link).
- They only have a **mobile phone** (no PC). They asked for **free** options.
- They asked specifically for: "Unity/Godot er bodole free upay", and they chose **Babylon.js + GitHub**.

## 2. Hard constraints and decisions made

| Topic | Decision | Why |
|---|---|---|
| Engine | **Babylon.js** (WebGL, free, MIT) | Free, runs in phone browser, good graphics (PBR, shadows, fog), no PC needed |
| Not Unity/Godot | Unity Editor needs PC. Godot editor does not run on Android | User has phone only |
| Hosting | **GitHub Pages** (free) | Web link for phone play |
| APK build | **GitHub Actions + Capacitor** (free, runs in GitHub's cloud) | APK without PC |
| Legal | No BUSSID assets/code/logos. No real Bangladeshi bus company logos/trademarks. Use CC0 assets (e.g., Poly Haven, Kenney) or original models | Copyright and Play Store rules |
| Platform priority | Web first, then APK via Capacitor (WebView) | Fastest path |

## 3. What has been built (current state)

There are **three** project folders under `/home/user/`:

1. `/home/user/bd-bus-sim/index.html`
   - Very first prototype. 2D Canvas, pseudo-3D road (OutRun style). Vanilla JS. Superseded by Babylon version. Kept for reference.

2. `/home/user/bd-bus-sim/babylon/`
   - `index.html` and `babylon.js` (Babylon.js UMD build, about 8.8 MB, downloaded from cdn.babylonjs.com). This is the **working prototype** that the user tested ("valoi khela jacce").
   - Served earlier at port 8001 with `python3 -m http.server` (sandbox process, NOT persistent; may be dead in a new session).

3. `/home/user/bus-game/`  **<-- THE REPO TO PUSH TO GITHUB**
   - Git repo initialised, branch `main`, one commit `ef8465b` ("first version: Babylon bus game + Pages + APK workflow"). **No remote yet** (user must add GitHub remote and push).
   - Files:
     - `www/index.html`  (copy of the Babylon prototype; this is the game)
     - `www/babylon.js`  (Babylon engine, local so it works offline and inside APK)
     - `package.json`    (deps: @capacitor/core ^6.1.2, @capacitor/android ^6.1.2, devDep @capacitor/cli ^6.1.2)
     - `capacitor.config.json` (appId `com.bdbus.sim`, appName `BD Bus Sim`, webDir `www`)
     - `.github/workflows/pages.yml`  (deploys `www/` to GitHub Pages on push to main)
     - `.github/workflows/build-apk.yml` (Node 20, Java 17 temurin, `npm install`, `npx cap add android` if missing, `npx cap sync android`, `./gradlew assembleDebug`, uploads `app-debug.apk` as artifact `bd-bus-sim-apk`)
     - `.gitignore` (node_modules, android/, ios/, .gradle/, *.apk, *.aab)
     - `README.md` (Bangla step-by-step for user)
     - `PROJECT_BRIEF.md` (this file)

### Babylon game features (www/index.html)

- Engine: `new BABYLON.Engine(canvas, true, {adaptToDeviceRatio:true, antialias:true})`, hardware scaling so effective DPR <= ~1.5 (performance on phones).
- Scene: sky clear color, exponential-squared fog (density 0.0028), tone mapping on.
- Lights: HemisphericLight (0.75) + DirectionalLight "sun" (1.1) with ShadowGenerator 1024, PCF filtering. Sun position follows bus each frame. Ortho shadow box fixed to +-60 m.
- Route: built procedurally from `PIECES = [[length_m, curvature_per_m], ...]`, step 2 m. Total about 3,000 m. Curvature positive = right turn. Road ribbon half-width HW = 4 m, sidewalks out to 6.5 m.
- Road: asphalt ribbon, sidewalk ribbons, merged dashed centre line, grass ground 5000x5000.
- Buildings: random heights 8–30 m, 6 colour palettes with procedural window textures (DynamicTexture). Receive shadows, do NOT cast (for performance).
- Trees: low-poly sphere + cylinder every 22 m.
- Bus stops: 5 stops at 1/6, 2/6, ... of route. Names: মিরপুর, গুলশান, উত্তরা, মতিঝিল, যাত্রাবাড়ী. Green sign with Bangla text (DynamicTexture; relies on system Bengali font).
- Rickshaws (orange box with yellow roof): obstacles at random lateral positions, every 110–230 m, cause crash if hit above 8 m/s.
- Bus model: procedural boxes (green body, white roof, yellow stripe, dark windows, red tail lights, plate, 4 wheels). Parented to a TransformNode "bus". Leans slightly in curves.
- Physics (arcade): speed `v` in m/s, `MAXV = 26` (~94 km/h display factor 3.6). Accel +7 m/s^2 (key up), passive decel -2.5, brake -12. Steering changes lateral offset `lat` at rate `(1.2 + 2.2*sp)` m/s, only if v > 0.5. Centrifugal push `lat -= curv * v^2 * dt * 0.5`. Off-road (|lat| > HW) multiplies speed by 0.45^dt. lat clamped +-6.2.
- Stops: stop when |distance| < 12 m and v < 5 m/s to pick 5–20 passengers (+2 score each). Passing a stop by more than 25 m marks "miss" (-5).
- Crash: speed *0.2, crash timer 0.8 s with shake, score -10.
- Route end: when s >= TOTAL, teleports to s = 0 and lap++ (no loop). **Known issue / TODO**.
- Score: v*dt/10 accumulates. Shown rounded.
- Camera: FreeCamera following the bus (14 m behind, 6 m up, target 8 m ahead), smoothed with exp lerp.
- HUD (DOM overlay top-left): speed, score, passengers, lap, next stop distance, FPS (engine.getFps()), help text.
- Controls: keyboard W/A/S/D or arrows; Space not used. Touch: on-screen buttons ◀ ▶ ■ ▲ shown only when `pointer:fine` is NOT matched (i.e., touch devices).
- Message toast in center, Bangla text, fades after 2.5 s.

## 4. What is NOT verified (be honest about these)

- The sandbox has **no browser/GPU**. The Babylon scene has been syntax-checked with `node --check` and the file is served with HTTP 200, but **nobody has visually verified it on a phone**. The user said "valoi khela jacce" (game runs well) for the babylon version via the preview, so basic runtime seems OK. FPS on user's phone is still unknown.
- GitHub Actions APK workflow has **not been run**. Expect possible issues: Capacitor version compatibility, Gradle/AGP versions with Java 17, `cap add android` network, artifact path. If CI fails, read the Actions log and fix.
- GitHub Pages: requires user to set Settings -> Pages -> Source = GitHub Actions.
- The Bengali font for sign texts depends on device fonts.

## 5. Things the user must do (cannot be done by the AI)

1. Create GitHub account and repo `bd-bus-sim` (public or private).
2. From `/home/user/bus-game` (download the folder or re-create), run:
   ```
   git remote add origin https://github.com/<USERNAME>/bd-bus-sim.git
   git push -u origin main
   ```
   The AI has no GitHub credentials, so it cannot push. Git credentials are in the user's environment, not in the sandbox.
3. Settings -> Pages -> Source: GitHub Actions.
4. Check Actions tab for "Deploy to GitHub Pages" and "Build Android APK". Download `bd-bus-sim-apk` artifact, install `app-debug.apk` on phone (allow unknown sources).

## 6. Known limitations / TODO list (priority order)

**High priority**
1. Verify APK workflow runs green. Fix Gradle/Capacitor issues if any. Capacitor 6 + Java 17 is chosen for compatibility.
2. Confirm the game works inside the APK WebView (WebGL on Android WebView must be enabled; Capacitor default is fine).
3. Get real FPS numbers from user's phone. If < 30 FPS, lower DRAW/buildings count, reduce shadow map, or disable shadows on low-end.
4. Route end: make the route a loop or a long continuous track instead of teleport to start.

**Graphics upgrade (user asked for realistic look)**
5. PBR materials (`PBRMaterial`) with roughness/metallic for bus paint, glass, metal. Add an environment texture (`scene.createDefaultEnvironment` or HDR from Poly Haven, CC0) for image-based lighting.
6. Better textures: CC0 asphalt, concrete, brick, grass (Poly Haven). Normal maps for road/buildings.
7. Replace procedural bus with a better model: CC0/original glTF (`.glb`) loaded via `BABYLON.SceneLoader`. Use only CC0 or user-owned models. Don't use BUSSID or real company bus designs.
8. Post-processing: FXAA (cheap), optional SSAO / bloom for high-end devices only. Use quality tiers detected from `engine.getGlInfo()` or a user toggle.
9. Instancing (`mesh.createInstance`) for buildings/trees to cut draw calls.
10. Let buildings cast shadows only near the bus (shadow LOD) or bake ambient occlusion.

**Gameplay / feel (user wants feel similar to BUSSID)**
11. Better steering model: steering wheel angle, lateral grip, speed-dependent steering, reverse gear.
12. Passenger system: passengers as small meshes boarding; fare collection; conductor/helper character; ticket money.
13. Mission/career mode: route list (Dhaka–Chattogram, Mirpur loop, Jatrabari etc.), money, bus unlocks.
14. Traffic: AI cars, CNG (auto-rickshaw), rickshaw vans, buses. Traffic lights.
15. Day/night cycle, weather (rain particles).
16. Audio: engine sound, horn (original, royalty-free e.g. Freesound CC0 or generated), ambient city noise. Web Audio or Babylon Sound.
17. Bus customisation: colour picker, livery text, horn choice, interior colours. Store with `localStorage`.
18. Sound/haptics on crash (navigator.vibrate on Android WebView).

**Platform / release**
19. Signed release APK/AAB for Play Store (needs keystore, Google Play developer account ~USD 25 one-time). Use GitHub Actions secrets for keystore.
20. Privacy policy page if collecting data (not needed right now).
21. Localisation: keep UI in Bangla with an English fallback option.

## 7. Conversation history summary (what the user asked, in order)

1. "Bus simulator indonesia game ta ki tumi cino" -> Explained BUSSID.
2. "Ami amon game banate cai jeta Bangladesh niye hobe" -> Plan: original Bangladesh-themed bus game, avoid copyright, pick tech.
3. User answered: platform = web, goal = Play Store, scope = full. Built first 2D prototype.
4. "Amar BUSSID-er moto same lagbe APK diye" -> Declined direct copy; offered original game with similar genre/feel.
5. "Ami oder copy korte boli nai... Mobile diye Unity te build korte parbo?" -> Explained Unity Editor needs PC; options given.
6. User chose "mobile only". Suggested PWABuilder / HTML-to-APK / GDevelop; recommended web route.
7. "Browser a banale lag hote pare" -> Explained lag causes; added FPS counter and HUD throttling.
8. "Browser a keno valo graphics feature hobe na" -> Explained browser graphics are not inherently limited; WebGL can do better; proposed Three.js/Babylon.js.
9. "Unity bad diye phone diyei valo graphics technology diye better game lagbe" -> Built Babylon.js prototype in `bd-bus-sim/babylon/`.
10. "Valoi khela jacce, graphics ki BUSSID ar moto realistic kora jabe?" -> Honest answer: close on good phones, not identical. Listed upgrade path (PBR, textures, CC0 models, instancing, post-processing).
11. "Unity ba godot ta cara free te ar kono upay nai" -> Listed free alternatives: Babylon.js/Three.js web, PlayCanvas, PWABuilder/HTML-to-APK, GitHub Actions, native Android (needs PC), GDevelop (2D).
12. "Baylon + git" -> Built `/home/user/bus-game/` repo with Pages + APK workflows, README, git commit.
13. Current request -> Write this PROJECT_BRIEF.md so any new session understands everything.

## 8. How a new session should continue

- First read this file, then `README.md`, then `www/index.html`.
- Check whether the user has pushed to GitHub. Ask them for their GitHub username (for README links) and for the Actions status/logs if the APK build failed.
- Keep responses in Banglish/Bangla as the user does. Keep answers short, practical, and step-by-step (the user is on a phone).
- Do not claim things were tested on a phone unless the user confirmed them.
- Do not copy BUSSID or use real company trademarks/logos. Original assets only.
- Prioritise: (a) make CI APK build green, (b) get FPS feedback, (c) fix route-end loop, (d) then graphics upgrade (PBR + CC0 textures), (e) then gameplay features.
- When making big changes, update this PROJECT_BRIEF.md so the next session stays in sync.

## 9. Quick reference

- App name: BD Bus Sim
- Package id: com.bdbus.sim
- Web entry: `www/index.html` (Babylon.js global `BABYLON`, local `www/babylon.js`)
- Units: metres, m/s. Display speed = m/s * 3.6 km/h.
- Route total length: about 3,000 m (computed from PIECES).
- Stop distance tolerance: 12 m. Stop max speed: 5 m/s. Miss threshold: 25 m past.
- Rickshaw collision: |ds| < 2.2 m and |lat diff| < 1.7 m and speed > 8 m/s.
- Pages URL pattern: `https://<USERNAME>.github.io/bd-bus-sim/`
- Artifact name: `bd-bus-sim-apk` containing `app-debug.apk`.
