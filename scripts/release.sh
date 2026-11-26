#!/usr/bin/env bash
# Start a new release: bump the version in package.json, commit, tag vX.Y.Z and push both.
# The pushed tag triggers the Release workflow, which builds the Windows, macOS and Linux (.deb)
# installers and publishes them as a GitHub release.
#
#   scripts/release.sh patch|minor|major|X.Y.Z[-pre] [--dry-run] [--yes] [--skip-checks]
#
#   --dry-run      show what would happen; change nothing
#   --yes          do not ask for confirmation
#   --skip-checks  skip lint, typecheck and unit tests (the workflow still runs them)
set -euo pipefail

usage() {
  sed -n '6,10s/^# \{0,1\}//p' "$0"
  exit "${1:-1}"
}

die() {
  echo "error: $*" >&2
  exit 1
}

bump=''
dry_run=0
assume_yes=0
checks=1
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=1 ;;
    --yes | -y) assume_yes=1 ;;
    --skip-checks) checks=0 ;;
    -h | --help) usage 0 ;;
    -*) die "unknown option: $arg" ;;
    *)
      [ -z "$bump" ] || die "only one version argument is allowed"
      bump="$arg"
      ;;
  esac
done
[ -n "$bump" ] || usage

cd "$(git rev-parse --show-toplevel)"
command -v node >/dev/null || die "Node.js is not on PATH (try: nvm use 22)"

# The next version, from the current one and the requested bump.
current="$(node -p "require('./package.json').version")"
version="$(
  node - "$current" "$bump" <<'EOF'
const [current, bump] = process.argv.slice(2)
const semver = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/
const m = semver.exec(current)
if (!m) throw new Error(`package.json version is not X.Y.Z: ${current}`)
const [major, minor, patch] = m.slice(1, 4).map(Number)
const pre = m[4] !== undefined
let next
if (bump === 'major') next = `${major + 1}.0.0`
else if (bump === 'minor') next = `${major}.${minor + 1}.0`
else if (bump === 'patch') next = pre ? `${major}.${minor}.${patch}` : `${major}.${minor}.${patch + 1}`
else if (semver.test(bump.replace(/^v/, ''))) next = bump.replace(/^v/, '')
else {
  console.error(`error: expected patch, minor, major or X.Y.Z, got: ${bump}`)
  process.exit(1)
}
const key = (v) => {
  const [core, tag] = v.split('-')
  return [...core.split('.').map(Number), tag === undefined ? 1 : 0]
}
const [a, b] = [key(next), key(current)]
const cmp = a.map((x, i) => x - b[i]).find((d) => d !== 0) ?? 0
if (cmp < 0 || (cmp === 0 && next === current)) {
  console.error(`error: ${next} is not newer than ${current}`)
  process.exit(1)
}
console.log(next)
EOF
)"
tag="v$version"

# The repository must be clean, on its default branch, and not behind the remote.
remote=origin
git remote get-url "$remote" >/dev/null 2>&1 || die "no '$remote' remote"
branch="$(git symbolic-ref --quiet --short HEAD)" || die "not on a branch (detached HEAD)"
default="$(git symbolic-ref --quiet --short "refs/remotes/$remote/HEAD" 2>/dev/null || true)"
default="${default#"$remote"/}"
[ -n "$default" ] || default=master
[ "$branch" = "$default" ] || die "releases are made from '$default', not '$branch'"
[ -z "$(git status --porcelain)" ] || die "the working tree has uncommitted changes"
echo "Fetching $remote..."
git fetch --quiet --tags "$remote" "$branch"
git merge-base --is-ancestor "$remote/$branch" HEAD ||
  die "'$branch' is behind $remote/$branch: pull first"
if git rev-parse --quiet --verify "refs/tags/$tag" >/dev/null; then die "tag $tag already exists"; fi

if [ "$checks" = 1 ]; then
  echo "Running lint, typecheck and unit tests..."
  npm run --silent lint
  npm run --silent typecheck
  npm test --silent
fi

ahead="$(git rev-list --count "$remote/$branch..HEAD")"
echo
echo "Release $tag (currently $current), from '$branch' at $(git rev-parse --short HEAD)."
[ "$ahead" = 0 ] || echo "This also pushes $ahead local commit(s) not yet on $remote."
if [ "$dry_run" = 1 ]; then
  echo "Dry run: would commit 'Release $tag', tag $tag and push both to $remote."
  exit 0
fi
if [ "$assume_yes" != 1 ]; then
  read -r -p "Commit, tag and push? [y/N] " answer
  case "$answer" in [yY] | [yY][eE][sS]) ;; *) die "cancelled" ;; esac
fi

npm version "$version" --no-git-tag-version >/dev/null
git add package.json package-lock.json
git commit --quiet -m "Release $tag"
git tag -a "$tag" -m "Release $tag"
# Atomic: either the branch and the tag both reach the remote, or neither does.
git push --atomic "$remote" "HEAD:refs/heads/$branch" "refs/tags/$tag"

echo
echo "Pushed $tag. The Release workflow now builds and publishes the installers."
if command -v gh >/dev/null; then
  url="$(gh repo view --json url --jq .url 2>/dev/null || true)"
  [ -z "$url" ] || echo "Progress: $url/actions/workflows/release.yml  Release: $url/releases/tag/$tag"
fi
