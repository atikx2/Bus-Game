/* =============================================================================
 * BD Bus Sim — core simulation (pure JS, no Babylon dependency)
 * Route generation, bus physics (engine/gearbox/bicycle-model steering),
 * traffic AI, bus stops, scoring.
 * UMD: browser -> window.BusSim, Node -> module.exports (tests run on this).
 * ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BusSim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var G = 9.81;

  /* ------------------------------------------------------------------ config */
  var CFG = {
    step: 2,                 // route sample spacing (m)
    roadHalfWidth: 9.0,      // divided boulevard visual/driveable width per side (m)
    walkHalfWidth: 11.2,     // sidewalk outer edge (m)
    laneRight: 3.2,          // left-hand traffic carriageway (Bangladesh)
    laneLeft: -3.2,          // opposing carriageway, divided by a raised median

    mass: 9500,              // kg, loaded city bus
    wheelbase: 5.4,          // m
    wheelRadius: 0.5,
    dragCdA: 6.2,            // Cd * A
    rho: 1.2,
    crr: 0.012,
    idleRpm: 700,
    redline: 2600,
    peakTorque: 1050,        // Nm
    finalDrive: 5.1,
    driveEff: 0.9,
    gears: [3.6, 2.3, 1.55, 1.05, 0.78],          // forward 1..5
    reverseRatio: -3.4,
    gearSpeeds: [0, 6, 11, 17, 23],                // upshift speeds (m/s) per gear
    engineBrake: 5200,       // N at full gear
    maxBrake: 46000,         // N service brake
    muTarmac: 1.05,
    muOffroad: 0.42,
    maxSteerLow: 0.60,       // rad at standstill
    maxSteerHigh: 0.30,      // rad at speed
    steerRate: 3.0,          // rad/s
    steerReturn: 3.6,
    offroadDrag: 4200,

    stopTolerance: 14,       // m from stop marker to be able to board
    stopMaxSpeed: 1.2,       // m/s
    missDistance: 26,        // m past stop -> missed
    crashSpeed: 4.5,         // m/s above which a hit is a crash
    crashDecel: 0.16,        // v multiplier on crash
    busHalfLen: 5.9,
    busHalfWidth: 1.25
  };

  /* ------------------------------------------------------------- seeded rng */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeRng(seed) {
    var f = mulberry32(seed >>> 0);
    return {
      next: f,
      range: function (a, b) { return a + (b - a) * f(); },
      int: function (a, b) { return Math.floor(a + (b - a + 1) * f()); },
      pick: function (arr) { return arr[Math.floor(f() * arr.length) % arr.length]; }
    };
  }

  /* ------------------------------------------------------------------ helpers */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function wrapPi(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  }
  // forward unit vector for heading h in the XZ plane
  function fwd(h) { return { x: Math.sin(h), z: Math.cos(h) }; }

  /* =========================================================================
   * ROUTE — closed loop, sampled at uniform arc length
   * ======================================================================= */
  function buildRoute(seed, opts) {
    opts = opts || {};
    var step = opts.step || CFG.step;

    // closed harmonic curve -> always loops back on itself, no self-crossing
    function raw(t) {
      return {
        x: 280 * Math.cos(t) + 35 * Math.cos(3 * t),
        z: 220 * Math.sin(t) + 12 * Math.sin(2 * t)
      };
    }

    var DENSE = 4000, i, p, q, d, cum = [0];
    var dense = [];
    for (i = 0; i <= DENSE; i++) dense.push(raw((i / DENSE) * Math.PI * 2));
    for (i = 1; i <= DENSE; i++) {
      d = Math.hypot(dense[i].x - dense[i - 1].x, dense[i].z - dense[i - 1].z);
      cum.push(cum[i - 1] + d);
    }
    var total = cum[DENSE];
    var n = Math.max(64, Math.round(total / step));
    var pts = [], target = 0, j = 0;

    for (i = 0; i < n; i++) {
      target = (i / n) * total;
      while (j < DENSE && cum[j + 1] < target) j++;
      var seg = cum[j + 1] - cum[j] || 1;
      var f = (target - cum[j]) / seg;
      pts.push({
        x: lerp(dense[j].x, dense[j + 1].x, f),
        z: lerp(dense[j].z, dense[j + 1].z, f)
      });
    }

    // heading from finite differences
    var hd = new Array(n);
    for (i = 0; i < n; i++) {
      p = pts[i]; q = pts[(i + 1) % n];
      hd[i] = Math.atan2(q.x - p.x, q.z - p.z);
    }
    // unwrap
    for (i = 1; i < n; i++) {
      while (hd[i] - hd[i - 1] > Math.PI) hd[i] -= 2 * Math.PI;
      while (hd[i] - hd[i - 1] < -Math.PI) hd[i] += 2 * Math.PI;
    }
    // curvature, smoothed
    var kRaw = new Array(n), k = new Array(n);
    for (i = 0; i < n; i++) {
      kRaw[i] = wrapPi(hd[(i + 1) % n] - hd[i]) / step;
    }
    var W = 10;
    for (i = 0; i < n; i++) {
      var sum = 0, cnt = 0;
      for (var w = -W; w <= W; w++) { sum += kRaw[(i + w + n) % n]; cnt++; }
      k[i] = sum / cnt;
    }

    var routeTotal = n * step;
    for (i = 0; i < n; i++) { pts[i].hdg = hd[i]; pts[i].k = k[i]; pts[i].s = i * step; }

    return {
      points: pts,
      n: n,
      step: step,
      total: routeTotal,
      cfg: CFG
    };
  }

  // position + heading + curvature at distance s (wraps), offset laterally by lat
  function at(route, s, lat) {
    var n = route.n, step = route.step;
    s = ((s % route.total) + route.total) % route.total;
    var fi = s / step;
    var i0 = Math.floor(fi) % n, i1 = (i0 + 1) % n, f = fi - Math.floor(fi);
    var p0 = route.points[i0], p1 = route.points[i1];
    var h = p0.hdg + wrapPi(p1.hdg - p0.hdg) * f;
    lat = lat || 0;
    return {
      x: lerp(p0.x, p1.x, f) + Math.cos(h) * lat,
      z: lerp(p0.z, p1.z, f) - Math.sin(h) * lat,
      hdg: h,
      k: lerp(p0.k, p1.k, f),
      s: s
    };
  }

  /* =========================================================================
   * WORLD — stops, buildings, trees, lamps (deterministic from seed)
   * ======================================================================= */
  var STOP_NAMES = ['মিরপুর', 'গুলশান', 'উত্তরা', 'মতিঝিল', 'যাত্রাবাড়ী', 'ধানমন্ডি'];

  function buildWorld(seed, opts) {
    opts = opts || {};
    var rng = makeRng(seed || 20261108);
    var route = buildRoute(seed || 20261108, opts);
    var HW = CFG.roadHalfWidth, WW = CFG.walkHalfWidth;

    // --- stops ------------------------------------------------------------
    var stops = [], stopCount = opts.stops || 6;
    for (var i = 0; i < stopCount; i++) {
      var s = (route.total / stopCount) * i + route.total * 0.02;
      var side = (i % 2 === 0) ? 1 : 1;              // kerb side (right)
      stops.push({
        id: i,
        name: STOP_NAMES[i % STOP_NAMES.length],
        s: s % route.total,
        lat: side * (HW + 1.6),
        state: 'waiting',   // waiting | boarding | done
        waiting: rng.int(4, 14),
        boarded: 0,
        boardTimer: 0
      });
    }

    // --- buildings --------------------------------------------------------
    var buildings = [], trees = [], lamps = [];
    var palettes = [
      { r: 0.72, g: 0.66, b: 0.56 }, { r: 0.55, g: 0.58, b: 0.62 },
      { r: 0.80, g: 0.74, b: 0.66 }, { r: 0.46, g: 0.50, b: 0.48 },
      { r: 0.66, g: 0.52, b: 0.46 }, { r: 0.60, g: 0.62, b: 0.68 }
    ];
    for (var d = 6; d < route.total; d += 9) {
      for (var sideB = -1; sideB <= 1; sideB += 2) {
        if (rng.next() < 0.24) continue;
        var depth = rng.range(WW + 2.5, WW + 26);
        var w = rng.range(6, 15);
        var hgt = rng.range(7, 34);
        var len = rng.range(7, 16);
        var pal = palettes[rng.int(0, palettes.length - 1)];
        buildings.push({
          s: d, lat: sideB * depth, w: w, h: hgt, len: len,
          color: pal, windows: rng.int(0, 2)
        });
      }
    }
    for (var t = 8; t < route.total; t += rng.range(18, 34)) {
      trees.push({
        s: t,
        lat: (rng.next() < 0.5 ? -1 : 1) * rng.range(WW + 0.8, WW + 4.5),
        h: rng.range(4.5, 8.5), r: rng.range(1.6, 2.9)
      });
    }
    for (var l = 30; l < route.total; l += 34) {
      lamps.push({ s: l, lat: 0 });
    }

    return {
      seed: seed || 20261108, route: route, stops: stops,
      buildings: buildings, trees: trees, lamps: lamps,
      hw: HW, ww: WW, rng: rng
    };
  }

  /* =========================================================================
   * TRAFFIC
   * ======================================================================= */
  var TRAFFIC_KINDS = [
    { type: 'car',      len: 4.4, wid: 0.95, hgt: 1.5, speed: [11, 17], color: '#c9ccd1' },
    { type: 'cng',      len: 2.9, wid: 0.78, hgt: 1.7, speed: [7, 11], color: '#2f7a3d' },
    { type: 'rickshaw', len: 2.6, wid: 0.70, hgt: 1.6, speed: [2.4, 4.2], color: '#d9642a' },
    { type: 'bus',      len: 10.5, wid: 1.25, hgt: 3.1, speed: [10, 15], color: '#2b6cb0' },
    { type: 'truck',    len: 8.0, wid: 1.15, hgt: 2.9, speed: [9, 14], color: '#8a8f98' }
  ];

  function spawnTraffic(world, count, rng) {
    rng = rng || makeRng((world.seed || 1) + 77);
    var out = [];
    for (var i = 0; i < count; i++) {
      var kind = TRAFFIC_KINDS[rng.int(0, TRAFFIC_KINDS.length - 1)];
      var oncoming = rng.next() < 0.45;
      var sp0 = rng.range(kind.speed[0], kind.speed[1]);
      out.push({
        id: i,
        kind: kind.type,
        len: kind.len, wid: kind.wid, hgt: kind.hgt, color: kind.color,
        s: ((world.route.total / count) * i + rng.range(0, 60)) % world.route.total,
        lat: oncoming ? CFG.laneLeft : CFG.laneRight,
        dir: oncoming ? -1 : 1,
        v: sp0,
        target: sp0,
        wobble: rng.range(0, 6.28)
      });
    }
    return out;
  }

  function stepTraffic(traffic, route, dt) {
    for (var i = 0; i < traffic.length; i++) {
      var c = traffic[i];
      // keep a gap from the vehicle in front (same direction only)
      var want = c.target;
      for (var j = 0; j < traffic.length; j++) {
        if (j === i || traffic[j].dir !== c.dir) continue;
        var gap = (traffic[j].s - c.s + route.total) % route.total;
        if (gap > 0 && gap < 26) { want = Math.min(want, traffic[j].v * 0.92); }
      }
      c.v += clamp(want - c.v, -6 * dt, 3 * dt);
      c.s = (c.s + c.dir * c.v * dt + route.total * 4) % route.total;
      c.wobble += dt * 1.7;
    }
  }

  /* =========================================================================
   * BUS STATE + PHYSICS
   * ======================================================================= */
  function createBus(route) {
    return {
      s: 0, lat: CFG.laneRight, psi: 0, v: 0,
      steer: 0, steerInput: 0, yawRate: 0, accel: 0, assistLane: CFG.laneRight,
      gear: 1, rpm: CFG.idleRpm, throttle: 0, brake: 0, handbrake: false,
      reverseMode: false,
      wheelSpin: 0,
      offroad: false, slip: 0, following: null,
      crashTimer: 0,
      doorOpen: false, atStop: null,
      passengers: 0, money: 0, score: 0, laps: 0,
      distance: 0, odo: 0,
      engineLoad: 0
    };
  }

  function torqueCurve(rpm) {
    // diesel-ish flat torque, falls off near redline
    var x = clamp((rpm - CFG.idleRpm) / (CFG.redline - CFG.idleRpm), 0, 1);
    return CFG.peakTorque * (0.55 + 0.55 * Math.sin(Math.PI * Math.min(1, x * 1.15))) * (1 - 0.35 * x * x);
  }

  function autoGear(bus) {
    if (bus.reverseMode) return 0;                       // 0 = R
    var sp = Math.abs(bus.v);
    var g = 1;
    for (var i = 1; i < CFG.gearSpeeds.length; i++) {
      if (sp >= CFG.gearSpeeds[i] - 1.5) g = i + 1;
    }
    // downshift hysteresis
    if (bus.gear >= 2 && bus.gear <= CFG.gearSpeeds.length &&
        sp < CFG.gearSpeeds[bus.gear - 1] - 2.2) g = bus.gear - 1;
    return clamp(g, 1, CFG.gears.length);
  }

  function gearRatio(bus) {
    return bus.gear === 0 ? CFG.reverseRatio : CFG.gears[bus.gear - 1];
  }

  /**
   * Advance the simulation by dt seconds.
   * input: {throttle:0..1, brake:0..1, steer:-1..1, handbrake:bool, reverse:bool}
   * returns event list: [{type:'crash'|'board'|'miss'|'lap'|'offroad', ...}]
   */
  function step(bus, world, traffic, input, dt) {
    var route = world.route, HW = world.hw, events = [];
    var C = CFG;

    /* ---- inputs ------------------------------------------------------- */
    var thr = clamp(input.throttle || 0, 0, 1);
    var brk = clamp(input.brake || 0, 0, 1);
    var stIn = clamp(input.steer || 0, -1, 1);
    var assist = clamp(input.assist === undefined ? 0 : input.assist, 0, 1);
    var hb = !!input.handbrake;
    bus.reverseMode = !!input.reverse && Math.abs(bus.v) < 0.6;

    // driving aid: brake for slower traffic in our lane (only while assist is on)
    if (assist > 0 && bus.v > 1.5) {
      var brakeNeed = 0;
      for (var ai = 0; ai < traffic.length; ai++) {
        var tc = traffic[ai];
        if (tc.dir < 0) continue;                                    // oncoming: ignore
        if (Math.abs(tc.lat - bus.lat) > (C.busHalfWidth + tc.wid) * 0.95) continue;
        var dsAhead = (tc.s - bus.s + route.total) % route.total;
        if (dsAhead > 45) continue;
        var closing = bus.v - tc.v;
        if (closing <= 0) continue;
        var safeGap = Math.max(7, bus.v * 1.7);
        if (dsAhead < safeGap) brakeNeed = Math.max(brakeNeed, clamp((safeGap - dsAhead) / (safeGap * 0.5), 0, 1));
      }
      if (brakeNeed > 0) {
        brk = Math.max(brk, brakeNeed * assist);
        thr = thr * (1 - brakeNeed * assist);        // lift off, then brake
      }
    }

    /* ---- steering (rate limited, speed sensitive) --------------------- */
    var sp = Math.abs(bus.v);
    var maxSteer = lerp(C.maxSteerLow, C.maxSteerHigh, clamp(sp / 26, 0, 1));
    // optional assist (mobile friendly): follow the road curvature like a driver
    // who looks ahead, and damp heading error. Never forces a lane, so the
    // player can still change lanes / pull into the kerb.
    var assistAngle = 0;
    if (assist > 0) {
      // hold whichever lane the driver is in: while they steer, the target
      // follows them, so lane changes and pulling into the kerb still work.
      if (stIn !== 0) bus.assistLane = bus.lat;
      else if (bus.assistLane === undefined) bus.assistLane = C.laneRight;
      // look ~1.3 s down the road so a corner is started early, like a driver
      // who looks ahead instead of staring at the bumper
      var look = clamp(sp * 1.3, 0, 26);
      var kNow = at(route, bus.s, 0).k;
      var kAhead = at(route, bus.s + look, 0).k;
      var need = Math.atan(C.wheelbase * (kNow * 0.35 + kAhead * 0.65));
      var latErr = bus.lat - bus.assistLane;
      assistAngle = clamp(need - bus.psi * 1.4 - latErr * 0.32, -maxSteer, maxSteer) * assist;
    } else {
      bus.assistLane = bus.lat;
    }
    var target = clamp(stIn * maxSteer + assistAngle, -maxSteer, maxSteer);
    var rate = (stIn === 0 ? C.steerReturn : C.steerRate) * dt;
    bus.steer += clamp(target - bus.steer, -rate, rate);
    bus.steerInput = stIn;

    /* ---- gearbox + engine --------------------------------------------- */
    bus.gear = autoGear(bus);
    var ratio = gearRatio(bus);
    var rpmFromSpeed = (sp / C.wheelRadius) * Math.abs(ratio) * C.finalDrive * (60 / (2 * Math.PI));
    bus.rpm = clamp(lerp(C.idleRpm, rpmFromSpeed, 0.92) + thr * 260, C.idleRpm, C.redline);
    bus.engineLoad = thr;

    /* ---- longitudinal forces ------------------------------------------ */
    var mu = bus.offroad ? C.muOffroad : C.muTarmac;
    var normal = C.mass * G;
    var torque = torqueCurve(bus.rpm) * thr;
    var fDrive = (torque * Math.abs(ratio) * C.finalDrive * C.driveEff) / C.wheelRadius;
    var traction = mu * normal * 0.62;              // rear-axle drive share
    fDrive = Math.min(fDrive, traction);

    var fDrag = 0.5 * C.rho * C.dragCdA * bus.v * Math.abs(bus.v);
    var fRoll = C.crr * normal * (bus.offroad ? 3.2 : 1);
    var fBrake = (brk * C.maxBrake + (hb ? C.maxBrake * 0.55 : 0));
    var fEngineBrake = (1 - thr) * C.engineBrake * Math.abs(ratio) * 0.16;

    var dir = bus.reverseMode ? -1 : 1;
    var fNet = fDrive * dir - fDrag - fRoll * Math.sign(bus.v) - (fBrake + fEngineBrake) * Math.sign(bus.v);
    var a = fNet / C.mass;
    bus.accel = a;
    bus.v += a * dt;

    // come to rest instead of oscillating around zero (only when coasting/braking,
    // never while the engine is driving, otherwise the bus can never start moving)
    if (thr === 0) {
      if (!bus.reverseMode && bus.v < 0) bus.v = Math.min(0, bus.v + 40 * dt);
      if (Math.abs(bus.v) < 0.35 && (brk > 0.05 || hb)) bus.v = 0;
      else if (Math.abs(bus.v) < 0.08) bus.v = 0;
    }
    bus.v = clamp(bus.v, -7, 20.5);   // ~74 km/h, city bus governor

    /* ---- lateral / yaw: kinematic bicycle with grip limit ------------- */
    var pose = at(route, bus.s, 0);
    var k = pose.k;
    var desiredYaw = (bus.v / C.wheelbase) * Math.tan(bus.steer);
    var maxYaw = (mu * G) / Math.max(sp, 0.8);
    var yaw = clamp(desiredYaw, -maxYaw, maxYaw);
    bus.yawRate = yaw;
    bus.slip = clamp(Math.abs(desiredYaw) / Math.max(maxYaw, 1e-6) - 1, 0, 1); // >0 = understeer
    if (hb) yaw *= 0.55;

    bus.psi = wrapPi(bus.psi + (yaw - k * bus.v) * dt);
    bus.s += bus.v * Math.cos(bus.psi) * dt;
    bus.lat += bus.v * Math.sin(bus.psi) * dt;

    if (bus.s >= route.total) { bus.s -= route.total; bus.laps++; events.push({ type: 'lap', laps: bus.laps }); }
    if (bus.s < 0) bus.s += route.total;

    /* ---- off road ------------------------------------------------------ */
    bus.offroad = Math.abs(bus.lat) > HW;
    if (bus.offroad) {
      // kerb/dirt: scrub off speed steadily (playable, not instant stop)
      bus.v *= Math.pow(0.70, dt);
      bus.bump = (bus.bump || 0) + Math.abs(bus.v) * dt;
    }
    bus.lat = clamp(bus.lat, -(HW + 4.2), HW + 4.2);

    /* ---- wheels -------------------------------------------------------- */
    bus.wheelSpin += (bus.v / C.wheelRadius) * dt;

    /* ---- crash timer --------------------------------------------------- */
    if (bus.crashTimer > 0) bus.crashTimer = Math.max(0, bus.crashTimer - dt);

    /* ---- car following: never overlap the vehicle ahead ------------------- */
    if (bus.v > 0) {
      for (var fi = 0; fi < traffic.length; fi++) {
        var fc = traffic[fi];
        if (fc.dir < 0) continue;
        if (Math.abs(fc.lat - bus.lat) > (C.busHalfWidth + fc.wid)) continue;
        var dAhead = (fc.s - bus.s + route.total) % route.total;
        var minGap = C.busHalfLen + fc.len * 0.5 + 0.7;
        if (dAhead < minGap + 0.4) {
          // closing fast on the vehicle ahead = a real rear-end collision
          if (bus.v - fc.v > C.crashSpeed && bus.crashTimer <= 0) {
            bus.v *= C.crashDecel;
            bus.crashTimer = 1.1;
            bus.score -= 12;
            events.push({ type: 'crash', with: fc.kind });
          }
          bus.v = Math.min(bus.v, Math.max(0, fc.v));        // match the leader
          bus.s = (fc.s - minGap + route.total) % route.total;
          bus.following = fc.id;
        }
      }
    } else {
      bus.following = null;
    }

    /* ---- traffic collisions -------------------------------------------- */
    for (var i = 0; i < traffic.length; i++) {
      var c = traffic[i];
      var ds = Math.abs(((c.s - bus.s + route.total * 1.5) % route.total) - route.total * 0.5);
      ds = Math.min(ds, route.total - ds);
      var dl = Math.abs(c.lat - bus.lat);
      if (ds < (C.busHalfLen + c.len * 0.5) * 0.82 && dl < (C.busHalfWidth + c.wid)) {
        if (Math.abs(bus.v) > C.crashSpeed && bus.crashTimer <= 0) {
          bus.v *= C.crashDecel;
          bus.crashTimer = 1.1;
          bus.score -= 12;
          events.push({ type: 'crash', with: c.kind });
        } else {
          bus.v *= Math.pow(0.62, dt);
          bus.lat += (bus.lat >= c.lat ? 1 : -1) * 0.9 * dt;          // slide apart
          if (bus.crashTimer <= 0) events.push({ type: 'scrape', with: c.kind });
        }
      }
    }

    /* ---- bus stops ------------------------------------------------------ */
    var near = null, bestD = 1e9;
    for (var si = 0; si < world.stops.length; si++) {
      var st = world.stops[si];
      var d = st.s - bus.s;
      d = ((d + route.total * 1.5) % route.total) - route.total * 0.5;
      if (Math.abs(d) < Math.abs(bestD)) { bestD = d; near = st; }
      if (st.state === 'waiting' && d < -C.missDistance && d > -C.missDistance - 40) {
        st.state = 'done';
        bus.score -= 8;
        events.push({ type: 'miss', stop: st });
      }
    }
    bus.atStop = near;
    bus.nextStopDist = bestD;

    if (near && near.state === 'waiting' && Math.abs(bestD) < C.stopTolerance && Math.abs(bus.v) < C.stopMaxSpeed) {
      bus.doorOpen = true;
      near.boardTimer += dt;
      if (near.boardTimer > 0.55) {
        near.boardTimer = 0;
        var p = near.waiting > 0 ? 1 : 0;
        if (p) {
          near.waiting--; near.boarded++;
          bus.passengers++;
          bus.money += 15 + Math.floor(Math.random() * 20);
          bus.score += 4;
          events.push({ type: 'board', stop: near, onboard: bus.passengers });
        } else {
          near.state = 'done';
          events.push({ type: 'depart', stop: near });
        }
      }
    } else {
      if (bus.doorOpen && near && near.state === 'waiting' && near.boarded > 0) near.state = 'done';
      bus.doorOpen = false;
    }

    /* ---- scoring -------------------------------------------------------- */
    var ds2 = bus.v * dt;
    if (ds2 > 0) { bus.odo += ds2; bus.score += ds2 * 0.12 * (bus.passengers > 0 ? 1.25 : 1); }
    bus.distance = ds2;

    return events;
  }

  /* ========================================================================= */
  return {
    CFG: CFG,
    TRAFFIC_KINDS: TRAFFIC_KINDS,
    STOP_NAMES: STOP_NAMES,
    buildRoute: buildRoute,
    buildWorld: buildWorld,
    spawnTraffic: spawnTraffic,
    stepTraffic: stepTraffic,
    createBus: createBus,
    gearRatio: gearRatio,
    step: step,
    at: at,
    torqueCurve: torqueCurve,
    helpers: { clamp: clamp, lerp: lerp, wrapPi: wrapPi, fwd: fwd, makeRng: makeRng }
  };
});
