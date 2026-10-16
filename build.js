// Assemble the app: src/app.html + src/core.js + src/rooms.json (+ src/admin.js for the admin page) -> build/ (plaintext,
// gitignored, contains the Messana key) . build.sh then encrypts build/ into docs/ for GitHub Pages.
// Usage: MESSANA_KEY=... node build.js [--test]   (--test: fake key, for the screenshot harness)
const fs = require('fs'), path = require('path');
const test = process.argv.includes('--test');
const key = test ? 'TEST' : process.env.MESSANA_KEY;
if (!key) { console.error('MESSANA_KEY not set'); process.exit(1); }
const src = f => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
const cfg = JSON.parse(src('rooms.json'));
function page(admin) {
  return src('app.html')
    .replace('/*CORE*/', () => src('core.js'))
    .replace('/*CONFIG*/null', () => JSON.stringify(cfg))
    .replace('/*KEY*/', () => key)
    .replace('/*ADMIN*/false', admin ? 'true' : 'false')
    .replace('/*BASE*/undefined', 'undefined')
    .replace('/*ADMINJS*/', () => admin ? src('admin.js') : '');
}
const out = path.join(__dirname, test ? 'test/build' : 'build');
fs.mkdirSync(path.join(out, 'admin'), { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), page(false));
fs.writeFileSync(path.join(out, 'admin', 'index.html'), page(true));
console.log('built', out);
