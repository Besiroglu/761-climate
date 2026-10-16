// Render the home-screen icon (docs/icon-180.png) from an SVG with headless Chrome.
const puppeteer = require('puppeteer-core'), path = require('path');
const html = `<html><body style="margin:0"><div style="width:180px;height:180px;background:linear-gradient(180deg,#ffffff,#f1f1f4);display:grid;place-items:center">
<svg width="132" height="132" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#3a8dff"/><stop offset="1" stop-color="#ff8a3d"/></linearGradient></defs>
<path d="M24.5 75.5A36 36 0 1 1 75.5 75.5" fill="none" stroke="url(#g)" stroke-width="9" stroke-linecap="round"/>
<circle cx="50" cy="14" r="6.8" fill="#fff" style="filter:drop-shadow(0 .6px 1.2px rgba(0,0,0,.25))"/>
<text x="50" y="60" text-anchor="middle" font-family="-apple-system,Helvetica Neue,sans-serif" font-size="21" font-weight="600" fill="#1c1c1e" letter-spacing=".5">761</text></svg></div></body></html>`;
(async () => {
  const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
  const p = await b.newPage(); await p.setViewport({ width: 180, height: 180, deviceScaleFactor: 1 });
  await p.setContent(html); await p.screenshot({ path: path.join(__dirname, '..', 'docs', 'icon-180.png') });
  await p.setViewport({ width: 180, height: 180, deviceScaleFactor: 3 }); await p.setContent(html); await p.screenshot({ path: path.join(__dirname, 'shots', 'icon-preview.png') });
  await b.close(); console.log('icon ok');
})();
