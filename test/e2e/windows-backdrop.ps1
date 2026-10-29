param([long]$WindowHandle)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class TabBackdropProbe {
  [DllImport("dwmapi.dll")]
  public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out int value, int size);
}
'@
$material = 0
$result = [TabBackdropProbe]::DwmGetWindowAttribute([IntPtr]$WindowHandle, 38, [ref]$material, 4)
if ($result -ne 0) { throw "DWM backdrop query failed: $result" }
Write-Output $material
