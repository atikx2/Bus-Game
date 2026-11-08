/* Core simulation tests — run: node test/core.test.js
 * These call the exact same BusSim.step()/buildWorld() code the browser uses. */
'use strict';
const assert = require('assert');
const BusSim = require('../www/js/core.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  ok   ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); fail++; }
}
function drive(bus, world, traffic, input, secs, dt) {
  dt = dt || 1 / 120;
  const evts = [];
  for (let acc = 0; acc < secs; acc += dt) evts.push(...BusSim.step(bus, world, traffic, input, dt));
  return evts;
}
const FULL = { throttle: 1, brake: 0, steer: 0 };
const IDLE = { throttle: 0, brake: 0, steer: 0 };

// what a player does: hold the right-hand lane by steering against heading error
function laneKeep(bus, targetLat) {
  const C = BusSim.CFG;
  const sp = Math.abs(bus.v);
  const maxSteer = C.maxSteerLow + (C.maxSteerHigh - C.maxSteerLow) * Math.min(1, sp / 26);
  const latErr = bus.lat - (targetLat === undefined ? C.laneRight : targetLat);
  // a competent driver also anticipates: feed forward the curvature ahead
  const look = Math.min(Math.abs(bus.v) * 1.3, 26);
  const kNow = BusSim.at(world.route, bus.s, 0).k;
  const kAhead = BusSim.at(world.route, bus.s + look, 0).k;
  const ff = Math.atan(BusSim.CFG.wheelbase * (kNow * 0.35 + kAhead * 0.65));
  const cmd = (ff - bus.psi * 2.4 - latErr * 0.45) / maxSteer;
  return BusSim.helpers.clamp(cmd, -1, 1);
}
function driveLane(bus, world, traffic, input, secs, dt) {
  dt = dt || 1 / 120;
  const evts = [];
  for (let acc = 0; acc < secs; acc += dt) {
    evts.push(...BusSim.step(bus, world, traffic, { ...input, steer: laneKeep(bus) }, dt));
  }
  return evts;
}

const world = BusSim.buildWorld(20261108, {});
console.log('\n--- route ---');

t('route is a closed loop (start ~= end)', () => {
  const a = BusSim.at(world.route, 0, 0);
  const b = BusSim.at(world.route, world.route.total, 0);
  const d = Math.hypot(a.x - b.x, a.z - b.z);
  assert.ok(d < 1.0, 'gap at seam = ' + d.toFixed(3) + ' m');
});

t('route length is sane (1000-3000 m) and uniform', () => {
  assert.ok(world.route.total > 1000 && world.route.total < 3000, 'total=' + world.route.total);
  const p = world.route.points;
  for (let i = 1; i < p.length; i += 37) {
    const d = Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z);
    assert.ok(Math.abs(d - world.route.step) < 0.5, 'spacing ' + d.toFixed(2));
  }
});

t('at() wraps negative and over-length distances', () => {
  const a = BusSim.at(world.route, -5, 0), b = BusSim.at(world.route, world.route.total - 5, 0);
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 0.01);
});

t('lateral offset is perpendicular to heading', () => {
  const c = BusSim.at(world.route, 300, 0), r = BusSim.at(world.route, 300, 1);
  const dx = r.x - c.x, dz = r.z - c.z;
  assert.ok(Math.abs(Math.hypot(dx, dz) - 1) < 1e-6, 'len=' + Math.hypot(dx, dz));
  const fx = Math.sin(c.hdg), fz = Math.cos(c.hdg);
  assert.ok(Math.abs(dx * fx + dz * fz) < 1e-6, 'dot with forward != 0');
});

t('curvature is finite everywhere', () => {
  for (const p of world.route.points) assert.ok(Number.isFinite(p.k), 'k not finite');
});

t('world has stops, buildings, trees, lamps', () => {
  assert.strictEqual(world.stops.length, 6);
  assert.ok(world.buildings.length > 100, 'buildings=' + world.buildings.length);
  assert.ok(world.trees.length > 20, 'trees=' + world.trees.length);
  assert.ok(world.lamps.length > 20, 'lamps=' + world.lamps.length);
  for (const s of world.stops) assert.ok(s.s >= 0 && s.s < world.route.total);
});

t('world build is deterministic for a seed', () => {
  const w2 = BusSim.buildWorld(20261108, {});
  assert.strictEqual(w2.buildings.length, world.buildings.length);
  assert.strictEqual(w2.buildings[7].h, world.buildings[7].h);
});

console.log('\n--- driving physics ---');

t('bus accelerates from standstill (0 -> >10 m/s in 8 s)', () => {
  const b = BusSim.createBus(world.route);
  driveLane(b, world, [], { throttle: 1, brake: 0 }, 8);
  assert.ok(b.v > 10, 'v=' + b.v.toFixed(2));
});

t('top speed is limited (30 s full throttle stays under 32 m/s)', () => {
  const b = BusSim.createBus(world.route);
  driveLane(b, world, [], { throttle: 1, brake: 0 }, 30);
  assert.ok(b.v > 18 && b.v <= 32, 'v=' + b.v.toFixed(2));
});

t('rpm stays inside idle..redline while driving', () => {
  const b = BusSim.createBus(world.route);
  for (let i = 0; i < 2000; i++) {
    BusSim.step(b, world, [], { throttle: 1, brake: 0, steer: laneKeep(b) }, 1 / 120);
    assert.ok(b.rpm >= BusSim.CFG.idleRpm - 1 && b.rpm <= BusSim.CFG.redline + 1, 'rpm=' + b.rpm);
  }
});

t('automatic gearbox shifts up with speed and never leaves valid range', () => {
  const b = BusSim.createBus(world.route);
  let maxGear = 1;
  for (let i = 0; i < 4000; i++) {
    BusSim.step(b, world, [], { throttle: 1, brake: 0, steer: laneKeep(b) }, 1 / 120);
    assert.ok(b.gear >= 1 && b.gear <= BusSim.CFG.gears.length, 'gear=' + b.gear);
    maxGear = Math.max(maxGear, b.gear);
  }
  assert.ok(maxGear >= 4, 'maxGear=' + maxGear);
});

t('service brake stops the bus from 20 m/s within 45 m', () => {
  const b = BusSim.createBus(world.route);
  driveLane(b, world, [], { throttle: 1, brake: 0 }, 20);
  const v0 = b.v, s0 = b.odo;
  assert.ok(v0 > 18, 'setup: v=' + v0.toFixed(1));
  driveLane(b, world, [], { throttle: 0, brake: 1 }, 8);
  const dist = b.odo - s0;
  assert.ok(Math.abs(b.v) < 0.05, 'still moving v=' + b.v.toFixed(2));
  assert.ok(dist < 45, 'braking distance=' + dist.toFixed(1));
});

t('coasting slows the bus down (engine braking + drag)', () => {
  const b = BusSim.createBus(world.route);
  driveLane(b, world, [], { throttle: 1, brake: 0 }, 20);
  const v0 = b.v;
  driveLane(b, world, [], IDLE, 5);
  assert.ok(b.v < v0 - 1.5, 'v0=' + v0.toFixed(2) + ' v=' + b.v.toFixed(2));
});

t('reverse gear moves the bus backwards', () => {
  const b = BusSim.createBus(world.route);
  drive(b, world, [], { throttle: 0.5, brake: 0, steer: 0, reverse: true }, 3);
  assert.ok(b.v < -0.5, 'v=' + b.v.toFixed(2));
  assert.strictEqual(b.gear, 0);
});

t('steering at speed changes heading and moves the bus laterally', () => {
  const b = BusSim.createBus(world.route);
  driveLane(b, world, [], { throttle: 1, brake: 0 }, 8);
  const lat0 = b.lat, psi0 = b.psi;
  drive(b, world, [], { throttle: 0.4, brake: 0, steer: -1 }, 1.5);
  assert.ok(Math.abs(b.psi - psi0) > 0.02, 'psi unchanged');
  assert.ok(b.lat < lat0 - 0.2, 'lat ' + lat0.toFixed(2) + ' -> ' + b.lat.toFixed(2));
});

t('grip limit caps lateral acceleration (no impossible cornering)', () => {
  const b = BusSim.createBus(world.route);
  driveLane(b, world, [], { throttle: 1, brake: 0 }, 20);
  const mu = BusSim.CFG.muTarmac;
  for (let i = 0; i < 600; i++) {
    const vPre = b.v;                       // step() clamps using the pre-step speed
    BusSim.step(b, world, [], { throttle: 1, brake: 0, steer: 1 }, 1 / 120);
    const limit = (mu * 9.81) / Math.max(Math.abs(vPre), 0.8);
    assert.ok(Math.abs(b.yawRate) <= limit + 1e-9,
      'applied yaw ' + b.yawRate.toFixed(4) + ' > grip limit ' + limit.toFixed(4));
    assert.ok(Math.abs(b.yawRate * vPre) <= mu * 9.81 + 1e-6, 'lateral accel over mu*g');
  }
});

t('steering wheel returns to centre when input released', () => {
  const b = BusSim.createBus(world.route);
  driveLane(b, world, [], { throttle: 1, brake: 0 }, 6);
  BusSim.step(b, world, [], { throttle: 0.6, brake: 0, steer: 1 }, 1 / 120);
  for (let i = 0; i < 240; i++) BusSim.step(b, world, [], { throttle: 0.6, brake: 0, steer: 1 }, 1 / 120);
  assert.ok(Math.abs(b.steer) > 0.05, 'steer never moved');
  for (let i = 0; i < 240; i++) BusSim.step(b, world, [], { throttle: 0.6, brake: 0, steer: 0 }, 1 / 120);
  assert.ok(Math.abs(b.steer) < 0.02, 'steer=' + b.steer.toFixed(4));
});

t('going off the road slows the bus more than staying on it', () => {
  const run = (latOffset) => {
    const b = BusSim.createBus(world.route);
    b.s = 500; b.lat = BusSim.CFG.laneRight + latOffset; b.v = 15;
    const v0 = b.v;
    for (let i = 0; i < 360; i++) BusSim.step(b, world, [], IDLE, 1 / 120);
    return { loss: v0 - b.v, offroad: b.offroad };
  };
  const on = run(0);
  const off = run(world.hw + 1.5);
  assert.ok(off.offroad === true, 'bus at lat ' + (BusSim.CFG.laneRight + world.hw + 1.5) + ' not flagged offroad');
  assert.ok(on.offroad === false, 'lane centre flagged offroad');
  assert.ok(off.loss > on.loss * 1.5, 'offroad loss ' + off.loss.toFixed(2) + ' vs onroad ' + on.loss.toFixed(2));
});

t('bus stays inside the hard lateral walls', () => {
  const b = BusSim.createBus(world.route);
  for (let i = 0; i < 6000; i++) {
    BusSim.step(b, world, [], { throttle: 1, brake: 0, steer: i % 300 < 150 ? 1 : -1 }, 1 / 120);
    assert.ok(Math.abs(b.lat) <= world.hw + 4.3, 'lat=' + b.lat);
  }
});

t('wheels spin with speed', () => {
  const b = BusSim.createBus(world.route);
  driveLane(b, world, [], { throttle: 1, brake: 0 }, 4);
  assert.ok(b.wheelSpin > 5, 'spin=' + b.wheelSpin);
});

console.log('\n--- traffic / stops / scoring ---');

t('traffic stays on the route and wraps around', () => {
  const tr = BusSim.spawnTraffic(world, 14);
  for (let i = 0; i < 1200; i++) BusSim.stepTraffic(tr, world.route, 1 / 60);
  for (const c of tr) {
    assert.ok(c.s >= 0 && c.s < world.route.total, 's=' + c.s);
    assert.ok(c.v >= 0, 'v=' + c.v);
  }
});

t('hitting traffic at speed triggers a crash event and slows the bus', () => {
  const b = BusSim.createBus(world.route);
  driveLane(b, world, [], { throttle: 1, brake: 0 }, 10);
  const v0 = b.v;
  const victim = { id: 99, kind: 'truck', len: 8, wid: 1.1, hgt: 2.9, color: '#888', s: b.s + 8, lat: b.lat, dir: 1, v: 0, target: 0, wobble: 0 };
  const evts = BusSim.step(b, world, [victim], FULL, 1 / 120);
  assert.ok(evts.some(e => e.type === 'crash'), 'no crash event: ' + JSON.stringify(evts));
  assert.ok(b.v < v0 * 0.5, 'v0=' + v0.toFixed(2) + ' v=' + b.v.toFixed(2));
  assert.ok(b.score < 0, 'no score penalty');
});

t('crash cooldown prevents event spam', () => {
  const b = BusSim.createBus(world.route);
  driveLane(b, world, [], { throttle: 1, brake: 0 }, 10);
  const victim = { id: 99, kind: 'car', len: 4.4, wid: 0.95, hgt: 1.5, color: '#888', s: b.s + 8, lat: b.lat, dir: 1, v: 0, target: 0, wobble: 0 };
  let crashes = 0;
  for (let i = 0; i < 120; i++) crashes += BusSim.step(b, world, [victim], FULL, 1 / 120).filter(e => e.type === 'crash').length;
  assert.ok(crashes <= 2, 'crashes=' + crashes);
});

t('stopping at a stop boards passengers and earns money', () => {
  const w = BusSim.buildWorld(4242, {});
  const b = BusSim.createBus(w.route);
  b.s = w.stops[0].s; b.lat = BusSim.CFG.laneRight; b.v = 0;
  const before = b.passengers, money = b.money;
  let doorSeen = false;
  const evts = [];
  for (let i = 0; i < 120 * 6; i++) {
    evts.push(...BusSim.step(b, w, [], { throttle: 0, brake: 1, steer: 0 }, 1 / 120));
    if (b.doorOpen) doorSeen = true;
  }
  assert.ok(doorSeen, 'door never opened');
  assert.ok(b.passengers > before, 'nobody boarded');
  assert.ok(b.money > money, 'no fare collected');
  assert.ok(evts.filter(e => e.type === 'board').length >= 3,
    'only ' + evts.filter(e => e.type === 'board').length + ' board events');
  assert.ok(w.stops[0].boarded === b.passengers, 'stop/boarded mismatch');
});

t('speeding past a stop marks it missed', () => {
  const w = BusSim.buildWorld(4242, {});
  const b = BusSim.createBus(w.route);
  b.s = w.stops[0].s - 30; b.v = 0;
  const evts = driveLane(b, w, [], { throttle: 1, brake: 0 }, 8);
  assert.ok(evts.some(e => e.type === 'miss'), 'no miss event');
  assert.strictEqual(w.stops[0].state, 'done');
});

t('score and odometer accumulate while moving', () => {
  const b = BusSim.createBus(world.route);
  driveLane(b, world, [], { throttle: 1, brake: 0 }, 10);
  assert.ok(b.score > 5, 'score=' + b.score.toFixed(1));
  assert.ok(b.odo > 40, 'odo=' + b.odo.toFixed(1));
});

t('completing the loop increments laps', () => {
  const b = BusSim.createBus(world.route);
  b.s = world.route.total - 5;
  const evts = driveLane(b, world, [], { throttle: 1, brake: 0 }, 6);
  assert.ok(evts.some(e => e.type === 'lap'), 'no lap event');
  assert.ok(b.laps >= 1 && b.s < 100, 'laps=' + b.laps + ' s=' + b.s.toFixed(1));
});

t('simulation is stable over a long drive (no NaN)', () => {
  const b = BusSim.createBus(world.route);
  const tr = BusSim.spawnTraffic(world, 18);
  for (let i = 0; i < 120 * 120; i++) {           // 2 minutes at 120 Hz
    const input = { throttle: (i % 900 < 700) ? 0.9 : 0, brake: (i % 900 < 700) ? 0 : 0.8, steer: laneKeep(b) };
    BusSim.stepTraffic(tr, world.route, 1 / 120);
    BusSim.step(b, world, tr, input, 1 / 120);
  }
  for (const k of ['s', 'lat', 'psi', 'v', 'steer', 'rpm', 'score', 'odo']) {
    assert.ok(Number.isFinite(b[k]), k + ' = ' + b[k]);
  }
  assert.ok(b.odo > 100, 'odo=' + b.odo.toFixed(1));
});

t('lane-keeping driver completes a lap without leaving the road', () => {
  const b = BusSim.createBus(world.route);
  let offroadSteps = 0, total = 0;
  for (let i = 0; i < 120 * 150; i++) {
    BusSim.step(b, world, [], { throttle: 0.85, brake: 0, steer: laneKeep(b) }, 1 / 120);
    total++;
    if (b.offroad) offroadSteps++;
  }
  assert.ok(offroadSteps < total * 0.02, 'offroad ' + offroadSteps + '/' + total);
  assert.ok(b.odo > world.route.total * 0.8, 'odo=' + b.odo.toFixed(0));
});

t('steering assist keeps the bus on the road better than manual input', () => {
  const lap = (assist) => {
    const b = BusSim.createBus(world.route);
    let off = 0, n = 0;
    for (let i = 0; i < 120 * 160; i++) {
      BusSim.step(b, world, [], { throttle: 0.85, brake: 0, steer: 0, assist: assist }, 1 / 120);
      n++; if (b.offroad) off++;
    }
    return { pct: 100 * off / n, odo: b.odo };
  };
  const manual = lap(0);
  const assisted = lap(0.85);
  assert.ok(assisted.pct < manual.pct,
    'assisted ' + assisted.pct.toFixed(1) + '% vs manual ' + manual.pct.toFixed(1) + '%');
  assert.ok(assisted.pct < 3, 'assisted run still offroad ' + assisted.pct.toFixed(1) + '%');
  assert.ok(assisted.odo > world.route.total * 1.8, 'odo=' + assisted.odo.toFixed(0));
});

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
