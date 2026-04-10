param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Version
)

$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location -Path $root

$inside = [string](git rev-parse --is-inside-work-tree)
$inside = $inside.Trim()
if ($inside -ne "true") {
  throw "Current folder is not a git repository."
}

$dirty = git status --porcelain
if ($dirty) {
  throw "Working tree is not clean. Please commit or stash changes first."
}

$branch = [string](git branch --show-current)
$branch = $branch.Trim()
if (-not $branch) {
  throw "Cannot detect current branch."
}

$normalized = [string]$Version
if ($normalized.StartsWith("v")) { $normalized = $normalized.Substring(1) }

if ($normalized -notmatch '^\d+\.\d+\.\d+([\-+][0-9A-Za-z\.-]+)?$') {
  throw "Invalid version format: $Version"
}

$tag = "v$normalized"
$existingTag = [string](git tag -l $tag)
$existingTag = $existingTag.Trim()
if ($existingTag -eq $tag) {
  throw "Tag already exists: $tag"
}

npm version $normalized --no-git-tag-version

git add package.json package-lock.json
git commit -m "release: $tag"
git tag $tag

git push origin $branch
git push origin $tag

Write-Output "Release prepared and pushed: $tag"
Write-Output "GitHub Actions will publish installer package from the tag."
