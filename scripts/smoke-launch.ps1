$ErrorActionPreference = "Stop"
$exe = "C:\Users\amicu\ai-convoir\src-tauri\target\release\ai-convoir.exe"
if (-not (Test-Path $exe)) {
  Write-Output "MISSING_EXE"
  exit 1
}
$proc = Start-Process -FilePath $exe -PassThru
Start-Sleep -Seconds 5
if ($proc.HasExited) {
  Write-Output ("EXITED:" + $proc.ExitCode)
  exit 1
}
Write-Output ("RUNNING_PID:" + $proc.Id)
Stop-Process -Id $proc.Id -Force
Write-Output "STOPPED_CLEAN"
