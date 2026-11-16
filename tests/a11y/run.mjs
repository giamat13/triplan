// Automated accessibility + smoke test for index.html.
//
// Serves the repo root on a local port, swaps the Firebase SDK for the
// in-memory mock in firebase-mock.js (so nothing touches a real project),
// seeds one sample trip, then:
//   1. runs axe-core (WCAG 2.1 A + AA) on each main tab and on the open
//      dialogs, at phone (390px) and desktop (1280px) width, in the light,
//      dark and high-contrast color themes;
//   2. clicks through the basic flows (add an activity, delete it and undo,
//      delete-day dialog with Esc and focus return, display settings, help,
//      arrow keys on the tabs);
//   3. saves a screenshot of every screen it checked.
// Exits with code 1 on any serious/critical axe violation, failed flow, or
// page error.
//
// Usage: npm install && node run.mjs [output-folder]

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT = path.resolve(process.argv[2] || process.env.OUT_DIR || path.join(HERE, 'out'));
fs.mkdirSync(OUT, { recursive: true });

const MOCK = fs.readFileSync(path.join(HERE, 'firebase-mock.js'), 'utf8');
const FAKE_CONFIG = `window.__FIREBASE_CONFIG__ = { apiKey: 'test-key', authDomain: 'test.local', projectId: 'demo-test', storageBucket: '', messagingSenderId: '', appId: 'test-app' };`;
// Third-party files the page needs to look right (fonts, map and PDF libraries).
const ALLOWED_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net'];

/* ---------------- sample trip ---------------- */
const UID = 'test-user-1';
const act = (id, time, title, category, extra = {}) => ({
  id, time, title, category, cuisine: '', transport: '', cost: '', link: '', notes: '', duration: '', priority: '',
  hours: '', booking: false, equipment: '', partySize: '', confirmation: '', mapQuery: '', sourceIdeaId: '', rating: '',
  aiBudgetDismissedCost: '', ...extra,
});
const hotel = (name, cost) => ({ name, link: '', cost, notes: '', breakfast: true, checkIn: '', checkOut: '' });
const idea = (id, nameHe, nameEn, category, duration, priority, extra = {}) => ({
  id, nameHe, nameEn, category, duration, priority, hours: '', price: '', booking: false, equipment: '', notes: '', link: '',
  cuisine: '', partySize: '', mapQuery: '', scheduled: false, rating: '', lat: null, lng: null, excluded: false,
  createdAt: 1767225600000, createdBy: UID, ...extra,
});
const SEED = {
  'users/test-user-1': { name: 'דנה' },
  'trips/trip1': {
    name: 'רומא באביב', startDate: '2027-04-12', currency: 'EUR', secondaryCurrency: 'ILS', budget: '3000',
    dayHourOverrides: {}, archived: false, members: { [UID]: 'owner' },
    codes: { owner: 'OWN123', editor: 'EDT456', viewer: 'VIE789' },
    days: [
      { id: 'd1', destination: 'רומא', currency: '', lastEditedBy: '', lastEditedAt: 0, hotel: hotel('Hotel Artemide', '180'), activities: [
        act('a1', '09:00', 'הקולוסיאום', 'sight', { cost: '24', transport: 'הליכה', booking: true }),
        act('a2', '13:00', 'ארוחת צהריים בטרסטוורה', 'food', { cost: '40', cuisine: 'איטלקי' }),
        act('a3', '16:30', 'מזרקת טרווי', 'sight'),
      ]},
      { id: 'd2', destination: 'הוותיקן', currency: '', lastEditedBy: '', lastEditedAt: 0, hotel: hotel('Hotel Artemide', '180'), activities: [
        act('a4', '08:30', 'מוזיאוני הוותיקן', 'sight', { cost: '25', booking: true }),
      ]},
    ],
    attractionIdeas: [
      idea('i1', 'גלריה בורגזה', 'Galleria Borghese', 'sight', '2 שעות', '8', { booking: true }),
      idea('i2', 'פנתאון', 'Pantheon', 'sight', 'שעה', '9'),
      idea('i3', 'גלידה בג׳וליטי', 'Giolitti', 'food', 'חצי שעה', '6'),
    ],
    dayGroups: [], documents: [],
  },
  'trips/trip1/packingLists/test-user-1': { items: [ { id: 'p1', text: 'מתאם חשמל', checked: false, dueDaysBefore: '' } ], videos: [] },
};

/* ---------------- static server ---------------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(ROOT, rel);
  if(!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){ res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/index.html`;

/* ---------------- browser ---------------- */
let browser;
try{ browser = await chromium.launch(); }
catch(e){ browser = await chromium.launch({ channel: 'msedge' }); }

const results = { axe: [], flows: [], pageErrors: [], consoleErrors: [] };

async function openApp({ width, theme, tab = 'days' }){
  const context = await browser.newContext({
    viewport: { width, height: width < 600 ? 844 : 900 },
    deviceScaleFactor: 1, locale: 'he-IL', serviceWorkers: 'block',
    colorScheme: 'light',
  });
  await context.addInitScript(({ seed, theme, tab }) => {
    globalThis.__fbSeed = seed;
    try{
      const comfort = theme === 'comfort';
      localStorage.setItem('triplan-display-v1', JSON.stringify({ textSize: 'normal', theme: comfort ? 'light' : theme, motion: 'reduce', comfort: comfort ? 'on' : 'off' }));
      localStorage.setItem('triplan-active-tab-v1', tab);
    }catch(e){}
  }, { seed: SEED, theme, tab });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if(url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/'))
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: MOCK });
    if((url.hostname === '127.0.0.1') && url.pathname.endsWith('/config.js'))
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_CONFIG });
    if(url.hostname === '127.0.0.1' || ALLOWED_HOSTS.includes(url.hostname)) return route.continue();
    return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const label = `${width}-${theme}`;
  page.on('pageerror', err => results.pageErrors.push(`[${label}] ${err.message}`));
  page.on('console', msg => {
    if(msg.type() !== 'error') return;
    const text = msg.text();
    // Aborted third-party requests (weather, geocoding, map tiles) are expected in the test.
    if(/ERR_FAILED|ERR_BLOCKED|Failed to load resource|net::/i.test(text)) return;
    results.consoleErrors.push(`[${label}] ${text}`);
  });
  await page.goto(BASE);
  await page.waitForSelector('.day-card', { timeout: 20000 });
  await page.waitForTimeout(400);
  return { context, page };
}

async function axeCheck(page, name, include){
  let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  if(include) builder = builder.include(include);
  const r = await builder.analyze();
  const serious = r.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
  results.axe.push({
    name, serious: serious.length, total: r.violations.length,
    violations: r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length,
      targets: v.nodes.slice(0, 6).map(n => n.target.join(' ') + (n.any[0] && n.any[0].data && n.any[0].data.fgColor ? ` [${n.any[0].data.fgColor} on ${n.any[0].data.bgColor} = ${n.any[0].data.contrastRatio}]` : '')) })),
  });
}
async function shot(page, name, fullPage = true){
  await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage });
}
async function flow(name, fn){
  try{ await fn(); results.flows.push({ name, ok: true }); }
  catch(e){
    const lines = e.message.split('\n');
    const blocker = lines.find(l => /intercepts pointer events|not visible|outside of the viewport/.test(l));
    results.flows.push({ name, ok: false, error: lines[0] + (blocker ? ' | ' + blocker.trim() : '') });
  }
}
function expect(cond, message){ if(!cond) throw new Error(message); }

/* ---------------- 1. axe on every tab, width and theme ---------------- */
const TABS = ['days', 'ideas', 'budget', 'packing'];
for(const width of [390, 1280]){
  for(const theme of ['light', 'contrast', 'comfort']){
    const { context, page } = await openApp({ width, theme });
    for(const tab of TABS){
      await page.evaluate(t => document.querySelector(`.tab-btn[data-tab="${t}"]`).click(), tab);
      await page.waitForTimeout(250);
      await axeCheck(page, `${width}-${theme}-${tab}`);
      if(theme === 'light' || tab === 'days') await shot(page, `${width}-${theme}-${tab}`, tab !== 'ideas');
    }
    await context.close();
  }
}

/* ---------------- 2. flows (desktop and phone, light theme) ---------------- */
for(const width of [1280, 390]){
  const { context, page } = await openApp({ width, theme: 'light' });
  const W = `[${width}] `;
  await shot(page, `${width}-first-screen`, false);
  await page.locator('.day-card:visible .activity').first().scrollIntoViewIfNeeded();
  await shot(page, `${width}-activity-closeup`, false);

  await flow(W + 'add an activity', async () => {
    const before = await page.locator('.day-card:visible .activity').count();
    await page.locator('.day-card:visible [data-role="add-activity"]').click();
    expect(await page.locator('.day-card:visible .activity').count() === before + 1, 'activity count did not grow');
  });

  await flow(W + 'delete an activity, then undo it', async () => {
    const before = await page.locator('.day-card:visible .activity').count();
    await page.locator('.day-card:visible [data-role="del-activity"]').first().click();
    expect(await page.locator('.day-card:visible .activity').count() === before - 1, 'activity was not removed');
    const undo = page.locator('.toast .toast-action');
    await undo.waitFor({ timeout: 3000 });
    await shot(page, `${width}-flow-undo-toast`, false);
    await undo.click();
    await page.waitForTimeout(300);
    expect(await page.locator('.day-card:visible .activity').count() === before, 'undo did not bring the activity back');
  });

  await flow(W + 'delete-day dialog: starts on "No", Esc closes, focus returns', async () => {
    const delBtn = page.locator('.day-card:visible [data-role="del-day"]');
    await delBtn.focus();
    await page.keyboard.press('Enter');
    const dlg = page.locator('[role="alertdialog"]');
    await dlg.waitFor({ timeout: 3000 });
    await axeCheck(page, `${width}-dialog-delete-day`);
    await shot(page, `${width}-dialog-delete-day`, false);
    const focused = await page.evaluate(() => document.activeElement && document.activeElement.textContent.trim());
    expect(focused === 'לא, להשאיר', `focus started on "${focused}" instead of "No"`);
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement.closest('[role="alertdialog"]')), 'Tab left the dialog');
    await page.keyboard.press('Escape');
    expect(await dlg.count() === 0, 'Esc did not close the dialog');
    expect(await page.evaluate(() => document.activeElement && document.activeElement.dataset.role === 'del-day'), 'focus did not return to the delete button');
    expect(await page.locator('.day-card').count() === 2, 'a day was deleted after Esc');
  });

  await flow(W + 'display settings change the text size and colors', async () => {
    await page.locator('#displaySettingsBtn').click();
    await page.locator('.ai-modal').waitFor();
    await axeCheck(page, `${width}-dialog-display`);
    await shot(page, `${width}-dialog-display`, false);
    await page.locator('input[name="textSize"][value="xlarge"]').check({ force: true });
    expect(await page.evaluate(() => document.documentElement.dataset.textSize) === 'xlarge', 'text size was not applied');
    await page.locator('input[name="theme"][value="contrast"]').check({ force: true });
    expect(await page.evaluate(() => document.documentElement.dataset.theme) === 'contrast', 'theme was not applied');
    await page.locator('#displayDone').click();
    await page.waitForTimeout(200);
    await axeCheck(page, `${width}-xlarge-contrast-days`);
    await shot(page, `${width}-xlarge-contrast-days`);
    await page.evaluate(() => window.triplanDisplay.set({ textSize: 'normal', theme: 'light' }));
  });

  await flow(W + 'help opens with "?" and closes with Esc', async () => {
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('?');
    const title = page.locator('#aiModalTitle');
    await title.waitFor({ timeout: 3000 });
    expect((await title.textContent()).includes('עזרה'), 'help title missing');
    await axeCheck(page, `${width}-dialog-help`);
    await shot(page, `${width}-dialog-help`, false);
    await page.keyboard.press('Escape');
    expect(await page.locator('.ai-modal').count() === 0, 'help did not close');
  });

  await flow(W + 'arrow keys move between tabs', async () => {
    await page.locator('.tab-btn.active').focus();
    await page.keyboard.press('ArrowLeft');
    const active = await page.evaluate(() => document.querySelector('.tab-btn.active').dataset.tab);
    expect(active === 'ideas', `ArrowLeft went to "${active}" instead of "ideas"`);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Home');
  });

  await flow(W + 'empty lists offer the next step', async () => {
    await page.evaluate(() => document.querySelector('.tab-btn[data-tab="budget"]').click());
    await page.waitForTimeout(200);
    const btn = page.locator('#documentsBody .empty-action');
    expect(await btn.count() === 1, 'no button in the empty documents list');
  });

  await context.close();
}

await browser.close();
server.close();

/* ---------------- report ---------------- */
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
const seriousRuns = results.axe.filter(a => a.serious);
const failed = results.flows.filter(f => !f.ok);
const ruleCount = {};
for(const a of results.axe) for(const v of a.violations) ruleCount[`${v.impact} ${v.id}`] = (ruleCount[`${v.impact} ${v.id}`] || 0) + 1;
console.log(`axe: ${results.axe.length} screens checked, ${seriousRuns.length} with serious/critical problems`);
for(const [k, n] of Object.entries(ruleCount)) console.log(`  ${k}: on ${n} screens`);
console.log(`flows: ${results.flows.length - failed.length}/${results.flows.length} passed`);
for(const f of failed) console.log(`  FAIL ${f.name}: ${f.error}`);
console.log(`page errors: ${results.pageErrors.length}`);
for(const e of results.pageErrors.slice(0, 10)) console.log('  ' + e);
console.log(`console errors: ${results.consoleErrors.length}`);
for(const e of [...new Set(results.consoleErrors)].slice(0, 10)) console.log('  ' + e);
console.log(`screenshots and results.json: ${OUT}`);
process.exit(seriousRuns.length || failed.length || results.pageErrors.length ? 1 : 0);
