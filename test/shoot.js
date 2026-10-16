// Screenshot harness: headless Chrome as an iPhone, Messana API answered by the mock (nothing reaches the house).
// Run: node build.js --test && node test/shoot.js [filter]
const puppeteer = require('puppeteer-core');
const path = require('path'), fs = require('fs');
const { makeMock } = require('./mock.js');
const fixture = require('./fixture.json');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(__dirname, 'shots'); fs.mkdirSync(OUT, { recursive: true });
const PHONES = { pro: { width: 393, height: 852 }, se: { width: 375, height: 667 } };
const filter = process.argv[2] || '';
const wait = ms => new Promise(r => setTimeout(r, ms));

async function open(browser, { phone = 'pro', dark = false, lang = 'en', unit, admin = false, mut } = {}) {
  const mock = makeMock(fixture); if (mut) mut(mock.s);
  const page = await browser.newPage();
  await page.emulate({ viewport: { ...PHONES[phone], deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }]);
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = req.url();
    if (u.startsWith('file:')) return req.continue();
    if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    const r = mock.handle(req.method(), u, req.postData() ? JSON.parse(req.postData()) : undefined);
    req.respond({ status: r.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: typeof r.json === 'string' ? r.json : JSON.stringify(r.json) });
  });
  page.on('pageerror', e => console.log('PAGE ERROR', e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('console.error', m.text()); });
  const file = 'file://' + path.join(__dirname, 'build', admin ? 'admin/index.html' : 'index.html');
  await page.evaluateOnNewDocument((lang, unit) => { localStorage.setItem('lang', lang); if (unit) localStorage.setItem('unit', unit); else localStorage.removeItem('unit'); }, lang, unit || '');
  await page.goto(file, { waitUntil: 'load' });
  await page.waitForSelector('.row', { timeout: 8000 });
  await wait(400);
  return { page, mock };
}
async function shot(page, name, full = false) {
  const f = path.join(OUT, name + '.png'); await page.screenshot({ path: f, fullPage: full }); console.log('shot', name);
}
const tapRoom = async (page, i) => { const rows = await page.$$('.row'); await rows[i].tap(); await wait(700); };

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--hide-scrollbars'] });
  const want = n => !filter || n.includes(filter);
  try {
    if (want('list')) {
      let { page } = await open(browser, {}); await shot(page, 'list-light-en'); await shot(page, 'list-light-en-full', true); await page.close();
      ({ page } = await open(browser, { dark: true })); await shot(page, 'list-dark-en'); await page.close();
      ({ page } = await open(browser, { lang: 'ja' })); await shot(page, 'list-light-ja'); await page.close();
      ({ page } = await open(browser, { phone: 'se' })); await shot(page, 'list-se-en'); await page.close();
    }
    if (want('room')) {
      let { page, mock } = await open(browser, {}); await tapRoom(page, 3); await shot(page, 'room-primary-light');
      await page.tap('#plus'); await wait(150); await page.tap('#plus'); await wait(300); await shot(page, 'room-primary-draft');
      await wait(1600); await shot(page, 'room-primary-sent');
      console.log('writes:', mock.log.join(' | ')); await page.close();
      ({ page } = await open(browser, { dark: true })); await tapRoom(page, 0); await shot(page, 'room-living-dark'); await page.close();
      ({ page } = await open(browser, { lang: 'ja', dark: true })); await tapRoom(page, 3); await shot(page, 'room-primary-ja-dark'); await page.close();
      ({ page } = await open(browser, { phone: 'se' })); await tapRoom(page, 3); await shot(page, 'room-se'); await page.close();
      ({ page } = await open(browser, { mut: s => { s.zones[4].setpoint_h = 62; s.zones[4].setpoint_c = 78; } })); await tapRoom(page, 4); await shot(page, 'room-eco'); await page.close();
    }
    if (want('drag')) {  // drag the knob around the ring
      const { page, mock } = await open(browser, {}); await tapRoom(page, 0);
      const b = await page.$eval('#dialbox', e => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width }; });
      const at = deg => { const a = deg * Math.PI / 180; return { x: b.x + b.w / 2 + Math.cos(a) * b.w * 0.41, y: b.y + b.w / 2 + Math.sin(a) * b.w * 0.41 }; };
      const p0 = at(200); await page.touchscreen.touchStart(p0.x, p0.y);
      for (let d = 200; d <= 300; d += 10) { const p = at(d); await page.touchscreen.touchMove(p.x, p.y); await wait(30); }
      await shot(page, 'drag-mid'); await page.touchscreen.touchEnd(); await wait(1500); await shot(page, 'drag-done');
      console.log('drag writes:', mock.log.join(' | ')); await page.close();
    }
    if (want('settings')) {
      const { page } = await open(browser, {}); await page.tap('#settingsBtn'); await wait(600); await shot(page, 'settings');
      await page.tap('#segLang button[data-v="ja"]'); await wait(300); await shot(page, 'settings-ja'); await page.close();
    }
    if (want('admin')) {
      let { page } = await open(browser, { admin: true }); await wait(800); await shot(page, 'admin-full', true); await page.close();
      ({ page } = await open(browser, { admin: true, dark: true })); await wait(800); await shot(page, 'admin-full-dark', true); await page.close();
    }
    if (want('celsius')) { const { page } = await open(browser, { unit: 'C' }); await shot(page, 'list-celsius'); await tapRoom(page, 3); await shot(page, 'room-celsius'); await page.close(); }
  } finally { await browser.close(); }
})();
