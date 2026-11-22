import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const BASE = 'https://sites.google.com/view/yshayakawa/';

// Runs inside the page: converts the rendered Google Sites page to Markdown.
function extractInPage() {
  const unwrap = (h) => {
    try {
      const u = new URL(h, location.href);
      if (u.hostname.endsWith('google.com') && u.pathname === '/url' && u.searchParams.get('q')) return u.searchParams.get('q');
      return u.href;
    } catch (e) { return h; }
  };
  const depth = (n) => { let d = 0; for (let p = n.parentElement; p; p = p.parentElement) { if (p.tagName === 'UL' || p.tagName === 'OL') d++; } return d; };
  const walk = (n) => {
    if (n.nodeType === 3) return n.textContent.replace(/\s+/g, ' ');
    if (n.nodeType !== 1) return '';
    const t = n.tagName.toUpperCase();
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'BUTTON', 'HEADER', 'FOOTER', 'NAV'].includes(t)) return '';
    const role = n.getAttribute('role');
    if (role === 'navigation' || role === 'banner' || role === 'contentinfo') return '';
    let inner = '';
    for (const c of n.childNodes) inner += walk(c);
    if (t === 'A') {
      const h = n.getAttribute('href');
      const txt = inner.trim().replace(/\s*\n\s*/g, ' ');
      if (!h || !txt || h.startsWith('#')) return inner;
      return '[' + txt + '](' + unwrap(h) + ')';
    }
    if (t === 'IMG') return '![' + (n.alt || '').replace(/[\[\]\s]+/g, ' ').trim().slice(0, 80) + '](' + (n.currentSrc || n.src) + ')';
    if (t === 'BR') return '\n';
    if (/^H[1-6]$/.test(t)) return '\n\n' + '#'.repeat(Number(t[1])) + ' ' + inner.trim().replace(/\s*\n\s*/g, ' ') + '\n\n';
    if (t === 'LI') return '\n' + '  '.repeat(Math.max(0, depth(n) - 1)) + '- ' + inner.trim();
    if (t === 'UL' || t === 'OL') return '\n' + inner + '\n';
    if (t === 'P') return '\n\n' + inner.trim() + '\n\n';
    if (t === 'DIV' || t === 'SECTION') return '\n' + inner + '\n';
    return inner;
  };
  return walk(document.body)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+(?=[^ \t-])/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

fs.mkdirSync('_raw', { recursive: true });
fs.mkdirSync('assets/img', { recursive: true });

// Legacy Dropbox files: scripts/dropbox-manifest.json = [{ url, dest }] (single-use temporary links).
// A file that already exists is kept; a failed/expired link is only logged.
const MANIFEST = 'scripts/dropbox-manifest.json';
if (fs.existsSync(MANIFEST)) {
  const items = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  for (const it of items) {
    try {
      if (fs.existsSync(it.dest)) { console.log('dropbox exists', it.dest); continue; }
      const res = await fetch(it.url);
      if (!res.ok) { console.log('dropbox HTTP', res.status, it.dest); continue; }
      fs.mkdirSync(path.dirname(it.dest), { recursive: true });
      fs.writeFileSync(it.dest, Buffer.from(await res.arrayBuffer()));
      console.log('dropbox saved', it.dest);
    } catch (e) { console.log('dropbox failed', it.dest, e.message.slice(0, 80)); }
  }
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ja-JP' });
const page = await ctx.newPage();

async function grab(slug) {
  await page.goto(BASE + slug, { waitUntil: 'load', timeout: 90000 });
  await page.waitForTimeout(4000);
  const md = await page.evaluate(extractInPage);
  fs.writeFileSync('_raw/' + slug.replace(/\//g, '__') + '.md', md);
  console.log('grabbed', slug, md.length);
  return md;
}

const imgMap = new Map();
async function localize(md) {
  const re = /!\[([^\]]*)\]\((https:[^)\s]+)\)/g;
  const urls = [...new Set([...md.matchAll(re)].map((m) => m[2]))];
  for (const u of urls) {
    if (imgMap.has(u)) continue;
    try {
      const res = await ctx.request.get(u, { timeout: 60000 });
      if (res.ok()) {
        const ct = res.headers()['content-type'] || '';
        const ext = ct.includes('png') ? 'png' : ct.includes('gif') ? 'gif' : ct.includes('webp') ? 'webp' : ct.includes('svg') ? 'svg' : 'jpg';
        const name = crypto.createHash('sha1').update(u).digest('hex').slice(0, 12) + '.' + ext;
        fs.writeFileSync('assets/img/' + name, await res.body());
        imgMap.set(u, '/assets/img/' + name);
      } else {
        console.log('image HTTP', res.status(), u.slice(0, 80));
        imgMap.set(u, null);
      }
    } catch (e) {
      console.log('image failed', e.message.slice(0, 80));
      imgMap.set(u, null);
    }
  }
  return md.replace(re, (m, alt, u) => (imgMap.get(u) ? '![' + alt + '](' + imgMap.get(u) + ')' : ''));
}

const LINKMAP = {
  '': '/', home: '/', about: '/about/', 'lab-members': '/lab-members/',
  education: '/education/', 'education/lectures': '/education/#lectures', 'education/theses': '/education/#theses',
  research: '/research/', 'research/topics': '/research/#topics',
  'research/topics/bedrock-rivers': '/research/#bedrock-rivers',
  'research/topics/hdt': '/research/#high-definition-topography',
  'research/topics/geoarchaeology': '/research/#geoarchaeology',
  'research/grants': '/research/#grants', 'research/reviews': '/research/#reviews',
  publications: '/publications/', 'publications/journal': '/publications/#journal',
  'publications/presentations': '/publications/#presentations', 'publications/books': '/publications/#books',
  'publications/other-publications': '/publications/#other',
  photographs: '/photographs/', misc: '/misc/',
};
function rewriteLinks(md) {
  return md.replace(/https:\/\/sites\.google\.com\/view\/yshayakawa\/?([a-z0-9\-\/]*)(?:\?[^)#\s]*)?(#[^)\s]*)?/g, (m, p, hash) => {
    const key = p.replace(/\/$/, '');
    if (key === 'home' && hash) return '/contact/';
    return key in LINKMAP ? LINKMAP[key] : m;
  });
}

const fm = (title, permalink) => '---\nlayout: default\ntitle: ' + title + '\npermalink: ' + permalink + '\n---\n\n';
// Google Sites footer ("Google サイト / 不正使用を報告") and empty list items ("-" alone would turn the previous line into a setext h2).
const FOOTER = /\n*Google (?:サイト|Sites)\s*\n+\s*(?:不正使用を報告|Report abuse)\s*$/;
const strip = (md) => md.replace(FOOTER, '').replace(/^[ \t]*-[ \t]*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
const dropH1 = (md) => md.replace(/^# .*\n+/, '');
const clean = (md) => dropH1(strip(md)).trim();
const demote = (md, k) => md.replace(/^(#{1,6}) /gm, (m, h) => '#'.repeat(Math.min(6, h.length + k)) + ' ');
const sec = (title, id, level, md) => '#'.repeat(level) + ' ' + title + ' {#' + id + '}\n\n' + md.trim() + '\n\n';

async function emit(file, title, permalink, body) {
  if (!body.trim()) { console.log('skip (empty)', file); return; }
  body = rewriteLinks(await localize(body));
  body = body.replace(/^\s*Google (?:サイト|Sites)\s*$/gm, '').replace(/^\s*(?:不正使用を報告|Report abuse)\s*$/gm, '').replace(/\n{3,}/g, '\n\n');
  fs.writeFileSync(file, fm(title, permalink) + body.trim() + '\n');
  console.log('wrote', file, body.length);
}

const slugs = [
  'home', 'about', 'lab-members', 'education', 'education/lectures', 'education/theses',
  'research', 'research/topics/bedrock-rivers', 'research/topics/hdt', 'research/topics/geoarchaeology',
  'research/grants', 'research/reviews',
  'publications/journal', 'publications/presentations', 'publications/books', 'publications/other-publications',
  'photographs', 'misc',
];
const g = {};
for (const s of slugs) {
  try { g[s] = await grab(s); } catch (e) { console.log('FAILED', s, e.message); g[s] = ''; }
}

// about / lab members / photographs
await emit('about.md', 'about', '/about/', clean(g['about']));
await emit('lab-members.md', 'lab members', '/lab-members/', clean(g['lab-members']));
await emit('photographs.md', 'photographs', '/photographs/', clean(g['photographs']));

// education / outreach (outreach = first part of the Google Sites misc page)
const e0 = clean(g['education']);
const iImg = e0.indexOf('[![');
const iPot = e0.search(/^### potential topics/m);
const eduIntro = (iImg >= 0 ? e0.slice(0, iImg) : (iPot >= 0 ? e0.slice(0, iPot) : e0)).trim();
const eduTopics = iPot >= 0 ? e0.slice(iPot).replace(/^### /gm, '## ') : '';
const miscParts = g['misc'].split(/^## Links/m);
const outreach = strip(miscParts[0].replace(/^# .*\n+/, ''));
const miscRest = miscParts.length > 1 ? '## Links' + miscParts[1] : '';
let edu = eduIntro + '\n\n';
edu += sec('lectures', 'lectures', 2, demote(clean(g['education/lectures']), 1));
edu += sec('thesis reviews', 'theses', 2, demote(clean(g['education/theses']), 1));
if (eduTopics) edu += eduTopics + '\n\n';
edu += sec('outreach', 'outreach', 2, demote(outreach, 1));
await emit('education.md', 'education/outreach', '/education/', edu);

// misc (links, blogs, old sites)
await emit('misc.md', 'misc', '/misc/', strip(miscRest));

// research
const r0 = g['research'];
const m = r0.search(/^#+ overview of my research.*$/im);
const overview = m >= 0 ? strip(r0.slice(m).replace(/^#+ .*\n+/, '')).trim() : '';
let res = sec('overview', 'overview', 2, overview);
res += '## topics {#topics}\n\n';
res += sec('bedrock rivers', 'bedrock-rivers', 3, demote(clean(g['research/topics/bedrock-rivers']), 2));
res += sec('high-definition topography', 'high-definition-topography', 3, demote(clean(g['research/topics/hdt']), 2));
res += sec('geoarchaeology', 'geoarchaeology', 3, demote(clean(g['research/topics/geoarchaeology']), 2));
res += sec('grants', 'grants', 2, demote(clean(g['research/grants']), 1));
res += sec('reviews', 'reviews', 2, demote(clean(g['research/reviews']), 1));
await emit('research.md', 'research', '/research/', res);

// publications
let pub = '';
pub += sec('journal articles / book chapters', 'journal', 2, demote(clean(g['publications/journal']), 1));
pub += sec('presentations', 'presentations', 2, demote(clean(g['publications/presentations']), 1));
pub += sec('books', 'books', 2, demote(clean(g['publications/books']), 1));
pub += sec('other publications', 'other', 2, demote(clean(g['publications/other-publications']), 1));
await emit('publications.md', 'publications', '/publications/', pub);

await browser.close();
