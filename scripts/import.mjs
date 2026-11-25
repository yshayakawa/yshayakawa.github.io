import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

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
  publications: '/publications/', 'publications/journal': '/publications/journal/',
  'publications/presentations': '/publications/presentations/', 'publications/books': '/publications/',
  'publications/other-publications': '/publications/other/',
  photographs: '/photographs/', misc: '/misc/',
};
// pre = '/jp' or '/en' (home '/' stays language-neutral)
function rewriteLinks(md, pre) {
  return md.replace(/https:\/\/sites\.google\.com\/view\/yshayakawa\/?([a-z0-9\-\/]*)(?:\?[^)#\s]*)?(#[^)\s]*)?/g, (m, p, hash) => {
    const key = p.replace(/\/$/, '');
    if (key === 'home' && hash) return pre + '/contact/';
    if (!(key in LINKMAP)) return m;
    return LINKMAP[key] === '/' ? '/' : pre + LINKMAP[key];
  }).replace(/\]\(\/contact\/\)/g, '](' + pre + '/contact/)');
}

// ---- JP / EN split -------------------------------------------------------
// A page is "paired" when it has both Japanese-headed and English-headed H2 sections
// (e.g. "professional experience" / "職歴"). Then /jp/ gets the Japanese sections and
// /en/ the English ones; neutral sections and the lead go to both. Pages without such
// pairs are copied as they are to both languages. An English-headed section that mixes
// pure-Japanese and pure-English blocks (e.g. lab members) is kept on both sides and its
// blocks are split by language.
const CJK = /[぀-ヿ㐀-鿿]/;
const CJKG = /[぀-ヿ㐀-鿿]/g;
const plain = (s) => s.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\]\([^)]*\)/g, ']').replace(/https?:\/\/\S+/g, '').replace(/[#*>|\-\[\]_]/g, ' ');
function kind(s) {
  const t = plain(s);
  const j = CJK.test(t), e = /[A-Za-z]{3,}/.test(t);
  return j && !e ? 'ja' : e && !j ? 'en' : j && e ? 'mix' : 'none';
}
const headKind = (line) => (CJK.test(line) ? 'ja' : /[A-Za-z]/.test(line) ? 'en' : 'none');
const HEADJP = { 'current Members': '現メンバー' };
const bodyKinds = (sec) => sec.split(/\n{2,}/).slice(1).map(kind);
const isMixed = (sec) => { const ks = bodyKinds(sec); return ks.includes('ja') && ks.includes('en'); };
function blockFilter(sec, lang) {
  const blocks = sec.split(/\n{2,}/);
  const drop = lang === 'jp' ? 'en' : 'ja';
  let out = blocks.filter((b, i) => i === 0 || kind(b) !== drop).join('\n\n') + '\n\n';
  if (lang === 'jp') out = out.replace(/^## (.*)$/m, (m, h) => '## ' + (HEADJP[h.trim()] || h));
  return out;
}
function forLang(md, lang) {
  const parts = md.split(/^(?=## )/m).map((p) => ({ p, h: p.startsWith('## ') ? headKind(p.split('\n')[0]) : null }));
  if (!(parts.some((x) => x.h === 'ja') && parts.some((x) => x.h === 'en'))) return md;
  const other = lang === 'jp' ? 'en' : 'ja';
  return parts
    .filter((x) => x.h !== other || (x.h === 'en' && isMixed(x.p)))
    .map((x) => (x.h === 'en' && isMixed(x.p) ? blockFilter(x.p, lang) : x.p))
    .join('');
}

// ---- publications: one language per entry, serial numbers ---------------------
// Entries are "Japanese citation [English citation] ...". The JP page keeps the Japanese part,
// the EN page the English one; entries without a translation are shown as they are.
function bracketGroups(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '[') continue;
    let d = 0, j = i;
    for (; j < s.length; j++) { if (s[j] === '[') d++; else if (s[j] === ']') { d--; if (d === 0) break; } }
    if (j >= s.length) break;
    if (s[j + 1] === '(') {
      let p = 0, k = j + 1;
      for (; k < s.length; k++) { if (s[k] === '(') p++; else if (s[k] === ')') { p--; if (p === 0) break; } }
      i = k;
    } else { out.push({ start: i, end: j + 1, inner: s.slice(i + 1, j) }); i = j; }
  }
  return out;
}
function isTrans(inner) {
  const t = inner.replace(/\]\([^)]*\)/g, ']').trim();
  const latin = (t.match(/[A-Za-z]/g) || []).length;
  const cjk = (t.match(CJKG) || []).length;
  return latin >= 40 && cjk <= latin * 0.15 && /^[A-Z][A-Za-z'’\-]+,\s*[A-Z]/.test(t);
}
function splitEntry(s, lang) {
  const g = bracketGroups(s).find((x) => isTrans(x.inner));
  if (!g) return s;
  const head = s.slice(0, g.start), tail = s.slice(g.end);
  if (!CJK.test(head)) return s;
  if (lang === 'jp') return (head.trimEnd() + ' ' + tail.trimStart()).trim();
  const t = tail.replace(/\[[^\[\]]*[぀-ヿ㐀-鿿][^\[\]]*\](?!\()/g, '').replace(/【招待講演】/g, '(invited)');
  return (g.inner.trim() + ' ' + t.trim()).trim();
}
const HJP = {
  'Refereed articles': '査読付き論文', 'Other articles': 'その他の論文', 'in press': '受理済・印刷中',
  '2010 and before': '2010年以前', '2020 and before': '2020年以前',
  'Academic Conferences (as presenter)': '学会発表（発表者）', 'Academic Conferences (as co-author)': '学会発表（共著者）',
  'Other talks': 'その他の講演', 'Columns, Journal Frontpages, etc.': 'コラム・表紙など', 'Dissertations': '学位論文',
};
const HEN = { '博士論文': 'PhD thesis', '修士論文': "Master's thesis", '卒業論文': "Bachelor's thesis" };
const mapHead = (line, lang) => {
  const m = line.match(/^(#{1,6}) (.*)$/);
  if (!m) return line;
  const t = m[2].trim();
  return m[1] + ' ' + ((lang === 'jp' ? HJP : HEN)[t] || t);
};
const isItem = (l) => /^- /.test(l);
const isPlaceholder = (t) => /^[.…\s]*$/.test(t);
const countItems = (md) => md.split('\n').filter((l) => isItem(l) && !isPlaceholder(l.slice(2))).length;
let pubReport = '';
function finishPub(md, lang, slug) {
  const out = [];
  let n = 0, changed = 0;
  const samples = [];
  for (const line of md.split('\n')) {
    if (isItem(line)) {
      const t = line.slice(2).trim();
      if (isPlaceholder(t)) continue;
      n++;
      const jp = splitEntry(t, 'jp'), en = splitEntry(t, 'en');
      if (jp !== t || en !== t) { changed++; if (samples.length < 3) samples.push('- JP: ' + jp.slice(0, 160) + '\n  EN: ' + en.slice(0, 160)); }
      out.push('- ' + (lang === 'jp' ? jp : en));
      continue;
    }
    if (/^#{1,6} /.test(line)) { out.push(mapHead(line, lang)); continue; }
    const tl = line.trim();
    if (tl === '') { out.push(''); continue; }
    if (tl === '---' || tl === '(' || tl === ')') continue;
    if (lang === 'en' && tl === '学会発表など') continue;
    const pm = tl.match(/^（([^）]*)）$/);
    if (pm && CJK.test(pm[1])) {
      if (lang === 'jp') {
        let k = out.length - 1;
        while (k >= 0 && out[k] === '') k--;
        if (k >= 0 && !/^[#-]/.test(out[k])) { const pre = out[k].match(/^(.*?\)\s*:\s*)/); out[k] = (pre ? pre[1] : '') + pm[1]; } else out.push(pm[1]);
      }
      continue;
    }
    const im = tl.match(/^(.*?\)\s*:\s*)(.*?)\s*（([^）]*)）\s*$/);
    if (im && CJK.test(im[3]) && !CJK.test(im[2])) { out.push(im[1] + (lang === 'jp' ? im[3] : im[2])); continue; }
    out.push(line);
  }
  // serial numbers per H2 group: the newest entry (top) gets the largest number
  const total = {};
  let g = 0;
  for (const l of out) { if (/^#{1,2} /.test(l)) g++; if (isItem(l)) total[g] = (total[g] || 0) + 1; }
  const left = { ...total };
  g = 0;
  const res = [];
  let last = -1;
  const closeRun = () => { if (last >= 0) { res.splice(last + 1, 0, '{: .numlist}'); last = -1; } };
  for (const l of out) {
    if (/^#{1,2} /.test(l)) g++;
    if (isItem(l)) { res.push('- <span class="no">' + left[g]-- + '</span> ' + l.slice(2)); last = res.length - 1; continue; }
    if (l.trim() !== '') closeRun();
    res.push(l);
  }
  closeRun();
  // drop year headings that have no entries
  const fin = [];
  for (let i = 0; i < res.length; i++) {
    if (/^### /.test(res[i])) {
      let j = i + 1;
      while (j < res.length && res[j].trim() === '') j++;
      if (j >= res.length || /^#{1,3} /.test(res[j])) continue;
    }
    fin.push(res[i]);
  }
  if (lang === 'jp') pubReport += '\n## ' + slug + ': ' + n + ' items, ' + changed + ' with a translation\n' + samples.join('\n') + '\n';
  return fin.join('\n').replace(/\n{3,}/g, '\n\n');
}

// photographs: thumbnails in a grid (albums, then the dated archive)
function photoGrid(md) {
  const [pre, ...rest] = md.split(/^## archive\s*$/im);
  if (!rest.length) return md;
  const toBlocks = (s) => s.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const isImg = (b) => /^\[?!\[[^\]]*\]\([^)]*\)/.test(b);
  const card = (parts) => '<div class="pcard" markdown="1">\n\n' + parts.join('\n\n') + '\n\n</div>\n\n';
  let out = '## albums\n\n<div class="pgrid" markdown="1">\n\n';
  for (const b of toBlocks(pre.replace(/^## albums\s*$/im, ''))) {
    const m = b.match(/^\[!\[([^\]]*)\]\([^)]*\)\]\(([^)]*)\)/);
    out += card(m && m[1] ? [b, '[' + m[1] + '](' + m[2] + ')'] : [b]);
  }
  out += '</div>\n\n';
  const cards = [];
  for (const b of toBlocks(rest.join(''))) {
    if (isImg(b)) cards.push([b]);
    else if (cards.length) cards[cards.length - 1].push(b.replace(/^#{1,6} (.*)$/, '**$1**'));
  }
  out += '## archive\n\n<div class="pgrid" markdown="1">\n\n' + cards.map(card).join('') + '</div>\n';
  return out;
}

const fm = (title, permalink, lang, pageClass) => '---\nlayout: default\ntitle: ' + title + '\npermalink: ' + permalink + '\nlang: ' + (lang === 'jp' ? 'ja' : 'en') + '\nlang_dir: ' + lang + '\n' + (pageClass ? 'page_class: ' + pageClass + '\n' : '') + '---\n\n';
// Google Sites footer ("Google サイト / 不正使用を報告") and empty list items ("-" alone would turn the previous line into a setext h2).
const FOOTER = /\n*Google (?:サイト|Sites)\s*\n+\s*(?:不正使用を報告|Report abuse)\s*$/;
const strip = (md) => md.replace(FOOTER, '').replace(/^[ \t]*-[ \t]*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
const dropH1 = (md) => md.replace(/^# .*\n+/, '');
const clean = (md) => dropH1(strip(md)).trim();
const demote = (md, k) => md.replace(/^(#{1,6}) /gm, (m, h) => '#'.repeat(Math.min(6, h.length + k)) + ' ');
const sec = (title, id, level, md) => '#'.repeat(level) + ' ' + title + ' {#' + id + '}\n\n' + md.trim() + '\n\n';

// writes jp/<slug>.md and en/<slug>.md
async function emit(slug, title, body, opts = {}) {
  if (!body.trim()) { console.log('skip (empty)', slug); return; }
  body = await localize(body);
  body = body.replace(/^\s*Google (?:サイト|Sites)\s*$/gm, '').replace(/^\s*(?:不正使用を報告|Report abuse)\s*$/gm, '').replace(/\n{3,}/g, '\n\n');
  if (opts.transform) body = opts.transform(body);
  for (const lang of ['jp', 'en']) {
    let b = forLang(body, lang);
    if (opts.perLang) b = opts.perLang(b, lang, slug);
    b = rewriteLinks(b, '/' + lang);
    const file = lang + '/' + slug + '.md';
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, fm(title, '/' + lang + '/' + slug + '/', lang, opts.pageClass) + b.trim() + '\n');
    console.log('wrote', file, b.length);
  }
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
await emit('about', 'about', clean(g['about']));
await emit('lab-members', 'lab members', clean(g['lab-members']), { transform: (md) => md.replace(/\]\(\/\)/g, '](/contact/)') });
await emit('photographs', 'photographs', clean(g['photographs']), { transform: photoGrid });

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
await emit('education', 'education/outreach', edu);

// misc (links, blogs, old sites)
await emit('misc', 'misc', strip(miscRest));

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
await emit('research', 'research', res);

// publications: one page per type + an index page
const pubs = [
  { slug: 'journal', title: 'journal articles / book chapters', ja: '論文・書籍の章', md: clean(g['publications/journal']) },
  { slug: 'presentations', title: 'presentations', ja: '学会発表・講演', md: clean(g['publications/presentations']) },
  { slug: 'books', title: 'books', ja: '書籍', md: clean(g['publications/books']) },
  { slug: 'other', title: 'other publications', ja: 'その他の出版物（コラム・学位論文など）', md: clean(g['publications/other-publications']) },
].filter((p) => p.md.trim());
for (const p of pubs) {
  p.count = countItems(p.md);
  await emit('publications/' + p.slug, p.title, p.md, { perLang: finishPub, pageClass: 'pubs' });
}
for (const lang of ['jp', 'en']) {
  const intro = lang === 'jp' ? '業績は種類ごとに別ページです。各ページの番号は古いものから順に大きくなります。' : 'Publications are listed on separate pages by type. Entries are numbered from the oldest (1) to the newest.';
  const list = pubs.map((p) => '- [' + (lang === 'jp' ? p.ja : p.title) + '](/' + lang + '/publications/' + p.slug + '/)' + (p.count ? (lang === 'jp' ? '（' + p.count + '件）' : ' (' + p.count + ')') : '')).join('\n');
  fs.mkdirSync(lang, { recursive: true });
  fs.writeFileSync(lang + '/publications.md', fm('publications', '/' + lang + '/publications/', lang) + intro + '\n\n' + list + '\n');
}
fs.writeFileSync('_raw/pub-report.md', '# publication split report\n' + pubReport);

await browser.close();

// Old root URLs (/about/ etc.) become redirects to the English pages.
for (const s of ['about', 'research', 'publications', 'education', 'lab-members', 'photographs', 'misc']) {
  const to = '/en/' + s + '/';
  fs.writeFileSync(s + '.md', '---\npermalink: /' + s + '/\nlayout: null\n---\n<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><title>Redirecting</title>\n<meta http-equiv="refresh" content="0; url=' + to + '"><link rel="canonical" href="' + to + '"></head>\n<body><a href="' + to + '">' + to + '</a></body></html>\n');
}
try { execSync('git add -A jp en', { stdio: 'inherit' }); } catch (e) { console.log('git add failed', e.message); }
