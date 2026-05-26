#!/usr/bin/env bash
set -euo pipefail

version="$(tr -d '[:space:]' < .nvmrc)"
version="${version#v}"

case "$version" in
  [0-9]*.[0-9]*.[0-9]*) ;;
  *)
    echo "::error::.nvmrc must contain an exact Node.js version for token-free CI setup, got '$version'"
    exit 1
    ;;
esac

archive="node-v${version}-linux-x64.tar.xz"
install_dir="${RUNNER_TEMP:-/tmp}/node-v${version}"
archive_path="${RUNNER_TEMP:-/tmp}/${archive}"

if [ ! -x "${install_dir}/bin/node" ]; then
  rm -rf "$install_dir"
  mkdir -p "$install_dir"
  curl -fsSL "https://nodejs.org/dist/v${version}/${archive}" -o "$archive_path"
  tar -xJf "$archive_path" -C "$install_dir" --strip-components=1
fi

if [ -n "${GITHUB_PATH:-}" ]; then
  echo "${install_dir}/bin" >> "$GITHUB_PATH"
fi

"${install_dir}/bin/node" --version
"${install_dir}/bin/npm" --version
