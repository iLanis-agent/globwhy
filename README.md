# GlobWhy
Type a bash glob and a list of paths (a trailing `/` marks a directory). See which paths match and why each miss fails. Static client-side app, open `app.html`.
Sources: none fetched; behavior is checked against real GNU bash 5.1 on generated file trees.
Tests: `node test-engine.js` builds random trees, runs real bash (`printf` over the unquoted pattern with globstar, dotglob, extglob and nocaseglob combinations) and compares the matched set with the engine for every path. Six runs with different seeds: 9,594 patterns, 243,475 path checks, 0 differences. Mismatches found along the way and fixed: `**` and directories, leading dot with `?(.)`, nocaseglob not applying to literal parts or to [:class:], dotglob.
Not covered by the test (excluded or unverified): `*!(x)` (bash quirk), double slashes, a pattern with no wildcard ending in `/` (bash prints it without checking), non-ASCII letters in classes, emoji, symlinks, `.` and `..` entries, zero-padded `{01..03}`.
Limits: bash semantics only (not .gitignore, GitHub Actions filters, zsh). Explanations for `**` patterns compare the parts before and after the `**` only.
