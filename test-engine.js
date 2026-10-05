// Compares engine.js with real GNU bash 5.x globbing on generated file trees and patterns.
const g = require('./engine.js'), fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
let seed = +process.env.SEED || 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const pick = a => a[Math.floor(rnd() * a.length)];
const NAMES = ['a', 'b', 'ab', 'abc', 'a.js', 'b.ts', 'ab.js', '.h', '.h.js', 'A', 'B.JS', 'x1', 'x2', 'x10', '1', 'd.e', 'a-b', 'a_b', 'foo.min.js', 'readme', 'README.md', '.git', '-x'];
function genUniverse() {
  const files = new Set(), n = 8 + Math.floor(rnd() * 14);
  for (let i = 0; i < n; i++) { const d = 1 + Math.floor(rnd() * 3), p = []; for (let k = 0; k < d; k++) p.push(pick(NAMES)); files.add(p.join('/')); }
  // a path can't be both file and dir: drop files that are prefixes of others
  let list = [...files]; list = list.filter(f => !list.some(o => o !== f && o.startsWith(f + '/')));
  const dirs = new Set(); list.forEach(f => { const s = f.split('/'); for (let k = 1; k < s.length; k++) dirs.add(s.slice(0, k).join('/')); });
  return { files: list, dirs: [...dirs] };
}
function genSeg(o) {
  const parts = [], n = 1 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const r = rnd();
    if (r < 0.28) parts.push(pick(['a', 'b', 'x', '1', '.', 'js', '.js', 'ab', 'A', 'ts', '-', 'min', 'foo', 'README']));
    else if (r < 0.42) parts.push('*'); else if (r < 0.52) parts.push('?');
    else if (r < 0.62) parts.push(pick(['[ab]', '[!a]', '[a-c]', '[^.]', '[[:digit:]]', '[[:upper:]]', '[.]', '[]a]', '[a-]', '[[:alpha:]]', '[x', '[0-9]']));
    else if (r < 0.72) parts.push(pick(['{a,b}', '{js,ts}', '{1..2}', '{a,}', '{x,ab}', '{a,b{1,2}}', '{a}']));
    else if (o.extglob) parts.push(pick(['@(a|b)', '?(a)', '*(a|b)', '+(a|1)', '!(a)', '!(*.js)', '@(*.js|*.ts)', '+([0-9])', '!(a|b)', '?(.)h']));
    else parts.push(pick(['*', 'a', '(a|b)', '.*']));
  }
  return parts.join('');
}
function noStarBang(p) { return p.replace(/\*+(?=!\()/g, ''); }
function genPattern(o) {
  const n = 1 + Math.floor(rnd() * 3), segs = [];
  for (let i = 0; i < n; i++) segs.push(o.globstar && rnd() < 0.3 ? '**' : genSeg(o));
  let p = segs.join('/'); if (rnd() < 0.12) p += '/'; return noStarBang(p);
}
const results = { cases: 0, checks: 0, bad: [] };
const U = +process.env.UNIVERSES || 40, PER = +process.env.PER || 40;
for (let u = 0; u < U; u++) {
  const uni = genUniverse(), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-'));
  uni.dirs.forEach(d => fs.mkdirSync(path.join(tmp, d), { recursive: true }));
  uni.files.forEach(f => { fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true }); fs.writeFileSync(path.join(tmp, f), ''); });
  const cases = []; const outp = [];
  for (let i = 0; i < PER; i++) {
    let o, pat;
    do { o = { globstar: rnd() < 0.5, dotglob: rnd() < 0.3, extglob: rnd() < 0.5, nocase: rnd() < 0.15 }; pat = genPattern(o); } while (g.expandBraces(pat).some(a => /\/\//.test(a) || (/\/$/.test(a) && !/[*?\[]|[+@!]\(/.test(a))));
    cases.push({ o, pat });
    const sc = 'export LC_ALL=C.UTF-8\ncd ' + JSON.stringify(tmp) + '\nshopt -s nullglob\n' + (o.globstar ? 'shopt -s globstar\n' : '') + (o.dotglob ? 'shopt -s dotglob\n' : '') + (o.extglob ? 'shopt -s extglob\n' : '') + (o.nocase ? 'shopt -s nocaseglob\n' : '') + "eval 'printf \"%s\\n\" " + pat.replace(/'/g, "'\\''") + "'\n";
    const rr = cp.spawnSync('timeout', ['3', 'bash', '-c', sc], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    outp.push('\n' + (rr.status === 124 ? '@@TIMEOUT\n' : rr.stdout));
  }
  const all = [...uni.files.map(f => ({ p: f, dir: false })), ...uni.dirs.map(d => ({ p: d, dir: true }))];
  cases.forEach((c, i) => {
    if (outp[i].includes('@@TIMEOUT')) { results.skipped = (results.skipped||0)+1; return; } const lines = outp[i].split('\n').slice(1).filter(x => x !== '');
    const exp = new Set(lines.map(l => l.replace(/\/$/, '')).filter(l => all.some(a => a.p === l)));
    all.forEach(a => {
      results.checks++;
      const got = g.isMatch(c.pat, a.dir ? a.p + '/' : a.p, c.o);
      // bash: pattern with trailing slash lists only dirs; engine requires a dir too
      const want = exp.has(a.p);
      if (got !== want) results.bad.push({ pat: c.pat, o: c.o, path: a.p, dir: a.dir, want, got });
    });
    results.cases++;
  });
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(JSON.stringify({ cases: results.cases, checks: results.checks, mismatches: results.bad.length }));
const seen = new Set(); results.bad.slice(0, 400).forEach(b => { const k = b.pat + JSON.stringify(b.o); if (seen.has(k) || seen.size > 14) return; seen.add(k); console.log(JSON.stringify(b)); });
process.exit(results.bad.length ? 1 : 0);
