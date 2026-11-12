param(
    [switch]$Install,
    [switch]$Uninstall,
    [switch]$Force,
    [switch]$Scheduled,
    [string]$Config = (Join-Path $env:USERPROFILE '.melonapp\home-backup.json'),
    [string]$TaskName = 'MelonApp Home Backup'
)

$ErrorActionPreference = 'Stop'
$Sftp = Join-Path $env:SystemRoot 'System32\OpenSSH\sftp.exe'
$DumpPattern = '^melon-\d{8}T\d{6}Z\.dump$'

function Read-Settings {
    if (-not (Test-Path $Config)) { throw "Konfiguration fehlt: $Config (Vorlage: deploy/home-backup.example.json)" }
    $c = Get-Content $Config -Raw | ConvertFrom-Json
    foreach ($name in 'Host', 'User', 'Key') {
        if (-not $c.$name) { throw "In $Config fehlt '$name'." }
    }
    [pscustomobject]@{
        Host         = $c.Host
        User         = $c.User
        Key          = $c.Key
        Port         = $(if ($c.Port) { [int]$c.Port } else { 23 })
        RemoteDir    = $(if ($c.RemoteDir) { $c.RemoteDir } else { '.' })
        Target       = $(if ($c.Target) { $c.Target } else { Join-Path $env:USERPROFILE 'MelonApp-Backups' })
        KnownHosts   = $(if ($c.KnownHosts) { $c.KnownHosts } else { Join-Path $env:USERPROFILE '.ssh\known_hosts' })
        IntervalDays = $(if ($c.IntervalDays) { [int]$c.IntervalDays } else { 30 })
        Keep         = $(if ($c.Keep) { [int]$c.Keep } else { 12 })
    }
}

function Invoke-Sftp($s, [string[]]$Commands) {
    $batch = [IO.Path]::GetTempFileName()
    $out = [IO.Path]::GetTempFileName()
    $err = [IO.Path]::GetTempFileName()
    try {
        [IO.File]::WriteAllLines($batch, $Commands)
        $sftpArgs = @('-q', '-b', "`"$batch`"", '-P', $s.Port, '-i', "`"$($s.Key)`"",
            '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', "`"UserKnownHostsFile=$($s.KnownHosts)`"",
            "$($s.User)@$($s.Host)")
        $p = Start-Process -FilePath $Sftp -ArgumentList $sftpArgs -NoNewWindow -Wait -PassThru `
            -RedirectStandardOutput $out -RedirectStandardError $err
        if ($p.ExitCode -ne 0) { throw "sftp ist fehlgeschlagen ($($p.ExitCode)): $((Get-Content $err -Raw))".Trim() }
        Get-Content $out
    }
    finally {
        Remove-Item $batch, $out, $err -ErrorAction SilentlyContinue
    }
}

function Write-Log($s, [string]$Text) {
    New-Item -ItemType Directory -Force -Path $s.Target | Out-Null
    Add-Content -Path (Join-Path $s.Target 'home-backup.log') -Value "$((Get-Date).ToString('s')) $Text"
}

function Test-Dump([string]$Path) {
    $bytes = New-Object byte[] 5
    $stream = [IO.File]::OpenRead($Path)
    try { $read = $stream.Read($bytes, 0, 5) } finally { $stream.Dispose() }
    $read -eq 5 -and [Text.Encoding]::ASCII.GetString($bytes) -eq 'PGDMP'
}

function Invoke-Backup {
    $s = Read-Settings
    New-Item -ItemType Directory -Force -Path $s.Target | Out-Null
    $marker = Join-Path $s.Target '.last-success'
    if (-not $Force -and (Test-Path $marker)) {
        $last = [datetime]::Parse((Get-Content $marker -Raw).Trim(), [Globalization.CultureInfo]::InvariantCulture)
        if (((Get-Date) - $last).TotalDays -lt $s.IntervalDays) { return 'skipped' }
    }

    $listing = Invoke-Sftp $s @("cd `"$($s.RemoteDir)`"", 'ls -1')
    $newest = $listing | ForEach-Object { ($_ -split '/')[-1].Trim() } | Where-Object { $_ -match $DumpPattern } |
        Sort-Object -Descending | Select-Object -First 1
    if (-not $newest) { throw "Auf $($s.Host) liegt kein Backup (melon-*.dump)." }

    $final = Join-Path $s.Target $newest
    if (-not (Test-Path $final)) {
        $partial = "$final.part"
        Invoke-Sftp $s @("cd `"$($s.RemoteDir)`"", "get `"$newest`" `"$partial`"") | Out-Null
        if (-not (Test-Dump $partial)) {
            Remove-Item $partial -ErrorAction SilentlyContinue
            throw "$newest ist kein gültiges PostgreSQL-Backup."
        }
        Move-Item $partial $final -Force
    }

    Get-ChildItem $s.Target -Filter 'melon-*.dump' | Where-Object { $_.Name -match $DumpPattern } |
        Sort-Object Name -Descending | Select-Object -Skip $s.Keep | Remove-Item
    (Get-Date).ToString('o', [Globalization.CultureInfo]::InvariantCulture) | Set-Content $marker
    Write-Log $s "ok $newest"
    $newest
}

function Install-Task {
    $script = $PSCommandPath
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
        -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`" -Scheduled -Config `"$Config`""
    $triggers = @(
        (New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"),
        (New-ScheduledTaskTrigger -Daily -At '12:00')
    )
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Settings $settings `
        -Principal $principal -Description 'Holt alle 30 Tage das neueste MelonApp-Backup von der Storage Box.' -Force | Out-Null
    "Aufgabe '$TaskName' eingerichtet."
}

if ($Uninstall) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    "Aufgabe '$TaskName' entfernt."
    return
}
if ($Install) {
    Install-Task
    return
}

try {
    $result = Invoke-Backup
    if ($result -eq 'skipped') { 'Letztes Backup ist noch keine 30 Tage alt, nichts zu tun.' } else { "Backup geholt: $result" }
}
catch {
    $message = $_.Exception.Message
    try { Write-Log (Read-Settings) "error $message" } catch { }
    if ($Scheduled) {
        (New-Object -ComObject WScript.Shell).Popup("Das MelonApp-Backup konnte nicht geholt werden:`n`n$message", 0, 'MelonApp Backup', 48) | Out-Null
    }
    Write-Error $message
    exit 1
}
