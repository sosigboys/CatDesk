Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class InputLib {
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, int dwData, int dwExtraInfo);
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
}
"@
$MOUSEEVENTF_LEFTDOWN=2; $MOUSEEVENTF_LEFTUP=4; $MOUSEEVENTF_RIGHTDOWN=8; $MOUSEEVENTF_RIGHTUP=16
$MOUSEEVENTF_MIDDLEDOWN=32; $MOUSEEVENTF_MIDDLEUP=64; $MOUSEEVENTF_WHEEL=2048
$KEYEVENTF_KEYDOWN=0; $KEYEVENTF_KEYUP=2

Write-Output '{"status":"ready"}'
while ($true) {
  $line = [Console]::In.ReadLine()
  if (-not $line) { continue }
  try {
    $cmd = $line | ConvertFrom-Json
    switch ($cmd.action) {
      'move' { [InputLib]::SetCursorPos($cmd.x, $cmd.y) | Out-Null }
      'mousedown' {
        $f = @{left=$MOUSEEVENTF_LEFTDOWN;right=$MOUSEEVENTF_RIGHTDOWN;middle=$MOUSEEVENTF_MIDDLEDOWN}
        [InputLib]::mouse_event($f[$cmd.button], 0, 0, 0, 0)
      }
      'mouseup' {
        $f = @{left=$MOUSEEVENTF_LEFTUP;right=$MOUSEEVENTF_RIGHTUP;middle=$MOUSEEVENTF_MIDDLEUP}
        [InputLib]::mouse_event($f[$cmd.button], 0, 0, 0, 0)
      }
      'wheel' { [InputLib]::mouse_event($MOUSEEVENTF_WHEEL, 0, 0, [int]$cmd.delta, 0) }
      'keydown' { [InputLib]::keybd_event([byte]$cmd.vk, 0, $KEYEVENTF_KEYDOWN, 0) }
      'keyup' { [InputLib]::keybd_event([byte]$cmd.vk, 0, $KEYEVENTF_KEYUP, 0) }
      'quit' { break }
    }
    Write-Output '{"status":"ok"}'
  } catch { Write-Output '{"status":"error"}' }
}
