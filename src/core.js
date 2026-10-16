// 761 climate: control logic shared by the phone app (browser) and the supervisor (Node on GitHub Actions).
// How the house works (checked live 15 Oct 2026): each floor is one 2-pipe water loop, so it heats OR cools.
// Every room sensor has two targets, heat-to and cool-to (cool >= heat + 2 for the dual API). Messana itself runs the
// ceilings and fan coils toward those targets; this file decides the targets and each floor's mode.
// A room's wish ("intent") lives in its own sensor's targets: (T, T+2) while its floor heats, (T-2, T) while it cools.
// A band wider than 2.6F is "eco" (only kept inside a wide range).
(function (root) {
  const HOLD = ' (hold)';
  const OPP = { heating: 'cooling', cooling: 'heating' };
  const half = x => Math.round(x * 2) / 2;
  const ceilHalf = x => Math.ceil(x * 2 - 1e-9) / 2;
  const floorHalf = x => Math.floor(x * 2 + 1e-9) / 2;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function makeCore(opts) {
    const cfg = opts.cfg, key = opts.key, dry = !!opts.dry;
    const base = opts.base || ('https://api.messana.tech/' + cfg.system);
    const fetchFn = opts.fetch || ((...a) => fetch(...a));
    const log = opts.log || (() => {});
    const heatOnly = new Set(cfg.heatOnlySensors);

    async function api(path, body) {
      const url = base + path + (path.includes('?') ? '&' : '?') + 'apikey=' + encodeURIComponent(key);
      if (body !== undefined && dry) { log('DRY PUT ' + path + ' ' + JSON.stringify(body)); return { dry: true }; }
      let lastErr;
      for (let i = 0; i < 3; i++) {
        let r;
        try {
          r = await fetchFn(url, body === undefined ? {} : { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        } catch (e) { lastErr = e; await sleep(700 * (i + 1)); continue; }  // network: retry (every call here is safe to repeat)
        const t = await r.text(); let j; try { j = JSON.parse(t); } catch (e) { j = t; }
        if (!r.ok) throw new Error(path + ': HTTP ' + r.status + ' ' + (typeof j === 'string' ? j : JSON.stringify(j)).slice(0, 200));
        if (body !== undefined) log('PUT ' + path + ' ' + JSON.stringify(body));
        return j;
      }
      throw lastErr;
    }
    const snapshot = () => api('/api/system/snapshot');

    // ---------- reading the house ----------
    function model(s) {
      const floors = cfg.floors.map(f => {
        const g = s.hc_groups[f.id];
        const tank = s.buffer_tanks.find(b => b.related_group === f.id) || {};
        const mode = (g.season_request === 'heating' || g.season_request === 'cooling') ? g.season_request : 'auto';
        return Object.assign({}, f, { groupName: g.name, hold: g.name.endsWith(HOLD), mode, season: g.active_season,
          tank: tank.temperature, tankTarget: tank.target_temp });
      });
      const rooms = cfg.rooms.map(r => {
        const z = s.zones[r.sensor], f = floors[r.floor];
        const ho = heatOnly.has(r.sensor);
        const h = z.setpoint_h, c = z.setpoint_c;
        const eco = !ho && (c - h) > 2.6;
        const T = ho ? h : eco ? null : (f.season === 'heating' ? h : c);
        const fc = r.fcu == null ? null : s.fan_coils[r.fcu];
        const room = Object.assign({}, r, { temp: z.temperature, humidity: z.humidity, h, c, heatOnly: ho, eco, T,
          fanOn: fc ? !!fc.par_on : null, fanLevel: fc ? fc.fan_level : null });
        room.status = status(room, f);
        return room;
      });
      return { floors, rooms, s };
    }

    // Does this room want `season` (beyond `thr` degrees past its wish)?
    function wants(r, season, thr) {
      if (r.eco) return season === 'heating' ? r.temp < r.h - Math.max(thr, 0.5) : r.temp > r.c + Math.max(thr, 0.5);
      if (r.T == null) return false;
      if (season === 'heating') return r.temp < r.T - thr;
      return !r.heatOnly && r.temp > r.T + thr;
    }

    function status(r, f) {
      if (r.eco) return { code: 'eco' };
      const need = wants(r, 'heating', 0.5) ? 'heating' : wants(r, 'cooling', 0.5) ? 'cooling' : null;
      if (!need) return { code: 'ok' };
      if (f.season !== need) return { code: f.hold ? 'held' : 'waiting', need };
      const ready = need === 'heating' ? f.tank >= 90 : f.tank <= 65;  // water still changing over after a switch
      return { code: ready ? need : 'switching', need };
    }

    // ---------- writing targets ----------
    function bandFor(T, season, f) {
      if (season === 'heating') return [T, Math.min(T + 2, f.maxC)];
      return [Math.max(T - 2, f.minH), T];
    }
    // Set one sensor to exactly (h, c). The dual call keeps cool >= heat + 2 by moving heat down; the plain call sets
    // heat-to without that check (needed in the basement, whose cool-to tops out at 72).
    async function writeBand(s, idx, h, c) {
      const z = s.zones[idx];
      if (heatOnly.has(idx)) { if (z.setpoint_h !== h) await api('/api/zone/setpoint', { id: idx, value: h }); return; }
      let changedC = false;
      if (z.setpoint_c !== c) { await api('/api/zone/dualSetpoint', { id: idx, mode: 'cooling', value: c }); changedC = true; }
      if (changedC || z.setpoint_h !== h) await api('/api/zone/setpoint', { id: idx, value: h });
    }
    // A room's band goes on its own sensor and on the sensors that actually run its ceiling.
    async function writeRoom(s, m, room, T, season) {
      const f = m.floors[room.floor];
      let h, c;
      if (T === 'eco') [h, c] = f.eco; else [h, c] = bandFor(clamp(half(T), f.min, f.max), season, f);
      for (const idx of [room.sensor, ...room.followers]) {
        const hh = heatOnly.has(idx) ? (T === 'eco' ? f.eco[0] : clamp(half(T), f.minH, f.max)) : h;
        await writeBand(s, idx, hh, c);
      }
    }
    // Great room: its ceiling valve answers to the Bedroom 3 sensor, so open/close it by nudging that sensor's
    // targets 1F past bedroom 3's own temperature (less than its 3F+ fan-coil margin, so FCU-2 isn't triggered).
    async function writePuppet(s, m, room, season) {
      if (room.puppet == null) return;
      const p = s.zones[room.puppet], t3 = p.temperature, f = m.floors[room.floor];
      const callingNow = season === 'heating' ? p.setpoint_h > t3 : p.setpoint_c < t3;
      let want;
      if (room.eco) want = wants(room, season, 0.3);
      else if (season === 'heating') want = callingNow ? room.temp < room.T + 0.2 : room.temp < room.T - 0.2;
      else want = callingNow ? room.temp > room.T - 0.2 : room.temp > room.T + 0.2;
      // already doing the right thing with a sensible margin: leave it (avoids rewriting every few minutes)
      const off = season === 'heating' ? p.setpoint_h - t3 : t3 - p.setpoint_c;
      if (want === callingNow && (want ? off >= 0.5 && off <= 2 : off <= -0.5 && off >= -3.5) && p.setpoint_c - p.setpoint_h >= 2) return;
      let h, c;
      if (season === 'heating') { if (want) { h = ceilHalf(t3 + 1); c = h + 2; } else { h = floorHalf(t3 - 1.5); c = h + 3; } }
      else { if (want) { c = floorHalf(t3 - 1); h = c - 2; } else { c = ceilHalf(t3 + 1.5); h = c - 3; } }
      h = clamp(h, f.minH, f.maxC - 2); c = clamp(c, h + 2, f.maxC);
      await writeBand(s, room.puppet, h, c);
    }
    async function setMode(fid, season) {
      await api('/api/hc/mode', { id: fid, value: season === 'heating' ? 0 : season === 'cooling' ? 1 : 2 });
    }
    // Re-express every room on a floor for `season`, keeping each room's wish.
    async function rebandFloor(s, m, fid, season) {
      for (const r of m.rooms.filter(r => r.floor === fid)) {
        await writeRoom(s, m, r, r.eco ? 'eco' : r.T, season);
        await writePuppet(s, m, r, season);
      }
    }

    // ---------- actions ----------
    // The user picks a temperature; this makes the house go there. Latest request wins its floor's mode.
    async function setRoom(key, T, why) {
      let s = await snapshot(); let m = model(s);
      const room = m.rooms.find(r => r.key === key), f = m.floors[room.floor];
      const eco = T === 'eco';
      if (!eco) T = clamp(half(T), f.min, f.max);
      let season = f.season;
      if (!f.hold) {
        let need = null;
        if (!eco) { if (room.temp < T - 0.3) need = 'heating'; else if (room.temp > T + 0.3 && !room.heatOnly) need = 'cooling'; }
        const target = need || season;
        if (f.mode !== target) {
          await setMode(f.id, target);
          log(`${f.key}: ${f.mode} -> ${target} (${why || 'request'} for ${key})`);
          if (target !== season) { await rebandFloor(s, m, f.id, target); season = target; s = await snapshot(); m = model(s); }
        }
      }
      const r2 = m.rooms.find(r => r.key === key);
      await writeRoom(s, m, r2, eco ? 'eco' : T, season);
      if (r2.puppet != null) { s = await snapshot(); m = model(s); await writePuppet(s, m, m.rooms.find(r => r.key === key), season); }
      if (!f.hold && r2.fcu != null && !eco && !s.fan_coils[r2.fcu].par_on) await api('/api/fcu/status', { id: r2.fcu, value: 1 });
      return model(await snapshot());
    }

    // Admin: 'app' (app decides), 'heating' / 'cooling' (held), 'auto' (held: Messana's own room vote).
    async function setFloor(fid, what) {
      let s = await snapshot(); let m = model(s); const f = m.floors[fid];
      const baseName = f.groupName.endsWith(HOLD) ? f.groupName.slice(0, -HOLD.length) : f.groupName;
      if (what === 'app') {
        if (f.hold) await api('/api/hc/name', { id: fid, value: baseName });
        if (f.mode === 'auto') await setMode(fid, f.season);
      } else {
        if (!f.hold) await api('/api/hc/name', { id: fid, value: baseName + HOLD });
        await setMode(fid, what);
        if ((what === 'heating' || what === 'cooling') && what !== f.season) { s = await snapshot(); await rebandFloor(s, m, fid, what); }
      }
      return model(await snapshot());
    }

    // Supervisor pass (every few minutes): take over floors left in auto, keep followers and the puppet in step,
    // and when nothing on a floor wants its current mode but a room clearly wants the other one, switch
    // (after at least `dwellMin` minutes in the current mode, so the water isn't flipped back and forth).
    async function supervise(state, now, dwellMin = 45) {
      let s = await snapshot(); let m = model(s);
      const out = [];
      state.floors = state.floors || {};
      for (const f of m.floors) {
        const st = state.floors[f.id] = state.floors[f.id] || {};
        if (st.season !== f.season) { st.season = f.season; st.since = now; }
        if (f.hold) { out.push(`${f.key}: held (${f.mode})`); continue; }
        if (f.mode === 'auto') { await setMode(f.id, f.season); out.push(`${f.key}: took over from auto, keeping ${f.season}`); }
        const rooms = m.rooms.filter(r => r.floor === f.id);
        const cur = rooms.filter(r => wants(r, f.season, 0.3));
        const other = rooms.filter(r => wants(r, OPP[f.season], 1.0));
        const dwellOk = !st.since || (now - st.since) >= dwellMin * 60e3;
        if (!cur.length && other.length && dwellOk) {
          const to = OPP[f.season];
          await setMode(f.id, to); await rebandFloor(s, m, f.id, to);
          out.push(`${f.key}: ${f.season} -> ${to} (wanted by ${other.map(r => r.key).join(', ')})`);
          st.season = to; st.since = now;
          s = await snapshot(); m = model(s);
          continue;
        }
        for (const r of rooms) { await writeRoom(s, m, r, r.eco ? 'eco' : r.T, f.season); await writePuppet(s, m, r, f.season); }
        out.push(`${f.key}: ${f.season}; wants ${f.season}: ${cur.map(r => r.key).join(', ') || 'none'}; wants ${OPP[f.season]}: ${other.map(r => r.key).join(', ') || 'none'}${dwellOk ? '' : ' (min time not reached)'}`);
      }
      return out;
    }

    // Admin raw controls
    const setSensor = (idx, h, c) => snapshot().then(s => writeBand(s, idx, h, c));
    const setFan = (id, on) => api('/api/fcu/status', { id, value: on ? 1 : 0 });
    const setFanLevel = (id, which, v) => api('/api/fcu/' + (which === 'heating' ? 'heatingSpeed' : 'coolingSpeed'), { id, value: v });

    return { api, snapshot, model, wants, setRoom, setFloor, supervise, setSensor, setFan, setFanLevel, HOLD };
  }

  const Core = { makeCore, half, clamp };
  if (typeof module !== 'undefined' && module.exports) module.exports = Core; else root.Core = Core;
})(typeof window !== 'undefined' ? window : globalThis);
