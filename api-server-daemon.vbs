' SA-NAE POS - API Server daemon
' Starts sql-api-server.js with no visible window and keeps it alive.
' If it stops (crash / SQL Server restart) it is started again within 5 seconds.
' Everything it does is written to logs\api-server.log, because this window is
' hidden: without the log a crash on startup would look like "nothing happens".
Option Explicit

' If API_PORT in .env is changed from the default 8081, change this port too -
' otherwise the check below never sees the server and keeps starting a second copy.
Const HEALTH_URL = "http://127.0.0.1:8081/api/pos?action=ping"
Const MAX_LOG_BYTES = 2097152   ' 2 MB
Const FAST_EXIT_SECONDS = 10    ' a run shorter than this counts as "crashed on startup"
Const FAST_EXIT_LIMIT = 3       ' after this many crashes in a row, slow down and shout in the log

Dim shell, fso, baseDir, logDir, logFile, cmd
Dim fastExits, startedAt, ranSeconds, waitMs
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
logDir = baseDir & "\logs"
If Not fso.FolderExists(logDir) Then fso.CreateFolder(logDir)
logFile = logDir & "\api-server.log"

shell.CurrentDirectory = baseDir
cmd = "cmd /c node --env-file=.env """ & baseDir & "\sql-api-server.js"" >> """ & logFile & """ 2>&1"

' Append one timestamped line to the log
Sub WriteLog(message)
  Dim stream
  On Error Resume Next
  Set stream = fso.OpenTextFile(logFile, 8, True)
  If Err.Number = 0 Then
    stream.WriteLine "[" & Now & "] [daemon] " & message
    stream.Close
  End If
  Err.Clear
  On Error GoTo 0
End Sub

' True when an API Server already answers on port 8081.
' ?action=ping answers 200 even when the database is unreachable — that is on
' purpose here: this only asks "is the process alive", the database problem is
' reported by the ping body itself.
Function ServerIsUp()
  Dim http
  ServerIsUp = False
  On Error Resume Next
  Set http = CreateObject("MSXML2.XMLHTTP")
  http.Open "GET", HEALTH_URL, False
  http.Send
  If Err.Number = 0 Then
    If http.Status = 200 Then ServerIsUp = True
  End If
  Err.Clear
  On Error GoTo 0
End Function

' Keep the log from growing without bound
Sub TrimLog()
  On Error Resume Next
  If fso.FileExists(logFile) Then
    If fso.GetFile(logFile).Size > MAX_LOG_BYTES Then fso.DeleteFile logFile, True
  End If
  On Error GoTo 0
End Sub

' node.exe reachable from PATH?
Function NodeIsInstalled()
  NodeIsInstalled = (shell.Run("cmd /c where node", 0, True) = 0)
End Function

' Node 20+ is required: older versions do not understand --env-file and would
' start without any SQL_* value, failing on every request.
Function NodeIsNewEnough()
  NodeIsNewEnough = (shell.Run("cmd /c node -e ""process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)""", 0, True) = 0)
End Function

' Dependencies installed? Without node_modules, node dies immediately with
' "Cannot find package 'express'" and the loop below would just retry forever.
Function DepsInstalled()
  DepsInstalled = fso.FolderExists(baseDir & "\node_modules\mssql")
End Function

' ---- preflight: fail loudly in the log instead of restart-looping in silence ----
TrimLog

If Not fso.FileExists(baseDir & "\sql-api-server.js") Then
  WriteLog "STOP: sql-api-server.js not found in " & baseDir & " - put this .vbs in the project folder."
  WScript.Quit 1
End If

If Not fso.FileExists(baseDir & "\.env") Then
  WriteLog "STOP: .env not found - copy .env.example to .env and fill in the SQL_* values first."
  WScript.Quit 1
End If

If Not NodeIsInstalled() Then
  WriteLog "STOP: Node.js not found. Install it from https://nodejs.org, then run install-api-autostart.bat again."
  WScript.Quit 1
End If

If Not NodeIsNewEnough() Then
  WriteLog "STOP: Node.js is too old - version 20 or newer is required for --env-file."
  WScript.Quit 1
End If

If Not DepsInstalled() Then
  WriteLog "node_modules missing - running npm install (first time only, may take a few minutes)..."
  shell.Run "cmd /c npm install >> """ & logFile & """ 2>&1", 0, True
  If Not DepsInstalled() Then
    WriteLog "STOP: npm install failed. Check the internet connection, then run start-api.bat to see the error."
    WScript.Quit 1
  End If
  WriteLog "npm install finished."
End If

WriteLog "daemon started - watching " & HEALTH_URL

fastExits = 0
waitMs = 5000

Do
  If Not ServerIsUp() Then
    TrimLog
    startedAt = Timer
    ' 0 = hidden window, True = wait until node exits
    shell.Run cmd, 0, True
    ranSeconds = Timer - startedAt
    If ranSeconds < 0 Then ranSeconds = ranSeconds + 86400   ' Timer wrapped past midnight

    If ranSeconds < FAST_EXIT_SECONDS Then
      fastExits = fastExits + 1
      If fastExits = FAST_EXIT_LIMIT Then
        WriteLog "api server keeps exiting right after start - see the node error above this line, or run start-api.bat. Retrying every 60s from now on."
        waitMs = 60000
      End If
    Else
      If fastExits > 0 Then WriteLog "api server recovered after " & fastExits & " failed start(s)."
      fastExits = 0
      waitMs = 5000
    End If
  End If
  WScript.Sleep waitMs
Loop
