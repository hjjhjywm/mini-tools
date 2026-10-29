' ============================================================
'  install-shortcut.vbs - put a "gh-lens" shortcut on the Desktop.
'
'  Double-click this once. Usage:
'     install-shortcut.vbs            -> Desktop shortcut
'     install-shortcut.vbs startup    -> also put it in the Startup folder
'  (to pass "startup" without the console: create a copy and edit the
'   first argument below, or run:  wscript install-shortcut.vbs startup)
'
'  Keep this file ASCII-only: WSH reads .vbs in the ANSI code page.
' ============================================================
Option Explicit

Dim fso, sh, dir, target, nodeIcon, lnkPath, lnk, wantStartup

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

dir = fso.GetParentFolderName(WScript.ScriptFullName)
target = dir & "\gh-lens.vbs"

If Not fso.FileExists(target) Then
  MsgBox "gh-lens.vbs was not found next to this script:" & vbCrLf & dir, 16, "gh-lens"
  WScript.Quit 1
End If

nodeIcon = IconSource()
wantStartup = False
If WScript.Arguments.Count > 0 Then
  If LCase(Trim(WScript.Arguments(0))) = "startup" Then wantStartup = True
End If

' --- Desktop shortcut ---
lnkPath = sh.SpecialFolders("Desktop") & "\gh-lens.lnk"
Set lnk = sh.CreateShortcut(lnkPath)
lnk.TargetPath = target
lnk.WorkingDirectory = dir
lnk.Description = "gh-lens - cached GitHub browser (no console window)"
lnk.IconLocation = nodeIcon
lnk.WindowStyle = 1
lnk.Save

MsgBox "Desktop shortcut created:" & vbCrLf & lnkPath, 64, "gh-lens"

' --- Optional: run at login ---
If wantStartup Then
  lnkPath = sh.SpecialFolders("Startup") & "\gh-lens.lnk"
  Set lnk = sh.CreateShortcut(lnkPath)
  lnk.TargetPath = target
  lnk.WorkingDirectory = dir
  lnk.Description = "gh-lens - start at login"
  lnk.IconLocation = nodeIcon
  lnk.WindowStyle = 1
  lnk.Save
  MsgBox "Startup shortcut created (gh-lens will start at every login):" & vbCrLf & lnkPath, 64, "gh-lens"
End If


' ---------------------------------------------------------- helpers
Function IconSource()
  Dim p
  IconSource = sh.ExpandEnvironmentStrings("%SystemRoot%\System32\shell32.dll") & ",13"
  On Error Resume Next
  p = sh.ExpandEnvironmentStrings("%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe")
  If fso.FileExists(p) Then
    IconSource = p & ",0"
    Exit Function
  End If
  p = sh.ExpandEnvironmentStrings("%ProgramFiles%\nodejs\node.exe")
  If fso.FileExists(p) Then IconSource = p & ",0"
  On Error GoTo 0
End Function
