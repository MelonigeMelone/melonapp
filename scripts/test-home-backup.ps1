param([string]$Script = (Join-Path $PSScriptRoot 'home-backup.ps1'))
$ErrorActionPreference = 'Stop'
$ast = [Management.Automation.Language.Parser]::ParseFile($Script, [ref]$null, [ref]$null)
$DumpPattern = '^melon-\d{8}T\d{6}Z\.dump\.age$'
foreach ($f in $ast.FindAll({ $args[0] -is [Management.Automation.Language.FunctionDefinitionAst] -and $args[0].Name -in 'Get-DumpTime', 'Select-Newest' }, $true)) {
    . ([scriptblock]::Create($f.Extent.Text))
}
$now = [datetime]::new(2026, 11, 17, 12, 0, 0, [DateTimeKind]::Utc)
function Expect-Throw($block, $like) {
    try { & $block; throw "expected an error like '$like'" } catch { if ($_.Exception.Message -notlike "*$like*") { throw "wrong error: $($_.Exception.Message)" } }
}
$ok = Select-Newest @('melon-20261116T033000Z.dump.age', 'melon-20261117T033000Z.dump.age', 'readme.txt') $now 7
if ($ok -ne 'melon-20261117T033000Z.dump.age') { throw "picked $ok" }
Expect-Throw { Select-Newest @('melon-20261117T033000Z.dump.age', 'melon-29991231T000000Z.dump.age') $now 7 } 'Zukunft'
Expect-Throw { Select-Newest @('melon-20261117T033000Z.dump.age', 'melon-20261399T000000Z.dump.age') $now 7 } 'ungültigem Datum'
Expect-Throw { Select-Newest @('melon-20261001T033000Z.dump.age') $now 7 } 'Tage alt'
Expect-Throw { Select-Newest @('other.txt') $now 7 } 'kein verschlüsseltes Backup'
$single = Select-Newest @('melon-20261117T033000Z.dump.age') $now 7
if ($single -ne 'melon-20261117T033000Z.dump.age') { throw "single: $single" }
'home-backup selection: ok'
