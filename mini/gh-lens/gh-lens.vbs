' ============================================================
'  gh-lens.vbs - start gh-lens WITHOUT a console window.
'
'  Double-click this (or a shortcut to it) instead of serve.cmd.
'  It starts the server hidden, waits until it answers, then opens
'  the browser. If gh-lens is already running it just opens a tab.
'
'  Differences from serve.cmd:
'    - no black window that must stay open
'    - starting twice never shows an error
'    - server output goes to logs\server.log instead of the console
'
'  To see live logs, use serve.cmd instead.
'  To stop the server: use the "Stop server" button in the page footer.
'
'  Keep this file ASCII-only: WSH reads .vbs in the ANSI code page.
' ============================================================
Option Explicit

Dim fso, sh, dir, nodePath, port, url, logDir, logFile, cmdLine, i, up

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

dir = fso.GetParentFolderName(WScript.ScriptFullName)

If Not fso.FileExists(dir & "\server.mjs") Then
  MsgBox "server.mjs was not found next to this script:" & vbCrLf & dir, 16, "gh-lens"
  WScript.Quit 1
End If

port = sh.ExpandEnvironmentStrings("%GHLENS_PORT%")
If port = "%GHLENS_PORT%" Or port = "" Then port = "8787"
url = "http://127.0.0.1:" & port

nodePath = FindNode()
If nodePath = "" Then
  MsgBox "Node.js was not found." & vbCrLf & vbCrLf & _
         "Install Node.js 22.19+ or 24+, or run serve.cmd to see the error in a console.", 16, "gh-lens"
  WScript.Quit 1
End If

' Already running? Just open a tab.
If IsGhLens(url) Then
  OpenUrl url
  WScript.Quit 0
End If

logDir = dir & "\logs"
If Not fso.FolderExists(logDir) Then fso.CreateFolder(logDir)
logFile = logDir & "\server.log"
If fso.FileExists(logFile) Then
  If fso.GetFile(logFile).Size > 4194304 Then
    On Error Resume Next
    fso.DeleteFile logFile, True
    On Error GoTo 0
  End If
End If

sh.CurrentDirectory = dir

' Hidden launch: window style 0, do not wait.
' GHLENS_NO_OPEN=1 because THIS script opens the browser after the port answers.
cmdLine = "cmd /c set ""GHLENS_NO_OPEN=1"" && set ""GHLENS_LOG_FILE=" & logFile & """ && """ & _
          nodePath & """ """ & dir & "\server.mjs"""
sh.Run cmdLine, 0, False

up = False
For i = 1 To 60
  WScript.Sleep 250
  If IsGhLens(url) Then
    up = True
    Exit For
  End If
Next

If up Then
  OpenUrl url
Else
  MsgBox "gh-lens did not answer within 15 seconds." & vbCrLf & vbCrLf & _
         "Log file:" & vbCrLf & logFile & vbCrLf & vbCrLf & _
         "Run serve.cmd to watch the messages live.", 48, "gh-lens"
End If


' ---------------------------------------------------------- helpers
Function FindNode()
  Dim ex, p
  FindNode = ""
  On Error Resume Next

  Set ex = sh.Exec("cmd /c where node 2>nul")
  If Err.Number = 0 Then
    Do While Not ex.StdOut.AtEndOfStream
      p = Trim(ex.StdOut.ReadLine())
      If p <> "" Then
        If fso.FileExists(p) Then
          FindNode = p
          Exit Function
        End If
      End If
    Loop
  End If
  Err.Clear

  p = sh.ExpandEnvironmentStrings("%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe")
  If fso.FileExists(p) Then
    FindNode = p
    Exit Function
  End If

  p = sh.ExpandEnvironmentStrings("%ProgramFiles%\nodejs\node.exe")
  If fso.FileExists(p) Then
    FindNode = p
    Exit Function
  End If

  On Error GoTo 0
End Function

Function IsGhLens(u)
  Dim h
  IsGhLens = False
  On Error Resume Next
  Set h = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  h.setTimeouts 800, 800, 800, 1500
  h.open "GET", u & "/api/status", False
  h.send
  If Err.Number = 0 Then
    If h.status = 200 Then
      If InStr(h.responseText, "maxAttempts") > 0 Then IsGhLens = True
    End If
  End If
  Err.Clear
  On Error GoTo 0
  Set h = Nothing
End Function

Sub OpenUrl(u)
  On Error Resume Next
  sh.Run "cmd /c start """" """ & u & """", 0, False
  If Err.Number <> 0 Then
    Err.Clear
    sh.Run "rundll32 url.dll,FileProtocolHandler " & u, 0, False
  End If
  On Error GoTo 0
End Sub
