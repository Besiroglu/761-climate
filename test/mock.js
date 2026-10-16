// A stand-in for Messana's API, built on a saved snapshot. Writes behave like the real controller as measured on
// 15 Oct 2026: plain /zone/setpoint sets heat-to with no margin check; /zone/dualSetpoint keeps cool >= heat + 2 by
// moving the other side; /hc/mode 0/1/2 = heating/cooling/auto. Every write is recorded in `log`.
function makeMock(fixture) {
  const s = JSON.parse(JSON.stringify(fixture));
  const log = [];
  const fan = { '0cooling': 100, '0heating': 35, '1cooling': 100, '1heating': 35 };
  function reply(status, json) { return { status, json }; }
  function handle(method, url, body) {
    const u = new URL(url), p = u.pathname.replace(/^\/2022-0185/, '');
    if (u.hostname === 'api.github.com') return reply(200, { workflow_runs: [{ updated_at: new Date(Date.now() - 4 * 60e3).toISOString(), conclusion: 'success' }] });
    if (method === 'GET') {
      if (p === '/api/system/snapshot') return reply(200, s);
      if (p === '/api/system/outdoor') return reply(200, { outdoor: { temperature: 62 } });
      let m;
      if ((m = p.match(/^\/api\/fcu\/(coolingSpeed|heatingSpeed)\/(\d)$/))) return reply(200, { value: fan[m[2] + (m[1] === 'heatingSpeed' ? 'heating' : 'cooling')] });
      if ((m = p.match(/^\/api\/hc\/mode\/(\d)$/))) { const g = s.hc_groups[+m[1]]; return reply(200, { value: g.season_request === 'heating' ? 0 : g.season_request === 'cooling' ? 1 : 2 }); }
      return reply(404, 'not mocked ' + p);
    }
    log.push(p + ' ' + JSON.stringify(body));
    const z = body && s.zones[body.id];
    switch (p) {
      case '/api/zone/setpoint': z.setpoint_h = body.value; return reply(200, { 'SUCCESS[setpoint]': String(body.value) });
      case '/api/zone/dualSetpoint':
        if (body.mode === 'cooling') { z.setpoint_c = body.value; if (z.setpoint_h > body.value - 2) z.setpoint_h = body.value - 2; }
        else { z.setpoint_h = body.value; if (z.setpoint_c < body.value + 2) z.setpoint_c = body.value + 2; }
        return reply(200, { 'SUCCESS[dualSetpoint]': { heatingSetpoint: z.setpoint_h, coolingSetpoint: z.setpoint_c } });
      case '/api/hc/mode': {
        const g = s.hc_groups[body.id];
        if (body.value === 2) g.season_request = 'comfort_range';
        else { g.season_request = body.value === 0 ? 'heating' : 'cooling'; g.active_season = g.season_request; }
        return reply(200, { 'SUCCESS[mode]': String(body.value) });
      }
      case '/api/hc/name': s.hc_groups[body.id].name = body.value; return reply(200, { 'SUCCESS[name]': body.value });
      case '/api/fcu/status': s.fan_coils[body.id].par_on = !!body.value; return reply(200, { 'SUCCESS[status]': String(body.value) });
      case '/api/fcu/coolingSpeed': fan[body.id + 'cooling'] = body.value; return reply(200, {});
      case '/api/fcu/heatingSpeed': fan[body.id + 'heating'] = body.value; return reply(200, {});
    }
    return reply(404, 'not mocked ' + p);
  }
  const fetch = async (url, opts = {}) => {
    const r = handle(opts.method || 'GET', url, opts.body ? JSON.parse(opts.body) : undefined);
    return { ok: r.status < 300, status: r.status, text: async () => typeof r.json === 'string' ? r.json : JSON.stringify(r.json) };
  };
  return { s, log, handle, fetch };
}
module.exports = { makeMock };
