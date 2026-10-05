(function (root) {
  'use strict';
  // Bash-style glob matcher with explanations. Pure functions, no file system.
  var CLASSES = {
    alpha: /[A-Za-z]/, digit: /[0-9]/, alnum: /[A-Za-z0-9]/, upper: /[A-Z]/, lower: /[a-z]/, space: /[ \t\n\r\f\v]/, blank: /[ \t]/,
    punct: /[!-\/:-@\[-`{-~]/, print: /[ -~]/, graph: /[!-~]/, cntrl: /[\x00-\x1f\x7f]/, xdigit: /[0-9A-Fa-f]/, word: /[A-Za-z0-9_]/, ascii: /[\x00-\x7f]/
  };

  // ---- brace expansion (done by bash before globbing) ----
  function expandBraces(p) {
    var i, depth, start = -1;
    for (i = 0; i < p.length; i++) {
      var c = p[i];
      if (c === '\\') { i++; continue; }
      if (c === '{') {
        depth = 1; var j = i + 1, commas = [], end = -1;
        for (; j < p.length; j++) {
          var d = p[j];
          if (d === '\\') { j++; continue; }
          if (d === '{') depth++;
          else if (d === '}') { depth--; if (depth === 0) { end = j; break; } }
          else if (d === ',' && depth === 1) commas.push(j);
        }
        if (end < 0) continue;
        var pre = p.slice(0, i), post = p.slice(end + 1), body = p.slice(i + 1, end), parts = [], k, last = i + 1;
        if (commas.length) {
          for (k = 0; k < commas.length; k++) { parts.push(p.slice(last, commas[k])); last = commas[k] + 1; }
          parts.push(p.slice(last, end));
        } else {
          var m = /^(-?\d+)\.\.(-?\d+)(?:\.\.(-?\d+))?$/.exec(body), a, b, st;
          if (m) {
            a = +m[1]; b = +m[2]; st = Math.abs(+(m[3] || 1)) || 1;
            if (a <= b) for (k = a; k <= b; k += st) parts.push(String(k)); else for (k = a; k >= b; k -= st) parts.push(String(k));
          } else if ((m = /^([A-Za-z])\.\.([A-Za-z])$/.exec(body))) {
            a = m[1].charCodeAt(0); b = m[2].charCodeAt(0);
            if (a <= b) for (k = a; k <= b; k++) parts.push(String.fromCharCode(k)); else for (k = a; k >= b; k--) parts.push(String.fromCharCode(k));
          } else continue;
        }
        var out = [];
        parts.forEach(function (x) { expandBraces(pre + x + post).forEach(function (y) { out.push(y); }); });
        return out;
      }
    }
    return [p];
  }

  // ---- segment parser ----
  function parseSeq(s, i, inExt, ext) {
    var seq = [];
    while (i < s.length) {
      var c = s[i];
      if (inExt && (c === '|' || c === ')')) break;
      if (c === '\\' && i + 1 < s.length) { seq.push({ t: 'lit', c: s[i + 1], src: s.slice(i, i + 2) }); i += 2; continue; }
      if (ext && '?*+@!'.indexOf(c) >= 0 && s[i + 1] === '(') {
        var alts = [], j = i + 2, ok = false;
        for (;;) {
          var r = parseSeq(s, j, true, ext);
          alts.push(r.seq); j = r.i;
          if (s[j] === '|') { j++; continue; }
          if (s[j] === ')') { ok = true; j++; }
          break;
        }
        if (ok) { seq.push({ t: 'ext', op: c, alts: alts, src: s.slice(i, j) }); i = j; continue; }
      }
      if (c === '*') { while (s[i + 1] === '*' && !(ext && s[i + 2] === '(')) i++; seq.push({ t: 'any', src: '*' }); i++; continue; }
      if (c === '?') { seq.push({ t: 'one', src: '?' }); i++; continue; }
      if (c === '[') {
        var q = i + 1, neg = false, items = [], closed = false;
        if (s[q] === '!' || s[q] === '^') { neg = true; q++; }
        var first = true;
        while (q < s.length) {
          var ch = s[q];
          if (ch === ']' && !first) { closed = true; q++; break; }
          first = false;
          if (ch === '[' && s[q + 1] === ':') {
            var e = s.indexOf(':]', q + 2);
            if (e > 0 && CLASSES[s.slice(q + 2, e)]) { items.push({ cls: s.slice(q + 2, e) }); q = e + 2; continue; }
          }
          var lo = ch;
          if (ch === '\\' && q + 1 < s.length) { lo = s[q + 1]; q++; }
          q++;
          if (s[q] === '-' && q + 1 < s.length && s[q + 1] !== ']') {
            var hi = s[q + 1]; q += 2;
            if (hi === '\\' && q < s.length) { hi = s[q]; q++; }
            items.push({ lo: lo, hi: hi });
          } else items.push({ lo: lo, hi: lo });
        }
        if (closed) { seq.push({ t: 'set', neg: neg, items: items, src: s.slice(i, q) }); i = q; continue; }
        seq.push({ t: 'lit', c: '[', src: '[' }); i++; continue;
      }
      seq.push({ t: 'lit', c: c, src: c }); i++;
    }
    return { seq: seq, i: i };
  }

  function inSet(node, ch, nocase) {
    function testRanges(x) {
      for (var k = 0; k < node.items.length; k++) { var it = node.items[k]; if (!it.cls && x >= it.lo && x <= it.hi) return true; }
      return false;
    }
    function test(x) {
      for (var k = 0; k < node.items.length; k++) {
        var it = node.items[k];
        if (it.cls) { if (CLASSES[it.cls].test(x)) return true; } else if (x >= it.lo && x <= it.hi) return true;
      }
      return false;
    }
    var r = test(ch) || (nocase && (testRanges(ch.toLowerCase()) || testRanges(ch.toUpperCase())));
    return node.neg ? !r : r;
  }

  function matchName(seq, name, opts, track) {
    var best = { si: -1, pos: -1 };
    function ms(sq, si, pos, k, top) {
      if (top && (si > best.si || (si === best.si && pos > best.pos))) { best.si = si; best.pos = pos; }
      if (si === sq.length) return k(pos);
      var n = sq[si];
      function next(p) { return ms(sq, si + 1, p, k, top); }
      switch (n.t) {
        case 'lit': return pos < name.length && (name[pos] === n.c || (opts.nocase && name[pos].toLowerCase() === n.c.toLowerCase())) && next(pos + 1);
        case 'one': return pos < name.length && next(pos + 1);
        case 'any': for (var p = pos; p <= name.length; p++) { if (top && p > pos) { /* progress tracking only */ } if (next(p)) return true; } return false;
        case 'set': return pos < name.length && inSet(n, name[pos], opts.nocase) && next(pos + 1);
        case 'ext': return ext(n, pos, next);
      }
      return false;
    }
    function altMatch(alts, pos, k) { for (var a = 0; a < alts.length; a++) if (ms(alts[a], 0, pos, k, false)) return true; return false; }
    function star(n, pos, next) { return next(pos) || altMatch(n.alts, pos, function (q) { return q > pos && star(n, q, next); }); }
    function ext(n, pos, next) {
      switch (n.op) {
        case '@': return altMatch(n.alts, pos, next);
        case '?': return next(pos) || altMatch(n.alts, pos, next);
        case '*': return star(n, pos, next);
        case '+': return altMatch(n.alts, pos, function (q) { return star(n, q, next); });
        case '!': for (var e = pos; e <= name.length; e++) { if (!altMatch(n.alts, pos, function (q) { return q === e; }) && next(e)) return true; } return false;
      }
      return false;
    }
    var ok = ms(seq, 0, 0, function (p) { return p === name.length; }, true);
    if (track) track.best = best;
    return ok;
  }

  function dotStart(f) {
    if (!f) return false;
    if (f.t === 'lit') return f.c === '.';
    if (f.t === 'ext' && f.op !== '!') return f.alts.some(function (a) { return dotStart(a[0]); });
    return false;
  }
  function segMatches(seq, name, opts, track, raw) {
    if (opts.nocase && raw !== undefined && !hasMagic(raw, opts.extglob)) { var c = norm(opts); c.nocase = false; opts = c; }
    if (name.length && name[0] === '.' && !opts.dotglob) {
      if (!dotStart(seq[0])) return false;
    }
    return matchName(seq, name, opts, track);
  }

  function splitPath(s) { return s.split('/').filter(function (x) { return x !== ''; }); }
  function splitPat(s) {
    var segs = [], cur = '', i;
    for (i = 0; i < s.length; i++) {
      if (s[i] === '\\' && i + 1 < s.length) { cur += s[i] + s[i + 1]; i++; continue; }
      if (s[i] === '/') { if (cur !== '') segs.push(cur); cur = ''; continue; }
      cur += s[i];
    }
    if (cur !== '') segs.push(cur);
    return segs;
  }

  function compile(alt, opts) {
    var dirOnly = /\/$/.test(alt) && !/\\\/$/.test(alt), abs = alt[0] === '/';
    var raw = splitPat(alt);
    var segs = raw.map(function (r) {
      return { raw: r, star2: !!opts.globstar && r === '**', seq: parseSeq(r, 0, false, !!opts.extglob).seq };
    });
    return { dirOnly: dirOnly, abs: abs, segs: segs };
  }

  function pathInfo(path) {
    var isDir = /\/$/.test(path), abs = path[0] === '/';
    return { isDir: isDir, abs: abs, segs: splitPath(path) };
  }

  function matchCompiled(c, pi, opts) {
    if (c.dirOnly && !pi.isDir) return false;
    if (c.abs !== pi.abs) return false;
    var P = c.segs, N = pi.segs;
    function go(a, b, c) {
      if (a === P.length) return b === N.length;
      if (P[a].star2) {
        if (!(c === 0 && a === P.length - 1 && b === N.length && a > 0 && !pi.isDir) && go(a + 1, b, 0)) return true;
        if (b < N.length) {
          var isLast = b === N.length - 1;
          var dirOK = !isLast || pi.isDir || a === P.length - 1;
          if (dirOK && (opts.dotglob || N[b][0] !== '.') && go(a, b + 1, 1)) return true;
        }
        return false;
      }
      return b < N.length && segMatches(P[a].seq, N[b], opts, null, P[a].raw) && go(a + 1, b + 1, 0);
    }
    return go(0, 0, 0);
  }

  function norm(o) { o = o || {}; return { globstar: !!o.globstar, dotglob: !!o.dotglob, extglob: !!o.extglob, nocase: !!o.nocase }; }

  function hasMagic(a, ext) { return /(^|[^\\])[*?\[]/.test(a) || (ext && /(^|[^\\])[+@!]\(/.test(a)); }
  function isMatch(pattern, path, o) {
    o = norm(o); var pi = pathInfo(path), alts = expandBraces(pattern), i;
    for (i = 0; i < alts.length; i++) { if (matchCompiled(compile(alts[i], o), pi, o)) return true; }
    return false;
  }

  // ---- explanations ----
  function describe(n) {
    if (!n) return 'the end of the name';
    switch (n.t) {
      case 'lit': return '"' + n.c + '"';
      case 'one': return 'any one character (?)';
      case 'set': return 'a character from ' + n.src + (n.neg ? ' (anything not listed)' : '');
      case 'any': return 'anything (*)';
      case 'ext': return 'the group ' + n.src;
    }
    return '?';
  }

  function explainSeg(patSeg, name, opts) {
    var tr = {};
    if (name[0] === '.' && !opts.dotglob && !dotStart(patSeg.seq[0])) {
      if (matchName(patSeg.seq, name, opts)) return { kind: 'dot', msg: '"' + name + '" starts with a dot, so "' + patSeg.raw + '" skips it. In bash, *, ? and [...] never match a leading dot unless dotglob is on. Start the part with a literal dot, or turn on dotglob.' };
    }
    matchName(patSeg.seq, name, opts, tr);
    var b = tr.best, sq = patSeg.seq;
    if (b.si >= sq.length) {
      return { kind: 'long', msg: 'The pattern "' + patSeg.raw + '" ends but the name "' + name + '" goes on' + (b.pos < name.length ? ' with "' + name.slice(b.pos) + '"' : '') + '.' };
    }
    var found = b.pos < name.length ? '"' + name[b.pos] + '"' : 'the end of the name';
    var lowerHit = !opts.nocase && matchName(patSeg.seq, name, { globstar: opts.globstar, dotglob: opts.dotglob, extglob: opts.extglob, nocase: true });
    if (lowerHit) return { kind: 'case', msg: '"' + name + '" differs from "' + patSeg.raw + '" only in letter case. Globs are case sensitive.' };
    var bang = sq.some(function (n) { return n.t === 'ext' && n.op === '!'; });
    return { kind: 'miss', msg: (bang ? 'Remember that !(x) matches anything except x. ' : '') + 'The name "' + name + '" gets as far as ' + (b.pos) + ' character' + (b.pos === 1 ? '' : 's') + ' of "' + patSeg.raw + '", then the pattern needs ' + describe(sq[b.si]) + ' but finds ' + found + '.' };
  }

  function explainAlt(alt, pi, opts) {
    var c = compile(alt, opts), P = c.segs, N = pi.segs, notes = [], score = 0, i;
    if (c.abs !== pi.abs) { notes.push(c.abs ? 'The pattern starts with / (an absolute path) but the path does not.' : 'The path starts with / but the pattern does not.'); return { notes: notes, score: 0 }; }
    var gi = -1, gl = -1;
    for (i = 0; i < P.length; i++) if (P[i].star2) { if (gi < 0) gi = i; gl = i; }
    function check(pi0, ni0, count) {
      for (var k = 0; k < count; k++) {
        var seg = P[pi0 + k], name = N[ni0 + k];
        if (segMatches(seg.seq, name, opts, null, seg.raw)) { score++; continue; }
        var ex = explainSeg(seg, name, opts);
        notes.push('Part ' + (ni0 + k + 1) + ' of the path ("' + name + '") against "' + seg.raw + '": ' + ex.msg);
        return false;
      }
      return true;
    }
    if (gi < 0) {
      var common = Math.min(P.length, N.length);
      if (check(0, 0, common)) {
        if (N.length > P.length) notes.push('The pattern has ' + P.length + ' part' + (P.length === 1 ? '' : 's') + ' but the path has ' + N.length + '. After "' + P.map(function (x) { return x.raw; }).join('/') + '" the path continues with "' + N.slice(P.length).join('/') + '". * and ? never match a slash' + (opts.globstar ? '' : ', and ** only crosses folders when globstar is on') + '.');
        else if (N.length < P.length) notes.push('The path ends after ' + N.length + ' part' + (N.length === 1 ? '' : 's') + ' but the pattern still wants "' + P.slice(N.length).map(function (x) { return x.raw; }).join('/') + '".');
        else if (c.dirOnly && !pi.isDir) notes.push('The pattern ends in / so it only matches directories. Mark the path as a directory with a trailing /.');
      }
    } else {
      var head = gi, tail = P.length - 1 - gl;
      if (N.length < head + tail) notes.push('The path has ' + N.length + ' part' + (N.length === 1 ? '' : 's') + ' but the pattern needs at least ' + (head + tail) + ' around its **.');
      else if (check(0, 0, head) && check(gl + 1, N.length - tail, tail)) {
        if (c.dirOnly && !pi.isDir) notes.push('The pattern ends in / so it only matches directories. Mark the path as a directory with a trailing /.');
        else notes.push('The parts line up around **, but ** does not step through a hidden (dot) folder or a file in the middle of the path' + (opts.dotglob ? '.' : '. Turn dotglob on to allow dot folders.'));
      }
    }
    return { notes: notes, score: score };
  }

  function explain(pattern, path, o) {
    o = norm(o);
    var pi = pathInfo(path), alts = expandBraces(pattern), i, res = { matched: false, alt: null, notes: [], hints: [] };
    for (i = 0; i < alts.length; i++) if (matchCompiled(compile(alts[i], o), pi, o)) { res.matched = true; res.alt = alts[i]; return res; }
    var best = null;
    alts.forEach(function (a) { var e = explainAlt(a, pi, o); e.alt = a; if (!best || e.score > best.score) best = e; });
    res.alt = best.alt; res.notes = best.notes;
    ['globstar', 'dotglob', 'extglob', 'nocase'].forEach(function (k) {
      if (o[k]) return;
      var o2 = norm(o); o2[k] = true;
      if (isMatch(pattern, path, o2)) res.hints.push(k === 'nocase' ? 'It would match with: shopt -s nocaseglob' : 'It would match with: shopt -s ' + k);
    });
    return res;
  }

  var api = { isMatch: isMatch, explain: explain, expandBraces: expandBraces };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GlobWhy = api;
})(typeof window !== 'undefined' ? window : this);
