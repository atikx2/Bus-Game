/* =============================================================================
 * BD Bus Sim — Babylon.js presentation layer
 * Builds the 3D world from a BusSim world object and renders the bus/camera.
 * UMD so it can be exercised headlessly with BABYLON.NullEngine in Node.
 * Canvas-only features (DynamicTexture) are skipped when `document` is absent.
 * ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./core.js'));
  } else {
    root.BusGfx = factory(root.BusSim);
  }
})(typeof self !== 'undefined' ? self : this, function (BusSim) {
  'use strict';

  var BABYLON = (typeof window !== 'undefined' && window.BABYLON) ||
    (typeof globalThis !== 'undefined' && globalThis.BABYLON);

  var hasCanvas = typeof document !== 'undefined' && !!document.createElement;

  var QUALITY = {
    low:  { shadowMap: 0,    shadows: false, bloom: false, scale: 1.6,  dashes: false, treesEvery: 3 },
    med:  { shadowMap: 1024, shadows: true,  bloom: false, scale: 1.25, dashes: true,  treesEvery: 2 },
    high: { shadowMap: 2048, shadows: true,  bloom: true,  scale: 1.0,  dashes: true,  treesEvery: 1 }
  };

  /* ------------------------------------------------------------------ helpers */
  function pbr(scene, name, o) {
    var m = new BABYLON.PBRMaterial(name, scene);
    m.albedoColor = o.color || new BABYLON.Color3(0.8, 0.8, 0.8);
    m.metallic = o.metallic === undefined ? 0 : o.metallic;
    m.roughness = o.roughness === undefined ? 0.8 : o.roughness;
    if (o.alpha !== undefined) { m.alpha = o.alpha; m.needAlphaBlending = function () { return true; }; }
    if (o.emissive) m.emissiveColor = o.emissive;
    if (o.backFaceCulling !== undefined) m.backFaceCulling = o.backFaceCulling;
    m.environmentIntensity = o.envIntensity === undefined ? 0.7 : o.envIntensity;
    if (o.clearCoat) {
      m.clearCoat.isEnabled = true;
      m.clearCoat.intensity = 0.9;
      m.clearCoat.roughness = 0.06;
    }
    return m;
  }

  // procedural sky/ground cube for image based lighting (no external assets)
  function makeEnvironment(scene, size) {
    if (!scene.getEngine().caps || scene.getEngine() instanceof BABYLON.NullEngine) return null;
    try {
      var n = size || 32, faces = [], f, i, j, u, v;
      var sky = [0.42, 0.62, 0.92], horizon = [0.86, 0.88, 0.92], ground = [0.24, 0.26, 0.22];
      for (f = 0; f < 6; f++) {
        var data = new Uint8Array(n * n * 4);
        for (j = 0; j < n; j++) {
          for (i = 0; i < n; i++) {
            u = i / (n - 1); v = j / (n - 1);
            var up = (f === 2) ? 1 : (f === 3) ? 0 : (1 - v);
            var c = up > 0.5
              ? [sky[0] * (up - 0.5) * 2 + horizon[0] * (1 - (up - 0.5) * 2),
                 sky[1] * (up - 0.5) * 2 + horizon[1] * (1 - (up - 0.5) * 2),
                 sky[2] * (up - 0.5) * 2 + horizon[2] * (1 - (up - 0.5) * 2)]
              : [horizon[0] * up * 2 + ground[0] * (1 - up * 2),
                 horizon[1] * up * 2 + ground[1] * (1 - up * 2),
                 horizon[2] * up * 2 + ground[2] * (1 - up * 2)];
            // crude sun blob on one face so the paint has a highlight to catch
            if (f === 0 && u > 0.35 && u < 0.6 && v > 0.1 && v < 0.3) {
              c = [Math.min(1, c[0] + 1.4), Math.min(1, c[1] + 1.3), Math.min(1, c[2] + 1.1)];
            }
            var o = (j * n + i) * 4;
            data[o] = c[0] * 255; data[o + 1] = c[1] * 255; data[o + 2] = c[2] * 255; data[o + 3] = 255;
          }
        }
        faces.push(data);
      }
      var tex = new BABYLON.RawCubeTexture(scene, faces, n,
        BABYLON.Engine.TEXTUREFORMAT_RGBA, BABYLON.Engine.TEXTURETYPE_UNSIGNED_BYTE,
        true, false, BABYLON.Engine.TEXTURE_TRILINEAR_SAMPLINGMODE, undefined, true);
      tex.gammaSpace = true;
      return tex;
    } catch (e) {
      console.warn('environment map failed, continuing without IBL:', e.message);
      return null;
    }
  }

  function gradientTexture(scene, w, h, stops) {
    if (!hasCanvas) return null;
    try {
      var t = new BABYLON.DynamicTexture('grad', { width: w, height: h }, scene, false);
      var ctx = t.getContext();
      var g = ctx.createLinearGradient(0, 0, 0, h);
      for (var i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      t.update();
      t.hasAlpha = false;
      return t;
    } catch (e) { console.warn('gradient texture failed:', e.message); return null; }
  }

  function windowTexture(scene, variant) {
    if (!hasCanvas) return null;
    try {
      var S = 256;
      var t = new BABYLON.DynamicTexture('win' + variant, { width: S, height: S }, scene, true);
      var ctx = t.getContext();
      ctx.fillStyle = ['#6d6455', '#5c6067', '#7a6f60'][variant % 3];
      ctx.fillRect(0, 0, S, S);
      var cols = 5, rows = 7, pw = S / cols, ph = S / rows;
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          var lit = Math.random() < 0.35;
          ctx.fillStyle = lit ? '#ffd892' : (Math.random() < 0.5 ? '#2b3440' : '#39434f');
          ctx.fillRect(c * pw + pw * 0.22, r * ph + ph * 0.2, pw * 0.56, ph * 0.5);
        }
      }
      t.update();
      return t;
    } catch (e) { console.warn('window texture failed:', e.message); return null; }
  }

  /* =========================================================================
   * BUS MODEL (procedural, original design — no real operator livery)
   * ======================================================================= */
  function buildBus(scene, mats) {
    var root = new BABYLON.TransformNode('bus', scene);
    var body = new BABYLON.TransformNode('busBody', scene);
    body.parent = root;

    var L = 11.8, W = 2.5, H = 3.05;

    function box(name, w, h, d, x, y, z, mat, parent) {
      var m = BABYLON.MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
      m.position.set(x, y, z);
      m.material = mat;
      m.parent = parent || body;
      return m;
    }

    // lower body / upper body / roof
    box('lower', W, 1.15, L, 0, 0.95, 0, mats.busPaint);
    box('upper', W - 0.06, 1.25, L - 0.1, 0, 2.1, 0, mats.busPaint);
    box('roof', W - 0.16, 0.22, L - 0.3, 0, 2.83, 0, mats.busRoof);
    // yellow band (Bangladeshi city bus cue, original colour scheme)
    box('band', W + 0.02, 0.24, L - 0.05, 0, 1.55, 0, mats.busStripe);
    // window glass: one wrap strip per side + windscreen + rear
    box('glassL', 0.06, 0.95, L - 2.4, -(W / 2) - 0.01, 2.15, -0.3, mats.glass);
    box('glassR', 0.06, 0.95, L - 2.4, (W / 2) + 0.01, 2.15, -0.3, mats.glass);
    box('wind', W - 0.3, 1.05, 0.06, 0, 2.15, L / 2 - 0.02, mats.glass);
    box('rear', W - 0.3, 1.0, 0.06, 0, 2.1, -L / 2 + 0.02, mats.glass);
    // front / rear details
    box('bumperF', W - 0.1, 0.4, 0.3, 0, 0.55, L / 2 - 0.05, mats.dark);
    box('bumperR', W - 0.1, 0.4, 0.3, 0, 0.55, -L / 2 + 0.05, mats.dark);
    var hl1 = box('hl1', 0.42, 0.22, 0.1, -0.78, 0.95, L / 2 + 0.01, mats.headlight);
    var hl2 = box('hl2', 0.42, 0.22, 0.1, 0.78, 0.95, L / 2 + 0.01, mats.headlight);
    box('tl1', 0.34, 0.2, 0.1, -0.85, 1.0, -L / 2 - 0.01, mats.taillight);
    box('tl2', 0.34, 0.2, 0.1, 0.85, 1.0, -L / 2 - 0.01, mats.taillight);
    box('plate', 0.7, 0.24, 0.05, 0, 0.62, -L / 2 - 0.02, mats.plate);
    box('mirrorL', 0.12, 0.3, 0.22, -(W / 2) - 0.2, 2.2, L / 2 - 1.4, mats.dark);
    box('mirrorR', 0.12, 0.3, 0.22, (W / 2) + 0.2, 2.2, L / 2 - 1.4, mats.dark);
    // door (right side, kerb side)
    var door = box('door', 0.05, 1.9, 1.5, W / 2 + 0.02, 1.5, 2.6, mats.doorMat);

    // destination sign
    if (hasCanvas) {
      try {
        var st = new BABYLON.DynamicTexture('sign', { width: 256, height: 64 }, scene, true);
        var c2 = st.getContext();
        c2.fillStyle = '#101418'; c2.fillRect(0, 0, 256, 64);
        c2.fillStyle = '#ffc23a'; c2.font = 'bold 34px sans-serif';
        c2.textAlign = 'center'; c2.textBaseline = 'middle';
        c2.fillText('গুলশান → মতিঝিল', 128, 34);
        st.update();
        var signMat = pbr(scene, 'signMat', { color: new BABYLON.Color3(0.05, 0.05, 0.05), roughness: 0.5, emissive: new BABYLON.Color3(1, 1, 1) });
        signMat.emissiveTexture = st;
        signMat.albedoColor = new BABYLON.Color3(0, 0, 0);
        var sign = box('sign', 1.7, 0.42, 0.06, 0, 2.72, L / 2 - 0.06, signMat);
      } catch (e) { /* sign is cosmetic */ }
    }

    /* wheels: cylinder axis along X, front pair steerable via a pivot */
    var wheels = [], steers = [];
    var positions = [
      { x: -(W / 2) + 0.05, z: 3.9, front: true }, { x: (W / 2) - 0.05, z: 3.9, front: true },
      { x: -(W / 2) + 0.05, z: -3.6, front: false }, { x: (W / 2) - 0.05, z: -3.6, front: false }
    ];
    positions.forEach(function (p, i) {
      var pivot = new BABYLON.TransformNode('wheelpivot' + i, scene);
      pivot.parent = body;
      pivot.position.set(p.x, 0.52, p.z);
      var w = BABYLON.MeshBuilder.CreateCylinder('wheel' + i,
        { diameter: 1.04, height: 0.3, tessellation: 18 }, scene);
      w.rotation.z = Math.PI / 2;
      w.material = mats.tire;
      w.parent = pivot;
      var rim = BABYLON.MeshBuilder.CreateCylinder('rim' + i,
        { diameter: 0.55, height: 0.32, tessellation: 12 }, scene);
      rim.rotation.z = Math.PI / 2;
      rim.material = mats.rim;
      rim.parent = pivot;
      wheels.push({ spin: w, rim: rim, pivot: pivot });
      steers.push(pivot);
    });

    return {
      root: root, body: body, door: door,
      wheels: wheels, steerPivots: [steers[0], steers[1]],
      headlights: [hl1, hl2],
      length: L, width: W, height: H
    };
  }

  /* =========================================================================
   * TRAFFIC VEHICLE (simple box + roof, per kind)
   * ======================================================================= */
  function buildTrafficMesh(scene, mats, v) {
    var root = new BABYLON.TransformNode('car' + v.id, scene);
    var mat = mats.traffic[v.kind] || mats.traffic.car;
    var b = BABYLON.MeshBuilder.CreateBox('cb' + v.id,
      { width: v.wid * 2, height: v.hgt, depth: v.len }, scene);
    b.position.y = v.hgt / 2 + 0.25;
    b.material = mat;
    b.parent = root;
    var roof = BABYLON.MeshBuilder.CreateBox('cr' + v.id,
      { width: v.wid * 2 - 0.2, height: 0.22, depth: v.len * 0.55 }, scene);
    roof.position.set(0, v.hgt + 0.3, -v.len * 0.08);
    roof.material = mats.dark;
    roof.parent = root;
    return { root: root, body: b, roof: roof };
  }

  /* =========================================================================
   * WORLD BUILD
   * ======================================================================= */
  function buildWorld(scene, world, opts) {
    opts = opts || {};
    var q = QUALITY[opts.quality || 'med'] || QUALITY.med;
    var route = world.route, HW = world.hw, WW = world.ww;
    var mats = {}, meshes = {};

    /* ---- materials ---------------------------------------------------- */
    mats.asphalt = pbr(scene, 'asphalt', { color: new BABYLON.Color3(0.13, 0.13, 0.14), roughness: 0.96, metallic: 0 });
    mats.walk = pbr(scene, 'walk', { color: new BABYLON.Color3(0.46, 0.44, 0.41), roughness: 0.92 });
    mats.grass = pbr(scene, 'grass', { color: new BABYLON.Color3(0.19, 0.28, 0.15), roughness: 1 });
    mats.line = pbr(scene, 'line', { color: new BABYLON.Color3(0.85, 0.85, 0.8), roughness: 0.6, emissive: new BABYLON.Color3(0.12, 0.12, 0.1) });
    mats.dark = pbr(scene, 'dark', { color: new BABYLON.Color3(0.09, 0.09, 0.1), roughness: 0.7 });
    mats.busPaint = pbr(scene, 'busPaint', { color: new BABYLON.Color3(0.06, 0.34, 0.19), roughness: 0.28, metallic: 0.85, clearCoat: true });
    mats.busRoof = pbr(scene, 'busRoof', { color: new BABYLON.Color3(0.86, 0.87, 0.85), roughness: 0.45, metallic: 0.3 });
    mats.busStripe = pbr(scene, 'busStripe', { color: new BABYLON.Color3(0.93, 0.72, 0.13), roughness: 0.35, metallic: 0.6 });
    mats.glass = pbr(scene, 'glass', { color: new BABYLON.Color3(0.06, 0.09, 0.12), roughness: 0.06, metallic: 0.95, alpha: 0.42 });
    mats.tire = pbr(scene, 'tire', { color: new BABYLON.Color3(0.06, 0.06, 0.07), roughness: 0.88 });
    mats.rim = pbr(scene, 'rim', { color: new BABYLON.Color3(0.72, 0.73, 0.75), roughness: 0.25, metallic: 1 });
    mats.headlight = pbr(scene, 'hl', { color: new BABYLON.Color3(0.9, 0.95, 1), roughness: 0.1, emissive: new BABYLON.Color3(1, 0.98, 0.85) });
    mats.taillight = pbr(scene, 'tl', { color: new BABYLON.Color3(0.5, 0.05, 0.05), roughness: 0.3, emissive: new BABYLON.Color3(0.85, 0.06, 0.05) });
    mats.plate = pbr(scene, 'plate', { color: new BABYLON.Color3(0.9, 0.9, 0.85), roughness: 0.5 });
    mats.doorMat = pbr(scene, 'door', { color: new BABYLON.Color3(0.12, 0.2, 0.16), roughness: 0.4, metallic: 0.5 });
    mats.trunk = pbr(scene, 'trunk', { color: new BABYLON.Color3(0.28, 0.2, 0.13), roughness: 0.95 });
    mats.leaf = pbr(scene, 'leaf', { color: new BABYLON.Color3(0.16, 0.36, 0.16), roughness: 0.9 });
    mats.pole = pbr(scene, 'pole', { color: new BABYLON.Color3(0.3, 0.31, 0.33), roughness: 0.6, metallic: 0.7 });
    mats.lampGlow = pbr(scene, 'lampGlow', { color: new BABYLON.Color3(1, 0.9, 0.7), roughness: 0.3, emissive: new BABYLON.Color3(0.9, 0.8, 0.5) });
    mats.stopSign = pbr(scene, 'stopSign', { color: new BABYLON.Color3(0.05, 0.45, 0.2), roughness: 0.5, emissive: new BABYLON.Color3(0.02, 0.12, 0.05) });
    mats.traffic = {};
    ['car', 'cng', 'rickshaw', 'bus', 'truck'].forEach(function (k, i) {
      var cols = {
        car: [0.78, 0.79, 0.82], cng: [0.16, 0.42, 0.2], rickshaw: [0.82, 0.35, 0.13],
        bus: [0.14, 0.32, 0.62], truck: [0.44, 0.46, 0.5]
      };
      mats.traffic[k] = pbr(scene, 'tr_' + k, {
        color: new BABYLON.Color3(cols[k][0], cols[k][1], cols[k][2]),
        roughness: 0.42, metallic: 0.55
      });
    });
    var bldMats = [0, 1, 2, 3, 4, 5].map(function (i) {
      var m = pbr(scene, 'bld' + i, { color: new BABYLON.Color3(0.7, 0.65, 0.58), roughness: 0.85, metallic: 0.05 });
      var tex = windowTexture(scene, i);
      if (tex) { m.albedoTexture = tex; m.albedoTexture.uScale = 2; m.albedoTexture.vScale = 3; }
      return m;
    });

    /* ---- ground -------------------------------------------------------- */
    var ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 4000, height: 4000, subdivisions: 2 }, scene);
    ground.material = mats.grass;
    ground.position.y = -0.05;
    ground.receiveShadows = true;
    meshes.ground = ground;

    /* ---- road + sidewalks (ribbons along the route) -------------------- */
    function ribbon(name, latA, latB, y, mat) {
      var left = [], right = [], i, p;
      for (i = 0; i <= route.n; i++) {
        p = BusSim.at(route, i * route.step, latA); left.push(new BABYLON.Vector3(p.x, y, p.z));
        p = BusSim.at(route, i * route.step, latB); right.push(new BABYLON.Vector3(p.x, y, p.z));
      }
      var m = BABYLON.MeshBuilder.CreateRibbon(name, {
        pathArray: [left, right], sideOrientation: BABYLON.Mesh.DOUBLESIDE, updatable: false
      }, scene);
      m.material = mat;
      m.receiveShadows = true;
      return m;
    }
    meshes.road = ribbon('road', -HW, HW, 0, mats.asphalt);
    meshes.walkL = ribbon('walkL', HW, WW, 0.16, mats.walk);
    meshes.walkR = ribbon('walkR', -WW, -HW, 0.16, mats.walk);

    /* ---- lane markings -------------------------------------------------- */
    if (q.dashes) {
      var dashSrc = BABYLON.MeshBuilder.CreateBox('dash', { width: 0.18, height: 0.02, depth: 3.2 }, scene);
      dashSrc.material = mats.line;
      dashSrc.setEnabled(false);
      var dashes = [];
      for (var d = 0; d < route.total; d += 8) {
        var dp = BusSim.at(route, d, 0);
        var inst = dashSrc.createInstance('dash' + d);
        inst.position.set(dp.x, 0.012, dp.z);
        inst.rotation.y = dp.hdg;
        dashes.push(inst);
      }
      meshes.dashSrc = dashSrc; meshes.dashes = dashes;
    }
    // solid edge lines
    meshes.edgeL = ribbon('edgeL', HW - 0.35, HW - 0.15, 0.012, mats.line);
    meshes.edgeR = ribbon('edgeR', -HW + 0.15, -HW + 0.35, 0.012, mats.line);

    /* ---- buildings (instanced per palette) ------------------------------ */
    var bldSrc = BABYLON.MeshBuilder.CreateBox('bld', { size: 1 }, scene);
    bldSrc.material = bldMats[0];
    bldSrc.setEnabled(false);
    var bldInst = [];
    for (var bi = 0; bi < world.buildings.length; bi++) {
      var b = world.buildings[bi];
      var bp = BusSim.at(route, b.s, b.lat);
      var inst2 = bldSrc.createInstance('b' + bi);
      inst2.position.set(bp.x, b.h / 2, bp.z);
      inst2.rotation.y = bp.hdg + Math.PI / 2;
      inst2.scaling.set(b.w, b.h, b.len);
      bldInst.push({ inst: inst2, palette: b.windows % bldMats.length });
    }
    meshes.buildingSrc = bldSrc; meshes.buildings = bldInst;

    /* ---- trees (instanced) ---------------------------------------------- */
    var trunkSrc = BABYLON.MeshBuilder.CreateCylinder('trunk', { diameter: 0.42, height: 1, tessellation: 7 }, scene);
    trunkSrc.material = mats.trunk; trunkSrc.setEnabled(false);
    var leafSrc = BABYLON.MeshBuilder.CreateSphere('leaf', { diameter: 1, segments: 6 }, scene);
    leafSrc.material = mats.leaf; leafSrc.setEnabled(false);
    var trees = [];
    for (var ti = 0; ti < world.trees.length; ti += q.treesEvery) {
      var tr = world.trees[ti];
      var tp = BusSim.at(route, tr.s, tr.lat);
      var t1 = trunkSrc.createInstance('t' + ti);
      t1.position.set(tp.x, tr.h * 0.3, tp.z);
      t1.scaling.set(1, tr.h * 0.6, 1);
      var t2 = leafSrc.createInstance('l' + ti);
      t2.position.set(tp.x, tr.h * 0.78, tp.z);
      t2.scaling.set(tr.r * 2, tr.r * 1.7, tr.r * 2);
      trees.push(t1, t2);
    }
    meshes.trunkSrc = trunkSrc; meshes.leafSrc = leafSrc; meshes.trees = trees;

    /* ---- street lamps ---------------------------------------------------- */
    var poleSrc = BABYLON.MeshBuilder.CreateCylinder('pole', { diameter: 0.16, height: 7, tessellation: 6 }, scene);
    poleSrc.material = mats.pole; poleSrc.setEnabled(false);
    var glowSrc = BABYLON.MeshBuilder.CreateSphere('glow', { diameter: 0.5, segments: 5 }, scene);
    glowSrc.material = mats.lampGlow; glowSrc.setEnabled(false);
    var lamps = [];
    for (var li = 0; li < world.lamps.length; li++) {
      var lp0 = world.lamps[li];
      var lp = BusSim.at(route, lp0.s, lp0.lat);
      var p1 = poleSrc.createInstance('p' + li);
      p1.position.set(lp.x, 3.5, lp.z);
      var p2 = glowSrc.createInstance('g' + li);
      p2.position.set(lp.x, 6.9, lp.z);
      lamps.push(p1, p2);
    }
    meshes.poleSrc = poleSrc; meshes.glowSrc = glowSrc; meshes.lamps = lamps;

    /* ---- bus stops -------------------------------------------------------- */
    var stops = [];
    for (var si = 0; si < world.stops.length; si++) {
      var st0 = world.stops[si];
      var sp = BusSim.at(route, st0.s, st0.lat);
      var sRoot = new BABYLON.TransformNode('stop' + si, scene);
      sRoot.position.set(sp.x, 0, sp.z);
      sRoot.rotation.y = sp.hdg;
      var pole2 = BABYLON.MeshBuilder.CreateCylinder('spole' + si, { diameter: 0.14, height: 3.4, tessellation: 6 }, scene);
      pole2.position.y = 1.7; pole2.material = mats.pole; pole2.parent = sRoot;
      var board = BABYLON.MeshBuilder.CreateBox('sboard' + si, { width: 2.4, height: 0.75, depth: 0.1 }, scene);
      board.position.set(0, 3.0, 0); board.material = mats.stopSign; board.parent = sRoot;
      var shelter = BABYLON.MeshBuilder.CreateBox('sshelter' + si, { width: 4.5, height: 0.18, depth: 2.0 }, scene);
      shelter.position.set(0, 2.5, 0.9); shelter.material = mats.pole; shelter.parent = sRoot;
      var bench = BABYLON.MeshBuilder.CreateBox('sbench' + si, { width: 3.4, height: 0.14, depth: 0.6 }, scene);
      bench.position.set(0, 0.55, 1.4); bench.material = mats.walk; bench.parent = sRoot;

      if (hasCanvas) {
        try {
          var stex = new BABYLON.DynamicTexture('stex' + si, { width: 256, height: 80 }, scene, true);
          var sc = stex.getContext();
          sc.fillStyle = '#0b6b34'; sc.fillRect(0, 0, 256, 80);
          sc.fillStyle = '#ffffff'; sc.font = 'bold 40px sans-serif';
          sc.textAlign = 'center'; sc.textBaseline = 'middle';
          sc.fillText(st0.name, 128, 42);
          stex.update();
          var smat = pbr(scene, 'smat' + si, { color: new BABYLON.Color3(0.05, 0.4, 0.2), roughness: 0.5, emissive: new BABYLON.Color3(1, 1, 1) });
          smat.emissiveTexture = stex; smat.albedoColor = new BABYLON.Color3(0, 0, 0);
          board.material = smat;
        } catch (e) { /* keep plain green board */ }
      }
      stops.push({ root: sRoot, board: board, data: st0 });
    }
    meshes.stops = stops;

    /* ---- bus + traffic ----------------------------------------------------- */
    var bus = buildBus(scene, mats);
    meshes.bus = bus;

    return { mats: mats, meshes: meshes, bus: bus, quality: q };
  }

  /* =========================================================================
   * SCENE: lights, sky, fog, shadows, post-processing
   * ======================================================================= */
  function createScene(engine, opts) {
    opts = opts || {};
    var scene = new BABYLON.Scene(engine);
    var q = QUALITY[opts.quality || 'med'] || QUALITY.med;

    scene.clearColor = new BABYLON.Color4(0.66, 0.78, 0.92, 1);
    scene.ambientColor = new BABYLON.Color3(0.35, 0.37, 0.4);
    scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.0021;
    scene.fogColor = new BABYLON.Color3(0.72, 0.8, 0.9);

    var hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0.2, 1, 0.15), scene);
    hemi.intensity = 0.85;
    hemi.diffuse = new BABYLON.Color3(0.86, 0.92, 1.0);
    hemi.groundColor = new BABYLON.Color3(0.28, 0.26, 0.2);
    hemi.specular = new BABYLON.Color3(0.15, 0.16, 0.18);

    var sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-0.45, -0.82, -0.35), scene);
    sun.intensity = 2.3;
    sun.diffuse = new BABYLON.Color3(1.0, 0.95, 0.86);
    sun.specular = new BABYLON.Color3(0.9, 0.88, 0.8);
    sun.position = new BABYLON.Vector3(60, 90, 60);
    sun.shadowMinZ = 1; sun.shadowMaxZ = 220;
    sun.autoUpdateExtends = false;
    sun.orthoLeft = -70; sun.orthoRight = 70; sun.orthoTop = 70; sun.orthoBottom = -70;

    var env = makeEnvironment(scene, 32);
    if (env) scene.environmentTexture = env;

    // sky dome (emissive gradient, unlit)
    if (hasCanvas) {
      var skyTex = gradientTexture(scene, 8, 256, [
        [0, '#2f6fc4'], [0.35, '#7fb2e8'], [0.62, '#cfe2f5'], [0.8, '#e9eef2'], [1, '#b9c3bd']
      ]);
      if (skyTex) {
        var dome = BABYLON.MeshBuilder.CreateSphere('sky', { diameter: 3600, segments: 12, sideOrientation: BABYLON.Mesh.BACKSIDE }, scene);
        var dm = new BABYLON.StandardMaterial('skyMat', scene);
        dm.emissiveTexture = skyTex;
        dm.disableLighting = true;
        dm.backFaceCulling = false;
        dome.material = dm;
        dome.applyFog = false;
        dome.infiniteDistance = true;
        scene.sky = dome;
      }
    }

    var sg = null;
    if (q.shadows && q.shadowMap) {
      sg = new BABYLON.ShadowGenerator(q.shadowMap, sun);
      sg.usePercentageCloserFiltering = true;
      sg.filteringQuality = BABYLON.ShadowGenerator.QUALITY_MEDIUM;
      sg.darkness = 0.25;
      sg.bias = 0.0006;
      sg.normalBias = 0.02;
    }

    var camera = new BABYLON.FreeCamera('cam', new BABYLON.Vector3(0, 8, -20), scene);
    camera.minZ = 0.4; camera.maxZ = 1800;
    camera.fov = 1.05;
    camera.inputs.clear();          // fully scripted camera

    var pipeline = null;
    if (opts.post !== false) {
      try {
        pipeline = new BABYLON.DefaultRenderingPipeline('pp', true, scene, [camera]);
        pipeline.fxaaEnabled = true;
        pipeline.imageProcessingEnabled = true;
        pipeline.imageProcessing.contrast = 1.15;
        pipeline.imageProcessing.exposure = 1.06;
        pipeline.imageProcessing.toneMappingEnabled = true;
        pipeline.imageProcessing.vignetteEnabled = true;
        pipeline.imageProcessing.vignetteWeight = 1.6;
        if (q.bloom) {
          pipeline.bloomEnabled = true;
          pipeline.bloomThreshold = 0.72;
          pipeline.bloomWeight = 0.32;
          pipeline.bloomScale = 0.5;
        }
      } catch (e) { console.warn('post-processing unavailable:', e.message); }
    }

    return {
      scene: scene, camera: camera, sun: sun, hemi: hemi,
      shadowGenerator: sg, pipeline: pipeline, quality: q, qualityName: opts.quality || 'med'
    };
  }

  /* =========================================================================
   * PER-FRAME UPDATE
   * ======================================================================= */
  function makeUpdater(ctx, world, gfx, opts) {
    opts = opts || {};
    var scene = ctx.scene, camera = ctx.camera, sun = ctx.sun, sg = ctx.shadowGenerator;
    var bus = gfx.bus;
    var camPos = new BABYLON.Vector3(0, 9, -22);
    var camTgt = new BABYLON.Vector3();
    var smoothed = null;
    var trafficMeshes = [];

    // register shadows for bus + traffic bodies
    function addShadow(mesh) { if (sg && mesh) { sg.addShadowCaster(mesh); } }
    bus.body.getChildMeshes().forEach(addShadow);
    bus.wheels.forEach(function (w) { addShadow(w.spin); addShadow(w.rim); });

    return {
      trafficMeshes: trafficMeshes,
      ensureTraffic: function (list) {
        while (trafficMeshes.length < list.length) {
          var m = buildTrafficMesh(scene, gfx.mats, list[trafficMeshes.length]);
          addShadow(m.body);
          trafficMeshes.push(m);
        }
      },
      update: function (busState, traffic, dt, camMode, shake) {
        var route = world.route;
        var pose = BusSim.at(route, busState.s, busState.lat);

        bus.root.position.set(pose.x, 0, pose.z);
        bus.root.rotation.y = pose.hdg + busState.psi;

        // body roll / pitch from yaw rate and acceleration
        var roll = -busState.yawRate * busState.v * 0.012;
        bus.body.rotation.z = BABYLON.Scalar.Lerp(bus.body.rotation.z, BusSim.helpers.clamp(roll, -0.09, 0.09), 0.15);
        bus.body.rotation.x = BABYLON.Scalar.Lerp(bus.body.rotation.x, BusSim.helpers.clamp(-busState.accel * 0.012, -0.05, 0.05), 0.12);
        // off-road bounce
        if (busState.offroad) {
          bus.body.position.y = Math.sin(busState.odo * 2.1) * 0.05;
        } else {
          bus.body.position.y = BABYLON.Scalar.Lerp(bus.body.position.y, 0, 0.2);
        }

        // wheels
        for (var i = 0; i < bus.wheels.length; i++) {
          var w = bus.wheels[i];
          w.spin.rotation.x = busState.wheelSpin;
          w.rim.rotation.x = busState.wheelSpin;
        }
        bus.steerPivots[0].rotation.y = busState.steer;
        bus.steerPivots[1].rotation.y = busState.steer;
        bus.door.position.x = (bus.doorOpen ? 0.55 : 0) + gfx.bus.width / 2 + 0.02;

        // traffic
        this.ensureTraffic(traffic);
        for (var t = 0; t < traffic.length; t++) {
          var c = traffic[t];
          var cp = BusSim.at(route, c.s, c.lat);
          var tm = trafficMeshes[t];
          tm.root.position.set(cp.x, 0, cp.z);
          tm.root.rotation.y = cp.hdg + (c.dir < 0 ? Math.PI : 0);
        }

        // sun follows the bus so the shadow box stays tight
        sun.position.set(pose.x + 70, 95, pose.z + 55);
        if (scene.sky) scene.sky.position.set(pose.x, 0, pose.z);

        // chase camera
        var behind = (camMode === 2) ? 8.5 : (camMode === 3 ? 2.0 : 15.5);
        var up = (camMode === 2) ? 4.2 : (camMode === 3 ? 3.1 : 6.4);
        var anchor = BusSim.at(route, busState.s - behind, busState.lat * 0.55);
        camPos.set(anchor.x, up, anchor.z);
        var look = BusSim.at(route, busState.s + 9, busState.lat * 0.35);
        camTgt.set(look.x, 2.2 + Math.min(2.2, busState.v * 0.05), look.z);

        var k = 1 - Math.exp(-dt * 7.5);
        if (!smoothed) { smoothed = { p: camPos.clone(), t: camTgt.clone() }; }
        smoothed.p.x += (camPos.x - smoothed.p.x) * k;
        smoothed.p.y += (camPos.y - smoothed.p.y) * k;
        smoothed.p.z += (camPos.z - smoothed.p.z) * k;
        smoothed.t.x += (camTgt.x - smoothed.t.x) * k;
        smoothed.t.y += (camTgt.y - smoothed.t.y) * k;
        smoothed.t.z += (camTgt.z - smoothed.t.z) * k;

        var sx = 0, sy = 0;
        if (shake > 0) { sx = (Math.random() - 0.5) * shake * 1.1; sy = (Math.random() - 0.5) * shake * 1.1; }
        camera.position.set(smoothed.p.x + sx, smoothed.p.y + sy, smoothed.p.z);
        camera.setTarget(new BABYLON.Vector3(smoothed.t.x, smoothed.t.y, smoothed.t.z));
        // subtle speed fov for a sense of pace
        var wantFov = 1.02 + Math.min(0.18, busState.v * 0.008);
        camera.fov += (wantFov - camera.fov) * 0.06;
      }
    };
  }

  return {
    QUALITY: QUALITY,
    createScene: createScene,
    buildWorld: buildWorld,
    buildBus: buildBus,
    buildTrafficMesh: buildTrafficMesh,
    makeUpdater: makeUpdater,
    pbr: pbr,
    makeEnvironment: makeEnvironment
  };
});
