/* Headless scene tests using BABYLON.NullEngine — run: node test/scene.test.js
 * Exercises the real createScene()/buildWorld()/makeUpdater() code the browser
 * runs, without a GPU. Catches bad API usage, NaN transforms, null materials. */
'use strict';
const assert = require('assert');
const BABYLON = require('../www/babylon.js');
const BusSim = require('../www/js/core.js');
const BusGfx = require('../www/js/graphics.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  ok   ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n       ')); fail++; }
}

function makeCtx(quality) {
  const engine = new BABYLON.NullEngine({ renderWidth: 1280, renderHeight: 720, textureSize: 512 });
  const ctx = BusGfx.createScene(engine, { quality: quality, post: false });
  const world = BusSim.buildWorld(20261108, {});
  const gfx = BusGfx.buildWorld(ctx.scene, world, { quality: quality });
  return { engine, ctx, world, gfx };
}

console.log('\n--- scene construction ---');

let ctx;
t('createScene builds a scene with lights, camera and fog', () => {
  ctx = makeCtx('med');
  const s = ctx.ctx.scene;
  assert.ok(s.lights.length >= 2, 'lights=' + s.lights.length);
  assert.ok(s.cameras.length === 1, 'cameras=' + s.cameras.length);
  assert.ok(s.fogMode === BABYLON.Scene.FOGMODE_EXP2);
  assert.ok(s.shadowGenerator || ctx.ctx.shadowGenerator, 'no shadow generator');
});

t('buildWorld creates road, sidewalks, ground, bus and stops', () => {
  const m = ctx.gfx.meshes;
  assert.ok(m.road && m.road.getTotalVertices() > 100, 'road verts=' + (m.road && m.road.getTotalVertices()));
  assert.ok(m.walkL && m.walkR, 'no sidewalks');
  assert.ok(m.median && m.medianFaceL && m.medianFaceR, 'no raised divided-road median');
  assert.ok(m.kerbL && m.kerbR, 'no raised road kerbs');
  assert.ok(m.ground, 'no ground');
  assert.ok(m.bus && m.bus.root, 'no bus');
  assert.strictEqual(m.stops.length, 6, 'stops=' + m.stops.length);
  assert.ok(m.buildings.length > 100, 'buildings=' + m.buildings.length);
  assert.ok(m.trees.length > 20, 'trees=' + m.trees.length);
  assert.ok(m.lamps.length > 20, 'lamps=' + m.lamps.length);
});

t('every mesh in the scene has a material', () => {
  const missing = ctx.ctx.scene.meshes.filter(m => !m.material && m.getTotalVertices() > 0).map(m => m.name);
  assert.deepStrictEqual(missing, [], 'meshes without material: ' + missing.join(', '));
});

t('bus has 4 wheels, 2 steerable pivots and glass', () => {
  const b = ctx.gfx.bus;
  assert.strictEqual(b.wheels.length, 4);
  assert.strictEqual(b.steerPivots.length, 2);
  const names = b.body.getChildMeshes().map(m => m.name);
  assert.ok(names.includes('glassL') && names.includes('wind'), 'missing glass: ' + names.join(','));
  assert.ok(b.length > 10 && b.width > 2 && b.height > 2.5, 'bus dims wrong');
});

t('CNG traffic gets a cabin, glazing, grille and three wheels', () => {
  const cng = BusGfx.buildTrafficMesh(ctx.ctx.scene, ctx.gfx.mats,
    { id: 99, kind: 'cng', wid: 0.9, hgt: 1.5, len: 2.7 });
  assert.ok(cng.details.length >= 6, 'CNG detail meshes=' + cng.details.length);
  assert.ok(cng.details.every(m => m.material), 'CNG detail missing a material');
  assert.ok(cng.details.some(m => m.name.indexOf('cngWind') === 0), 'no windshield');
  assert.strictEqual(cng.details.filter(m => m.name.indexOf('cngWheel') === 0).length, 3);
});

t('PBR materials are configured (metallic paint + clearcoat)', () => {
  const p = ctx.gfx.mats.busPaint;
  assert.ok(p instanceof BABYLON.PBRMaterial, 'bus paint not PBR');
  assert.ok(p.metallic > 0.5, 'metallic=' + p.metallic);
  assert.ok(p.roughness < 0.4, 'roughness=' + p.roughness);
  assert.ok(p.clearCoat.isEnabled, 'no clearcoat on paint');
  assert.ok(ctx.gfx.mats.glass.alpha < 0.6, 'glass not transparent');
});

t('no NaN in any mesh transform after build', () => {
  const bad = [];
  for (const m of ctx.ctx.scene.meshes) {
    const p = m.position, r = m.rotation, sc = m.scaling;
    if (![p.x, p.y, p.z, r.x, r.y, r.z, sc.x, sc.y, sc.z].every(Number.isFinite)) bad.push(m.name);
  }
  assert.deepStrictEqual(bad, [], 'NaN transforms: ' + bad.slice(0, 8).join(', '));
});

t('quality tiers all build (low / med / high)', () => {
  for (const q of ['low', 'med', 'high']) {
    const c = makeCtx(q);
    assert.ok(c.gfx.meshes.road, q + ': no road');
    if (q === 'low') assert.ok(!c.ctx.shadowGenerator, q + ': low tier should skip shadows');
    else assert.ok(c.ctx.shadowGenerator, q + ': missing shadow generator');
    c.engine.dispose();
  }
});

console.log('\n--- per-frame update ---');

t('updater places the bus on the route and spins the wheels', () => {
  const { world, gfx, ctx: c } = ctx;
  const up = BusGfx.makeUpdater(c, world, gfx, {});
  const bus = BusSim.createBus(world.route);
  const traffic = BusSim.spawnTraffic(world, 12);
  BusSim.step(bus, world, traffic, { throttle: 1, assist: 0.9 }, 1 / 60);
  for (let i = 0; i < 240; i++) {
    BusSim.stepTraffic(traffic, world.route, 1 / 60);
    BusSim.step(bus, world, traffic, { throttle: 1, assist: 0.9 }, 1 / 60);
    up.update(bus, traffic, 1 / 60, 1, bus.crashTimer);
  }
  const p = gfx.bus.root.position;
  const pose = BusSim.at(world.route, bus.s, bus.lat);
  assert.ok(Math.abs(p.x - pose.x) < 0.01 && Math.abs(p.z - pose.z) < 0.01, 'bus off route');
  assert.ok(Math.abs(gfx.bus.wheels[0].spin.rotation.x) > 0.1, 'wheels not spinning');
  assert.ok(Math.abs(gfx.bus.steerPivots[0].rotation.y) >= 0, 'steer pivot missing');
  assert.ok(up.trafficMeshes.length >= 12, 'traffic meshes=' + up.trafficMeshes.length);
});

t('traffic meshes track their simulation positions', () => {
  const { world, gfx, ctx: c } = ctx;
  const up = BusGfx.makeUpdater(c, world, gfx, {});
  const bus = BusSim.createBus(world.route);
  const traffic = BusSim.spawnTraffic(world, 6);
  for (let i = 0; i < 60; i++) {
    BusSim.stepTraffic(traffic, world.route, 1 / 60);
    BusSim.step(bus, world, traffic, { throttle: 0.5, assist: 0.9 }, 1 / 60);
    up.update(bus, traffic, 1 / 60, 1, 0);
  }
  for (let i = 0; i < traffic.length; i++) {
    const want = BusSim.at(world.route, traffic[i].s, traffic[i].lat);
    const got = up.trafficMeshes[i].root.position;
    assert.ok(Math.abs(got.x - want.x) < 0.01 && Math.abs(got.z - want.z) < 0.01,
      'traffic ' + i + ' misplaced');
  }
});

t('camera follows the bus and stays finite for all camera modes', () => {
  const { world, gfx, ctx: c } = ctx;
  const up = BusGfx.makeUpdater(c, world, gfx, {});
  const bus = BusSim.createBus(world.route);
  const traffic = BusSim.spawnTraffic(world, 8);
  for (const mode of [1, 2, 3]) {
    for (let i = 0; i < 120; i++) {
      BusSim.stepTraffic(traffic, world.route, 1 / 60);
      BusSim.step(bus, world, traffic, { throttle: 1, assist: 0.9 }, 1 / 60);
      up.update(bus, traffic, 1 / 60, mode, i % 30 === 0 ? 0.6 : 0);
    }
    const cp = c.camera.position;
    assert.ok([cp.x, cp.y, cp.z].every(Number.isFinite), 'mode ' + mode + ': NaN camera');
    const d = Math.hypot(cp.x - gfx.bus.root.position.x, cp.z - gfx.bus.root.position.z);
    assert.ok(d < 40, 'mode ' + mode + ': camera ' + d.toFixed(1) + ' m from bus');
    assert.ok(c.camera.fov > 0.9 && c.camera.fov < 1.4, 'fov=' + c.camera.fov);
  }
});

t('render loop runs a full simulated lap without throwing', () => {
  const { world, gfx, ctx: c, engine } = ctx;
  const up = BusGfx.makeUpdater(c, world, gfx, {});
  const bus = BusSim.createBus(world.route);
  const traffic = BusSim.spawnTraffic(world, 8);
  for (let i = 0; i < 60 * 210; i++) {
    BusSim.stepTraffic(traffic, world.route, 1 / 60);
    BusSim.step(bus, world, traffic, { throttle: 0.85, assist: 0.9 }, 1 / 60);
    up.update(bus, traffic, 1 / 60, 1, bus.crashTimer);
    if (i % 10 === 0) c.scene.render();
  }
  assert.ok(bus.odo > world.route.total, 'did not complete a lap: ' + bus.odo.toFixed(0));
  assert.ok(bus.laps >= 1, 'laps=' + bus.laps);
  engine.dispose();
});

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
