# Windows 平台矩阵入口（Windows 专门版本立项后启用；v1 macOS 先行，PRD §1.1）。
# 用法：powershell -File run-platform-windows.ps1 -Suite file-lifecycle -Output <evidence.json>
param(
  [string]$Suite = "all",
  [string]$Output = ""
)

Write-Output "windows platform suite=$Suite output=$Output"
Write-Output "BLOCKED - v1 is macOS-first (PRD 1.1, G1 2026-08-26). This entry activates with the dedicated Windows version."
exit 1
