// Admin section (built only into the admin page). Overrides persist because a held floor is marked "(hold)" in
// Messana's own group name, which the supervisor and the shared app both respect.
const AT = {
  en: { admin: 'Admin', floors: 'Floor modes', app: 'App', heat: 'Heat', cool: 'Cool', messana: 'Messana',
    floorSub: (f, tank) => `${f.hold ? 'Held by you' : 'App decides (latest request first)'} · tank ${tank}`,
    fans: 'Fan coils', fanNow: v => `Fan ${v}% now`, manual: 'Manual speeds, used only in Manual mode', cool2: 'cool', heat2: 'heat',
    equip: 'Equipment', tank: 'Tank', hp: 'Heat pump', out: 'out', notWorking: 'not adding heat or cooling', vsTank: 'vs tank', supRet: 'water', loop: 'Loop', pump: 'pump', valve: 'valve',
    sensors: 'Room sensors', sensor: 'Sensor', drives: 'ceiling:', heatTo: 'Heat to', coolTo: 'Cool to',
    auto: 'Automation', lastRun: t => `Background check last ran ${t}`, never: 'Background check: no runs yet', apply: 'Apply the app’s rules now',
    issues: 'Known issues', issue1: 'HP 1’s water comes out at tank temperature while HP 2 adds about 15°F: HP 1 appears not to be running (or its sensor is on the wrong pipe). The main floor is on one heat pump.',
    issue2: 'Main-floor sensors are linked one room over from the kitchen on (the Bedroom 2 sensor runs Bedroom 3’s ceiling, and so on). The app compensates; once the installer re-links them, its room map can be simplified.',
    issue3: 'The basement office has a valve but no sensor, so its ceiling never runs.' },
  ja: { admin: '管理', floors: '各階のモード', app: 'アプリ', heat: '暖房', cool: '冷房', messana: 'Messana',
    floorSub: (f, tank) => `${f.hold ? '管理者が固定中' : 'アプリが判断（最新の変更を優先）'} · タンク ${tank}`,
    fans: 'ファンコイル', fanNow: v => `現在 ${v}%`, manual: '手動速度（手動モードのときのみ使用）', cool2: '冷', heat2: '暖',
    equip: '機器', tank: 'タンク', hp: 'ヒートポンプ', out: '出口', notWorking: '加熱・冷却していません', vsTank: 'タンク比', supRet: '水温', loop: '系統', pump: 'ポンプ', valve: '弁',
    sensors: '室内センサー', sensor: 'センサー', drives: '天井:', heatTo: '暖房', coolTo: '冷房',
    auto: '自動制御', lastRun: t => `自動チェック最終実行 ${t}`, never: '自動チェック：まだ実行されていません', apply: 'アプリのルールを今すぐ適用',
    issues: '既知の問題', issue1: 'HP 1 の出口温度がタンクと同じで、HP 2 は約15°F上げています。HP 1 は動いていない（またはセンサーの位置が違う）ようです。1階はヒートポンプ1台で運転中です。',
    issue2: '1階のセンサーがキッチン以降、隣の部屋の天井とつながっています（寝室2のセンサーが寝室3の天井を動かすなど）。アプリで補正しています。業者が直したら部屋の対応表を簡略化できます。',
    issue3: '地下の書斎は弁はありますがセンサーがないため、天井が動きません。' },
};
const at = () => AT[LANG];
let lastRunTxt = null;
async function loadRuns() {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/supervise.yml/runs?per_page=1`);
    const j = await r.json(); const run = j.workflow_runs && j.workflow_runs[0];
    lastRunTxt = run ? new Date(run.updated_at).toLocaleString(LANG === 'ja' ? 'ja-JP' : 'en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) + (run.conclusion && run.conclusion !== 'success' ? ` (${run.conclusion})` : '') : '';
  } catch (e) { lastRunTxt = null; }
  renderAdmin();
}
function seg(id, opts, cur) {
  return `<div class="seg">${opts.map(([v, l]) => `<button class="${v === cur ? 'on' : ''}" onclick="${id}('${v}')">${l}</button>`).join('')}</div>`;
}
window.floorAct = {};
function adminFloor(fid, what) { queue(async () => { M = await core.setFloor(fid, what); render(); }); }
function adminSensor(idx, which, d) {
  const z = M.s.zones[idx]; let h = z.setpoint_h, c = z.setpoint_c;
  if (which === 'h') h = Core.half(h + d); else c = Core.half(c + d);
  if (which === 'h' && c < h + 2 && !CFG.heatOnlySensors.includes(idx)) c = h + 2;
  if (which === 'c' && h > c - 2) h = c - 2;
  queue(async () => { await core.setSensor(idx, h, c); M = core.model(await core.snapshot()); render(); });
}
function adminFan(id, on) { queue(async () => { await core.setFan(id, on); M = core.model(await core.snapshot()); render(); }); }
function adminFanLevel(id, which, d) {
  queue(async () => {
    const cur = await core.api(`/api/fcu/${which === 'heating' ? 'heatingSpeed' : 'coolingSpeed'}/${id}`);
    const v = Core.clamp((cur.value || 0) + d, 0, 100);
    await core.setFanLevel(id, which, v); fanLevels[id + which] = v; renderAdmin();
  });
}
const fanLevels = {};
async function loadFanLevels() {
  for (const f of CFG.fcus) for (const w of ['cooling', 'heating']) {
    try { fanLevels[f.id + w] = (await core.api(`/api/fcu/${w === 'heating' ? 'heatingSpeed' : 'coolingSpeed'}/${f.id}`)).value; } catch (e) {}
  }
  renderAdmin();
}
function applyNow() { queue(async () => { const out = await core.supervise({}, Date.now(), 0); console.log(out.join('\n')); M = core.model(await core.snapshot()); render(); }); }
function renderAdmin() {
  if (!M) return;
  const a = at(), s = M.s;
  let h = `<section class="floor"><div class="fhead"><h2>${a.floors}</h2></div><div class="group">`;
  for (const f of M.floors) {
    const cur = f.hold ? (f.mode === 'auto' ? 'auto' : f.mode) : 'app';
    window.floorAct[f.id] = v => adminFloor(f.id, v);
    h += `<div class="kv"><div class="k">${nm(f.name)}</div><div class="v">${a.floorSub(f, fmtNow(f.tank))}</div>
      <div style="margin-top:10px">${seg(`floorAct[${f.id}]`, [['app', a.app], ['heating', a.heat], ['cooling', a.cool], ['auto', a.messana]], cur)}</div></div>`;
  }
  h += `</div></section><section class="floor"><div class="fhead"><h2>${a.fans}</h2></div><div class="group">`;
  for (const fc of CFG.fcus) {
    const live = s.fan_coils[fc.id];
    h += `<div class="arow"><div><div class="l">${nm(fc.name)}</div><div class="s">${a.fanNow(Math.round(live.fan_level))}</div></div>
      <button class="sw ${live.par_on ? 'on' : ''}" onclick="adminFan(${fc.id}, ${!live.par_on})" aria-label="on/off"></button></div>
      <div class="speeds"><span>${a.manual}</span></div><div class="speeds" style="padding-top:0">
      <span class="mini">${a.cool2}&nbsp;<button onclick="adminFanLevel(${fc.id},'cooling',-10)">−</button><b>${fanLevels[fc.id + 'cooling'] ?? '–'}</b><button onclick="adminFanLevel(${fc.id},'cooling',10)">+</button></span>
      <span class="mini">${a.heat2}&nbsp;<button onclick="adminFanLevel(${fc.id},'heating',-10)">−</button><b>${fanLevels[fc.id + 'heating'] ?? '–'}</b><button onclick="adminFanLevel(${fc.id},'heating',10)">+</button></span></div>`;
  }
  h += `</div></section><section class="floor"><div class="fhead"><h2>${a.equip}</h2></div><div class="group">`;
  const dT = d => `${d >= 0 ? '+' : ''}${(UNIT === 'C' ? d * 5 / 9 : d).toFixed(1)}°`;
  for (const b of s.buffer_tanks) {
    const season = M.floors[b.related_group] ? M.floors[b.related_group].season : 'heating', sign = season === 'heating' ? 1 : -1;
    const works = ei => { const e = s.energy_sources[ei]; return e.status === 'on' && sign * (e.supply_temp - b.temperature) > 2; };
    h += `<div class="kv"><div class="k">${a.tank} ${b.name.split(' ')[0]}</div><div class="v">${fmtNow(b.temperature)} → ${fmtNow(b.target_temp)}</div></div>`;
    for (const ei of b.related_energy_sources) {
      const e = s.energy_sources[ei], d = e.supply_temp - b.temperature;
      const bad = e.status === 'on' && !works(ei) && b.related_energy_sources.some(o => o !== ei && works(o));
      h += `<div class="kv"><div class="k">${e.name}</div><div class="v ${bad ? 'warn' : ''}">${e.status} · ${a.out} ${fmtNow(e.supply_temp)} (${dT(d)} ${a.vsTank})${bad ? ' · ' + a.notWorking : ''}</div></div>`;
    }
  }
  for (const y of s.hydronic_systems) {
    const sup = y.supply_temp > -1000 ? fmtNow(y.supply_temp) : '–', ret = y.return_temp > -1000 ? fmtNow(y.return_temp) : '–', tt = y.target_temp > -1000 ? fmtNow(y.target_temp) : '–';
    h += `<div class="kv"><div class="k">${y.name.replace('Hydronic System - ', '').trim()}</div><div class="v">${a.supRet} ${sup} / ${ret} → ${tt} · ${a.pump} ${y.pump_status}${y.mixing_valve_position != null ? ` · ${a.valve} ${y.mixing_valve_position}%` : ''}</div></div>`;
  }
  h += `</div></section><section class="floor"><div class="fhead"><h2>${a.sensors}</h2></div><div class="group">
    <div class="sens" style="padding-bottom:0"><div></div><div class="hd">${a.heatTo}</div><div class="hd">${a.coolTo}</div></div>`;
  s.zones.forEach((z, i) => {
    const ho = CFG.heatOnlySensors.includes(i);
    const st = (side, v) => `<span class="mini"><button onclick="adminSensor(${i},'${side}',-0.5)">−</button><b>${fmtT(v)}</b><button onclick="adminSensor(${i},'${side}',0.5)">+</button></span>`;
    h += `<div class="sens"><div><div class="n">${z.name.toLowerCase().replace(/(^|\s)\S/g, m => m.toUpperCase())}</div><div class="d">${fmtNow(z.temperature)} · ${a.drives} ${CFG.ceilingOf[i] || '–'}</div></div>
      <div>${st('h', z.setpoint_h)}</div><div>${ho ? '' : st('c', z.setpoint_c)}</div></div>`;
  });
  h += `</div></section><section class="floor"><div class="fhead"><h2>${a.auto}</h2></div><div class="group"><div class="arow"><div class="s">${lastRunTxt ? a.lastRun(lastRunTxt) : a.never}</div></div></div>
    <button class="btn" onclick="applyNow()">${a.apply}</button></section>
    <section class="floor"><div class="fhead"><h2>${a.issues}</h2></div><div class="group"><div class="arow"><div class="small">${a.issue1}</div></div><div class="arow"><div class="small">${a.issue2}</div></div><div class="arow"><div class="small">${a.issue3}</div></div></div></section>`;
  $('admin').innerHTML = h;
}
loadRuns(); loadFanLevels();
