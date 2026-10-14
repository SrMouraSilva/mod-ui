#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Tests and builds modui-client and modui-plugin-view for publication (the client first: the view's type declarations use its own), and
# with an output directory packs both as tarballs whose version carries the build stamp:
#
#   tools/pack-modui-packages.sh              install, test and build only
#   tools/pack-modui-packages.sh <outdir>     also write <outdir>/modui-client-<version>.tgz and modui-plugin-view-<version>.tgz
#
# The version is the one of package.json plus a prerelease stamp: 0.1.0-<UTC date and time>.g<commit>, e.g. 0.1.0-20261013225031.gabc1234.
# (The `g` keeps a hash of digits only, with a leading zero, from being an invalid semver identifier.) package.json is restored afterwards.
# With an output directory it also writes <outdir>/tag.txt, the release tag: <UTC date>-<UTC time>-<commit>, e.g. 20261013-225031-abc1234.
# Needs npm 11.6 or newer: npm 10 (the one of Node.js 22) and npm 11.0 crash on `npm install` of vitest 5 ("Cannot read properties of null
# (reading 'edgesOut')"); Node.js 24 bundles a working npm, on Node.js 22 run `npm install -g npm@11` first.
# Used by .github/workflows/modui-packages.yml; runs the same way on a developer's machine (Node.js 22.12 or newer).

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="${1:-}"
[ -z "$out" ] || { mkdir -p "$out" && out="$(cd "$out" && pwd)"; }

npm_major_minor="$(npm --version | awk -F. '{ printf "%d%03d", $1, $2 }')"
if [ "$npm_major_minor" -lt 11006 ]; then
  echo "npm $(npm --version) is too old: npm 11.6 or newer is needed (npm 10 crashes on vitest 5, see the header of this script)" >&2
  exit 1
fi

commit="$(git -C "$root" rev-parse --short=7 HEAD)"
now="$(date -u +%Y%m%d-%H%M%S)"
stamp="${now//-/}"

for package in modui-client modui-plugin-view; do
  echo "::group::$package"
  cd "$root/$package"
  npm install --no-audit --no-fund
  npm test
  npm run build:lib
  if [ -n "$out" ]; then
    cp package.json "$root/$package.package.json.orig"
    trap 'for p in modui-client modui-plugin-view; do [ -f "$root/$p.package.json.orig" ] && mv "$root/$p.package.json.orig" "$root/$p/package.json"; done' EXIT
    base="$(node -p "require('./package.json').version.split('-')[0].split('+')[0]")"
    npm pkg set version="$base-$stamp.g$commit"
    npm pack --pack-destination "$out"
  else
    npm pack --dry-run
  fi
  echo "::endgroup::"
done

if [ -n "$out" ]; then
  echo "$now-$commit" > "$out/tag.txt"
  echo "release tag: $now-$commit"
fi
