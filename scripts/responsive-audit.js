// RESPONSIVE AUDIT — the check behind docs/responsive.md.
//
// Renders every page at ten real device widths and fails the things a person
// notices: the page scrolling sideways, a card past the right edge, a control
// too small for a fingertip, text below the 12px reading floor. Charts and
// scaled mocks opt out by ancestor ([data-chart], [data-scaled-preview]) —
// a 5px bar in a bar chart is a data mark, not a button.
//
// Screenshots land beside the report, which makes it a before/after tool as
// well as a gate: run it, change something, run it again into another folder.
//   BASE=http://localhost:3000 node scripts/responsive-audit.js shots/after after
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = process.argv[2];
const LABEL = process.argv[3] || 'before';
const BASE = process.env.BASE || 'http://localhost:3000';
// A session for the run. Point AUTH_FILE at a JSON blob shaped like the
// `authUser` the login page stores (POST /auth/employee-login returns it), so
// the audit never types a password:
//   curl -s -XPOST "$API/auth/employee-login" -H 'content-type: application/json' \
//     -d '{"employeeUsername":"...","password":"...","restaurantName":"..."}' > auth.json
//   AUTH_FILE=auth.json BASE=http://localhost:3000 node scripts/responsive-audit.js out
const AUTH = JSON.parse(fs.readFileSync(process.env.AUTH_FILE || path.join(__dirname, 'authuser.json'), 'utf8'));

// The five categories the brief names, plus the two edges of each.
const DEVICES = [
  { name: '01-small-mobile-320', w: 320, h: 640, touch: true },   // legacy / compact
  { name: '02-mobile-390',       w: 390, h: 844, touch: true },   // iPhone 14/15
  { name: '03-mobile-412',       w: 412, h: 915, touch: true },   // Pixel 8
  { name: '04-fold-closed-344',  w: 344, h: 882, touch: true },   // Galaxy Z Fold cover
  { name: '05-fold-open-717',    w: 717, h: 812, touch: true },   // Galaxy Z Fold unfolded
  { name: '06-tablet-768',       w: 768, h: 1024, touch: true },  // iPad portrait
  { name: '07-tablet-820',       w: 820, h: 1180, touch: true },  // iPad Air portrait
  { name: '08-tablet-land-1024', w: 1024, h: 768, touch: true },  // iPad landscape
  { name: '09-laptop-1280',      w: 1280, h: 800, touch: false },
  { name: '10-desktop-1440',     w: 1440, h: 900, touch: false },
];

const PAGES = [
  { name: 'overview',   url: '/dashboard' },
  { name: 'tables',     url: '/dashboard/tables' },
  { name: 'orders',     url: '/dashboard/orders' },
  { name: 'accounting', url: '/dashboard/accounting' },
  { name: 'analytics',  url: '/dashboard/analytics' },
  { name: 'menu',       url: '/dashboard/menu' },
];

const MEASURE = () => {
  const vw = window.innerWidth;
  const doc = document.scrollingElement;
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  // Something sticking past the right edge that ISN'T inside a deliberate
  // horizontal scroller (tables are allowed to scroll sideways) is a bug.
  const bleeding = [...document.querySelectorAll('main *')].filter((el) => {
    if (!vis(el)) return false;
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' || cs.overflowX === 'auto' || cs.overflowX === 'scroll') return false;
    if (el.closest('[class*="overflow-x-auto"],[class*="overflow-auto"],table')) return false;
    const r = el.getBoundingClientRect();
    return r.right > vw + 1 || r.left < -1;
  });
  const seen = new Set();
  const worst = bleeding.map((el) => {
    const r = el.getBoundingClientRect();
    const cls = typeof el.className === 'string' ? el.className : (el.className?.baseVal ?? '');
    return { tag: el.tagName.toLowerCase(), cls: cls.slice(0, 70), w: Math.round(r.width), right: Math.round(r.right), text: (el.textContent || '').trim().slice(0, 40) };
  }).filter((o) => { const k = o.cls + o.w; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 5);

  // A chart's 5px column and a scaled phone mock are pictures, not controls:
  // widening them would redraw the chart and rescale the mock.
  const exempt = (el) => el.closest('[data-chart],[data-scaled-preview]') !== null;
  const targets = [...document.querySelectorAll('main button, main a[href], main [role="button"], main select, main input:not([type="hidden"])')].filter(vis).filter((el) => !exempt(el));
  const under44 = targets.filter((el) => { const r = el.getBoundingClientRect(); return r.height < 44 || r.width < 44; });
  const under32 = targets.filter((el) => { const r = el.getBoundingClientRect(); return r.height < 32; });

  let tinyText = 0;
  [...document.querySelectorAll('main p, main span, main td, main li, main button, main h1, main h2, main h3')].forEach((el) => {
    if (!vis(el) || !el.textContent.trim() || el.closest('[data-chart],[data-scaled-preview]')) return;
    if (parseFloat(getComputedStyle(el).fontSize) < 12) tinyText += 1;
  });

  return {
    vw,
    sidewaysScrollPx: Math.max(0, doc.scrollWidth - vw),
    bleeding: bleeding.length,
    worst,
    targets: targets.length,
    under44: under44.length,
    under32: under32.length,
    tinyText,
  };
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const report = [];
  for (const d of DEVICES) {
    const ctx = await browser.newContext({
      viewport: { width: d.w, height: d.h },
      deviceScaleFactor: 2,
      isMobile: d.touch,
      hasTouch: d.touch,
    });
    await ctx.addCookies([{ name: 'authUser', value: encodeURIComponent(JSON.stringify(AUTH)), url: BASE }]);
    await ctx.addInitScript((u) => { try { localStorage.setItem('authUser', JSON.stringify(u)); } catch {} }, AUTH);
    const page = await ctx.newPage();
    for (const p of PAGES) {
      try {
        await page.goto(BASE + p.url, { waitUntil: 'networkidle', timeout: 45000 });
      } catch { /* networkidle can time out on polling pages; carry on */ }
      await page.waitForTimeout(2500);
      let m;
      try { m = await page.evaluate(MEASURE); } catch (e) { m = { error: String(e).slice(0, 120) }; }
      report.push({ device: d.name, width: d.w, page: p.name, ...m });
      const file = path.join(OUT, `${p.name}__${d.name}__${LABEL}.png`);
      try { await page.screenshot({ path: file }); } catch {}
      process.stdout.write(`${d.name} ${p.name}: scroll=${m.sidewaysScrollPx ?? '?'} bleeding=${m.bleeding ?? '?'} under44=${m.under44 ?? '?'}/${m.targets ?? '?'} tiny=${m.tinyText ?? '?'}\n`);
    }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, `report-${LABEL}.json`), JSON.stringify(report, null, 2));
  console.log('\nwrote', path.join(OUT, `report-${LABEL}.json`));
})();
