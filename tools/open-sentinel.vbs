' Opens the Sentinel console (job search + security) with one double-click: the desktop shortcut "Sentinel Console" runs this.
' If the console is not running yet, it starts it in the background (no window; output in logs\sentinel.log),
' waits until it answers, then opens http://127.0.0.1:7777 in the default browser. Nothing to type.
Option Explicit
Dim sh, fso, root, url, i
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
url = "http://127.0.0.1:7777/"

Function ConsoleUp()
  Dim http
  ConsoleUp = False
  On Error Resume Next
  Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  http.setTimeouts 1000, 1000, 2000, 2000
  http.open "GET", url, False
  http.send
  If Err.Number = 0 Then If http.status = 200 Then ConsoleUp = True
  On Error GoTo 0
End Function

If Not ConsoleUp() Then
  If Not fso.FolderExists(root & "\logs") Then fso.CreateFolder root & "\logs"
  sh.CurrentDirectory = root
  sh.Run "cmd /c """"C:\Program Files\nodejs\node.exe"" redteam\server.js >> logs\sentinel.log 2>&1""", 0, False
  For i = 1 To 40
    WScript.Sleep 500
    If ConsoleUp() Then Exit For
  Next
  If Not ConsoleUp() Then
    MsgBox "The Sentinel console did not start. Details: " & root & "\logs\sentinel.log", vbExclamation, "Sentinel"
    WScript.Quit 1
  End If
End If
sh.Run url & "#today", 1, False
