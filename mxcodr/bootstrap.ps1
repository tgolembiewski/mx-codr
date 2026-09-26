<#
.SYNOPSIS
  Windows bootstrap: installs Git, Python and Node with winget, then runs install.sh --with-deps in Git Bash.

.PARAMETER Target
  Mendix project to install into (created if missing). Default: asked for, with the current
  folder offered unless it is the mx-codr folder that was cloned.

.PARAMETER SkipWinget
  Skip the winget stage.

.OUTPUTS
  Exit 1 when winget or Git Bash is missing; otherwise install.sh's exit code.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File mx-codr\mxcodr\bootstrap.ps1
  powershell -ExecutionPolicy Bypass -File mx-codr\mxcodr\bootstrap.ps1 C:\Mendix\MyApp
#>

[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Target = '',

  [switch]$SkipWinget
)

# Native programs exiting non-zero do not stop the script; check $LASTEXITCODE.
$ErrorActionPreference = 'Stop'

function Write-Step($text) { Write-Host "  - $text" -ForegroundColor Cyan }
function Write-Ok($text)   { Write-Host "  + $text" -ForegroundColor Green }
function Write-Warn($text) { Write-Host "  ! $text" -ForegroundColor Yellow }

# winget writes PATH only to the registry; re-read it into this process.
function Update-PathFromRegistry {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user    = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = (@($machine, $user) | Where-Object { $_ }) -join ';'
}

function Test-Command($name) {
  $null -ne (Get-Command $name -ErrorAction SilentlyContinue)
}

# Resolve-Python -- path of a Python that really runs, or $null.
# Skips the WindowsApps Store alias; also searches install dirs not on PATH.
function Resolve-Python {
  foreach ($name in @('python3', 'python', 'py')) {
    $command = Get-Command $name -ErrorAction SilentlyContinue
    if (-not $command) { continue }
    if ($command.Source -like '*\WindowsApps\*') { continue }
    & $command.Source -c 'import json,sys' 2>$null
    if ($LASTEXITCODE -eq 0) { return $command.Source }
  }
  $roots = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Python'),
    $env:ProgramFiles,
    ${env:ProgramFiles(x86)}
  ) | Where-Object { $_ -and (Test-Path $_) }
  foreach ($root in $roots) {
    $found = Get-ChildItem -Path $root -Filter 'python.exe' -Recurse -Depth 2 -ErrorAction SilentlyContinue |
             Sort-Object FullName -Descending | Select-Object -First 1
    if ($found) {
      & $found.FullName -c 'import json,sys' 2>$null
      if ($LASTEXITCODE -eq 0) { return $found.FullName }
    }
  }
  return $null
}

# Test-PackagePresent <package> -- true when the package's Resolver (or its Probe command) finds it.
function Test-PackagePresent($package) {
  if ($package.Resolver) { [bool](& $package.Resolver) } else { Test-Command $package.Probe }
}

# --- main ---
Write-Host ''
Write-Host '  MX-CODR  ' -ForegroundColor White -NoNewline
Write-Host 'Windows bootstrap' -ForegroundColor DarkGray
Write-Host ''

# --- 0. the project folder, asked first so the rest runs unattended --------
# The project folder: named, or asked for with the current folder as the default. The cloned
# mx-codr folder (the bundle's parent, marked .mx-codr-repo) is never the project.
$repoRoot = Split-Path -Parent $PSScriptRoot
function Test-InRepo($path) {
  $full = [IO.Path]::GetFullPath($path).TrimEnd('\')
  foreach ($root in @($PSScriptRoot, $repoRoot)) {
    if (-not (Test-Path (Join-Path $repoRoot '.mx-codr-repo')) -and $root -eq $repoRoot) { continue }
    $r = [IO.Path]::GetFullPath($root).TrimEnd('\')
    if ($full -eq $r -or $full.StartsWith($r + '\')) { return $true }
  }
  $false
}
if (-not $Target) {
  $here = (Get-Location).Path
  $default = if (Test-InRepo $here) { '' } else { $here }
  Write-Host ''
  Write-Host '  Where is your Mendix project? A folder with an app in it, or a new or empty folder'
  Write-Host '  for a new app -- not the mx-codr folder you cloned.'
  Write-Host ''
  $answer = if ($default) { Read-Host "  Project folder [$default]" } else { Read-Host '  Project folder' }
  $Target = if ($answer) { $answer.Trim('"') } else { $default }
  if (-not $Target) { Write-Warn 'Nothing installed: no project folder given.'; exit 1 }
}
if (Test-InRepo $Target) {
  Write-Warn "Nothing installed: $Target is the mx-codr folder, not a Mendix project."
  Write-Warn 'Give the folder of your Mendix app, or a new folder for a new app, outside it.'
  exit 1
}
if (-not (Test-Path $Target)) { New-Item -ItemType Directory -Force -Path $Target | Out-Null }
$Target = (Resolve-Path -LiteralPath $Target).Path

# Without Studio Pro nothing works on Windows: creating the app, mx check and the build all use
# the mx.exe / mxbuild.exe it installs. Say so now, before minutes of winget installs.
$studioPro = @("$env:ProgramFiles\Mendix", "${env:ProgramFiles(x86)}\Mendix", "$env:LOCALAPPDATA\Programs\Mendix") |
             Where-Object { $_ -and (Test-Path $_) } |
             ForEach-Object { Get-ChildItem -Path $_ -Filter 'mx.exe' -Recurse -Depth 3 -ErrorAction SilentlyContinue } |
             Select-Object -First 1
if (-not $studioPro -and -not $env:MDL_SKIP_STUDIO_PRO_CHECK) {
  Write-Host ''
  Write-Host '  Mendix Studio Pro is not installed. Install it first, then run this again.' -ForegroundColor Red
  Write-Host ''
  Write-Host '  On Windows the harness cannot work without it: creating the app, mx check and'
  Write-Host '  building the app all use the mx.exe and mxbuild.exe that come with Studio Pro.'
  Write-Host '  Docker does not replace it.'
  Write-Host ''
  Write-Host '    1. Install Mendix Studio Pro (the version of your app; a new app uses 11.12.1):'
  Write-Host '       https://marketplace.mendix.com/link/studiopro/'
  Write-Host '    2. Run this again:'
  Write-Host "       powershell -ExecutionPolicy Bypass -File `"$PSCommandPath`" `"$Target`""
  Write-Host ''
  exit 1
}
Write-Ok "Studio Pro: $(Split-Path -Parent (Split-Path -Parent $studioPro.FullName))"

# --- 1. winget stage ---------------------------------------------------------
if (-not $SkipWinget) {
  if (-not (Test-Command 'winget')) {
    Write-Warn 'winget was not found. It ships with App Installer on Windows 10 1809+.'
    Write-Warn 'Install "App Installer" from the Microsoft Store, or install Git for'
    Write-Warn 'Windows, Python 3 and Node.js by hand, then re-run with -SkipWinget.'
    exit 1
  }

  $packages = @(
    @{ Id = 'Git.Git';             Probe = 'git';    Why = 'Git Bash - the shell the harness runs in' },
    @{ Id = 'Python.Python.3.12';  Probe = 'python'; Why = 'the hook merges and the model checkers'; Resolver = 'Resolve-Python' },
    @{ Id = 'OpenJS.NodeJS.LTS';   Probe = 'node';   Why = 'playwright-cli, which drives the browser tests' }
  )

  foreach ($package in $packages) {
    if (Test-PackagePresent $package) {
      Write-Ok "$($package.Id) already present"
      continue
    }
    Write-Step "installing $($package.Id)  ($($package.Why))"
    & winget install -e --accept-package-agreements --accept-source-agreements `
        --disable-interactivity --id $package.Id
    Update-PathFromRegistry
    if (Test-PackagePresent $package) {
      Write-Ok "$($package.Id) installed"
    } else {
      Write-Warn "$($package.Id) did not become available on the PATH."
      Write-Warn 'Open a new terminal and re-run; a reboot is occasionally needed.'
    }
  }
}

Update-PathFromRegistry

# Put the resolved Python on PATH so bash sees it.
$python = Resolve-Python
if ($python) {
  $pythonDir = Split-Path -Parent $python
  if (($env:Path -split ';') -notcontains $pythonDir) {
    $env:Path = "$pythonDir;$env:Path"
    Write-Ok "python: $python  (added to PATH for this run)"
    Write-Warn "That directory is not on your permanent PATH. To fix it for good:"
    Write-Warn "  setx PATH `"$pythonDir;%PATH%`""
  } else {
    Write-Ok "python: $python"
  }
} else {
  Write-Warn 'No working Python found. install.sh will stop and say so.'
}

# --- 2. find a real Git Bash -------------------------------------------------
# `where bash` can return System32\bash.exe, the WSL launcher: reject it, prefer Git's own.
$bashCandidates = @(
  (Join-Path $env:ProgramFiles 'Git\bin\bash.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Git\bin\bash.exe'),
  (Join-Path $env:LOCALAPPDATA 'Programs\Git\bin\bash.exe')
) + @(Get-Command bash.exe -All -ErrorAction SilentlyContinue | ForEach-Object { $_.Source })

$bash = $bashCandidates |
  Where-Object { $_ -and (Test-Path $_) -and ($_ -notmatch '\\System32\\') } |
  Select-Object -First 1

if (-not $bash) {
  Write-Warn 'No Git Bash found. Install Git for Windows from https://git-scm.com/download/win'
  exit 1
}
Write-Ok "bash: $bash"

# --- 3. hand over to install.sh ---------------------------------------------
# ConvertTo-BashPath <path> -- C:\Mendix\App -> /c/Mendix/App
function ConvertTo-BashPath($path) {
  $full = (Resolve-Path -LiteralPath $path).Path
  '/' + $full.Substring(0, 1).ToLower() + $full.Substring(2).Replace('\', '/')
}

$bundlePath = ConvertTo-BashPath $PSScriptRoot
$targetPath = ConvertTo-BashPath $Target

Write-Step "installing the harness into $Target"
Write-Host ''
& $bash -c "cd '$bundlePath' && bash install.sh '$targetPath' --with-deps"
$installExit = $LASTEXITCODE

# --- 4. follow-up: the two this script does not install ----------------------
Write-Host ''
$harnessEnv = Join-Path $Target 'tests\harness.env'
$noDocker = (Test-Path $harnessEnv) -and (Select-String -Path $harnessEnv -Pattern 'MDL_NO_DOCKER=1' -Quiet)
if ($noDocker) {
  Write-Ok 'Set up without Docker -- see tests\harness.env for what it uses instead.'
}
# Studio Pro's JDK is often installed but not on PATH, so search before advising an install.
if (-not (Test-Command 'java')) {
  $javaRoots = @($env:JAVA_HOME, 'C:\Program Files', 'C:\Program Files (Arm)', 'C:\Program Files (x86)') |
               Where-Object { $_ -and (Test-Path $_) }
  $java = $null
  foreach ($root in $javaRoots) {
    $java = Get-ChildItem -Path $root -Filter 'java.exe' -Recurse -Depth 4 -ErrorAction SilentlyContinue |
            Select-Object -First 1
    if ($java) { break }
  }
  if ($java) {
    Write-Warn "A JDK is installed but not on the PATH: $($java.FullName)"
    Write-Warn "  `./mxcli.exe run --local` needs it there. To fix it for good:"
    Write-Warn "  setx PATH `"$(Split-Path -Parent $java.FullName);%PATH%`""
  } else {
    Write-Warn 'No JDK found. Running the app locally needs one matching the project:'
    Write-Warn '  winget install -e --id EclipseAdoptium.Temurin.21.JDK'
  }
}

if ($installExit -eq 0) {
  Write-Host ''
  Write-Ok 'Open your agent in the project folder and ask it for a feature:'
  Write-Host "      cd `"$Target`""
  Write-Host '      claude      (or codex, cursor, opencode, pi)'
}
exit $installExit
