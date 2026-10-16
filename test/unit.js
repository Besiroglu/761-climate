// Logic tests against the mock (no writes reach the house). Run: node test/unit.js
const assert = require('assert');
const Core = require('../src/core.js');
const { makeMock } = require('./mock.js');
const cfg = require('../src/rooms.json');
const fixture = require('./fixture.json');

function fresh(mut) {
  const mock = makeMock(fixture);
  if (mut) mut(mock.s);
  const core = Core.makeCore({ cfg, key: 'TEST', fetch: mock.fetch });
  return { mock, core, z: i => mock.s.zones[i], g: i => mock.s.hc_groups[i] };
}
let n = 0; const ok = (name) => console.log('ok', ++n, name);
const band = z => [z.setpoint_h, z.setpoint_c];

(async () => {
  // Base state: main floor manual heating, master bed (5) at ~67.8, living (0) ~72.
  { // 1. Primary bedroom to 68 while the floor already heats: band on its sensor and the sensors that run its ceiling; fan on.
    const t = fresh(s => { s.zones[5].temperature = 66; s.fan_coils[1].par_on = false; });
    await t.core.setRoom('primary', 68);
    assert.deepStrictEqual(band(t.z(5)), [68, 70]);
    assert.deepStrictEqual(band(t.z(6)), [68, 70]);          // MASTER BATH sensor runs the primary bedroom ceiling
    assert.strictEqual(t.z(7).setpoint_h, 68);                 // BATH 02 sensor (heat only) runs the primary bath ceiling
    assert.strictEqual(t.g(0).season_request, 'heating');
    assert.strictEqual(t.mock.s.fan_coils[1].par_on, true);
    ok('primary 68 in heating');
  }
  { // 2. Latest wins: living room to 68 while it is 72 and the floor heats -> floor switches to cooling, others keep their wish.
    const t = fresh(s => { s.zones[0].temperature = 72; s.zones[5].setpoint_h = 68; s.zones[5].setpoint_c = 70; s.zones[1].setpoint_h = 70; s.zones[1].setpoint_c = 72; });
    await t.core.setRoom('living', 68);
    assert.strictEqual(t.g(0).season_request, 'cooling');
    assert.deepStrictEqual(band(t.z(0)), [66, 68]);
    assert.deepStrictEqual(band(t.z(5)), [66, 68]);            // primary keeps 68, expressed for cooling
    assert.deepStrictEqual(band(t.z(1)), [68, 70]);            // dining keeps 70
    assert.strictEqual(t.g(1).season_request, fixture.hc_groups[1].season_request); // basement untouched
    ok('living 68 flips main floor to cooling and re-bands');
  }
  { // 3. Supervisor hands the floor to the room that is waiting once the latest request is satisfied.
    const t = fresh(s => { s.hc_groups[0].season_request = 'cooling'; s.hc_groups[0].active_season = 'cooling';
      s.zones[0].setpoint_h = 66; s.zones[0].setpoint_c = 68; s.zones[0].temperature = 67.9;      // living satisfied
      s.zones[5].setpoint_h = 66; s.zones[5].setpoint_c = 68; s.zones[5].temperature = 65.5;      // primary wants heat (2.5 below)
      for (const i of [1, 2, 4]) { s.zones[i].setpoint_h = 68; s.zones[i].setpoint_c = 70; s.zones[i].temperature = 69; } });
    const out = await t.core.supervise({}, Date.now(), 0);
    assert.strictEqual(t.g(0).season_request, 'heating', out.join('\n'));
    assert.deepStrictEqual(band(t.z(5)), [68, 70]);
    assert.deepStrictEqual(band(t.z(0)), [68, 70]);
    ok('supervisor switches to heating for the waiting room: ' + out[0]);
  }
  { // 4. ...but not before the minimum time in the current mode.
    const t = fresh(s => { s.hc_groups[0].season_request = 'cooling'; s.hc_groups[0].active_season = 'cooling';
      s.zones[0].setpoint_h = 66; s.zones[0].setpoint_c = 68; s.zones[0].temperature = 67.9;
      s.zones[5].setpoint_h = 66; s.zones[5].setpoint_c = 68; s.zones[5].temperature = 65.5; });
    const now = Date.now();
    const out = await t.core.supervise({ floors: { 0: { season: 'cooling', since: now - 10 * 60e3 } } }, now, 45);
    assert.strictEqual(t.g(0).season_request, 'cooling', out.join('\n'));
    ok('supervisor waits for the minimum time');
  }
  { // 5. Admin hold: floor held in cooling; a room asking for heat does not flip it; supervisor leaves it alone.
    const t = fresh(s => { s.zones[5].temperature = 64; });
    await t.core.setFloor(0, 'cooling');
    assert.strictEqual(t.g(0).name, 'Main Floor (hold)');
    assert.strictEqual(t.g(0).season_request, 'cooling');
    await t.core.setRoom('primary', 70);
    assert.strictEqual(t.g(0).season_request, 'cooling');
    assert.deepStrictEqual(band(t.z(5)), [68, 70]);
    const out = await t.core.supervise({}, Date.now(), 0);
    assert.ok(out[0].includes('held'));
    const m = t.core.model(t.mock.s); assert.strictEqual(m.rooms.find(r => r.key === 'primary').status.code, 'held');
    await t.core.setFloor(0, 'app');
    assert.strictEqual(t.g(0).name, 'Main Floor');
    ok('admin hold and release');
  }
  { // 6. Eco on bedrooms 2 & 3: wide band on the sensor and its heat-only follower; eco rooms do not pull the floor.
    const t = fresh();
    await t.core.setRoom('beds23', 'eco');
    assert.deepStrictEqual(band(t.z(4)), [62, 78]);
    assert.strictEqual(t.z(8).setpoint_h, 62);
    const m = t.core.model(t.mock.s); assert.strictEqual(m.rooms.find(r => r.key === 'beds23').eco, true);
    ok('eco');
  }
  { // 7. Basement game room to 71 while heating: cool-to tops out at 72, so the band is (71, 72).
    const t = fresh(s => { s.zones[12].temperature = 69; });
    await t.core.setRoom('game', 71);
    assert.deepStrictEqual(band(t.z(12)), [71, 72]);
    // and to 66 when 69: wants cooling -> basement switches to cooling; band (65, 66)
    await t.core.setRoom('game', 66);
    assert.strictEqual(t.g(1).season_request, 'cooling');
    assert.deepStrictEqual(band(t.z(12)), [65, 66]);
    ok('basement limits');
  }
  { // 8. Great room: its ceiling answers to the Bedroom 3 sensor, nudged 1F past bedroom 3's own temperature.
    const t = fresh(s => { s.zones[2].temperature = 67; s.zones[3].temperature = 66.6; s.zones[3].setpoint_h = 63; s.zones[3].setpoint_c = 65; });
    await t.core.setRoom('great', 70);
    assert.deepStrictEqual(band(t.z(2)), [70, 72]);
    assert.deepStrictEqual(band(t.z(3)), [68, 70]);           // calls heat (66.6 + 1 -> 68 on the half grid... ceil(67.6)=68)
    t.mock.s.zones[2].temperature = 70.3;                    // great room got there
    await t.core.supervise({}, Date.now(), 45);
    assert.ok(t.z(3).setpoint_h < t.z(3).temperature, 'puppet released');
    ok('great room puppet opens and releases');
  }
  { // 9. Floor left in Messana auto without a hold: supervisor takes it over in its current season.
    const t = fresh(s => { s.hc_groups[1].season_request = 'comfort_range'; });
    await t.core.supervise({}, Date.now(), 45);
    assert.strictEqual(t.g(1).season_request, t.g(1).active_season);
    ok('takes over a floor left in auto');
  }
  { // 10. Status words.
    const t = fresh(s => { s.zones[5].temperature = 66; s.zones[5].setpoint_h = 68; s.zones[5].setpoint_c = 70;
      s.buffer_tanks[0].temperature = 112; });
    const m = t.core.model(t.mock.s);
    assert.strictEqual(m.rooms.find(r => r.key === 'primary').status.code, 'heating');
    t.mock.s.buffer_tanks[0].temperature = 60;
    assert.strictEqual(t.core.model(t.mock.s).rooms.find(r => r.key === 'primary').status.code, 'switching');
    ok('status codes');
  }
  console.log('all passed');
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
