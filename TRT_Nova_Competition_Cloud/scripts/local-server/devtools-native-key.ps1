param([ValidateSet('activate','capture','click','BACKSPACE','ENTER')][string]$Action, [long]$ExpectedHandle = 0, [string]$OutputPath = '', [int]$X = 0, [int]$Y = 0)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class NovaNativeKeyWindow {
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int n);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
 [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
 [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect r);
 [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint d, UIntPtr e);
}
'@
$windows = @(Get-Process | Where-Object { $_.Path -like 'D:\D\微信web开发者工具\*' -and $_.MainWindowHandle -ne 0 })
if ($windows.Count -ne 1) { throw '必须只有一个经过路径核对的开发者工具窗口，停止键盘测试' }
$targetHandle = $windows[0].MainWindowHandle.ToInt64()
if ($Action -ne 'activate' -and $ExpectedHandle -ne $targetHandle) { throw '开发者工具窗口已变化，停止键盘测试' }
if ($Action -eq 'activate' -or [NovaNativeKeyWindow]::GetForegroundWindow().ToInt64() -ne $targetHandle) {
  [NovaNativeKeyWindow]::ShowWindowAsync([IntPtr]$targetHandle, 9) | Out-Null
  $taskShell = New-Object -ComObject WScript.Shell
  $taskShell.AppActivate($windows[0].Id) | Out-Null
  [NovaNativeKeyWindow]::SetForegroundWindow([IntPtr]$targetHandle) | Out-Null
  Start-Sleep -Milliseconds 200
  if ([NovaNativeKeyWindow]::GetForegroundWindow().ToInt64() -ne $targetHandle) {
    [uint32]$foregroundProcess = 0
    $foregroundThread = [NovaNativeKeyWindow]::GetWindowThreadProcessId([NovaNativeKeyWindow]::GetForegroundWindow(), [ref]$foregroundProcess)
    $currentThread = [NovaNativeKeyWindow]::GetCurrentThreadId()
    $attached = [NovaNativeKeyWindow]::AttachThreadInput($currentThread, $foregroundThread, $true)
    try { [NovaNativeKeyWindow]::SetForegroundWindow([IntPtr]$targetHandle) | Out-Null }
    finally { if ($attached) { [NovaNativeKeyWindow]::AttachThreadInput($currentThread, $foregroundThread, $false) | Out-Null } }
  }
}
if ([NovaNativeKeyWindow]::GetForegroundWindow().ToInt64() -ne $targetHandle) { throw '前台不再是目标开发者工具，未发送按键' }
if ($Action -in @('capture','click')) {
  [NovaNativeKeyWindow]::SetProcessDPIAware() | Out-Null
  $rect = New-Object NovaNativeKeyWindow+Rect
  [NovaNativeKeyWindow]::GetWindowRect([IntPtr]$targetHandle, [ref]$rect) | Out-Null
  if ($Action -eq 'capture') {
    Add-Type -AssemblyName System.Drawing
    $bitmap = [System.Drawing.Bitmap]::new($rect.Right-$rect.Left,$rect.Bottom-$rect.Top)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $dc = $graphics.GetHdc()
    try { [NovaNativeKeyWindow]::PrintWindow([IntPtr]$targetHandle,$dc,2) | Out-Null }
    finally { $graphics.ReleaseHdc($dc); $graphics.Dispose() }
    try { $bitmap.Save($OutputPath,[System.Drawing.Imaging.ImageFormat]::Png) } finally { $bitmap.Dispose() }
  } else {
    if ($X -le 0 -or $Y -le 0 -or $X -ge ($rect.Right-$rect.Left) -or $Y -ge ($rect.Bottom-$rect.Top)) { throw '点击坐标不在已核对的窗口内' }
    [NovaNativeKeyWindow]::SetCursorPos($rect.Left+$X,$rect.Top+$Y) | Out-Null
    [NovaNativeKeyWindow]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
    [NovaNativeKeyWindow]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
  }
} elseif ($Action -ne 'activate') {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.SendKeys]::SendWait('{' + $Action + '}')
}
Write-Output $targetHandle
