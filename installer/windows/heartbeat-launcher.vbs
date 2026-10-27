Option Explicit
Dim sh, fs, dir, file, nodeExe, cmdline, exitCode
Set sh = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
dir = fs.GetParentFolderName(WScript.ScriptFullName)
file = fs.BuildPath(dir, "node-path.txt")
If Not fs.FileExists(file) Then WScript.Quit 10
Dim reader
Set reader = fs.OpenTextFile(file, 1)
nodeExe = Trim(reader.ReadAll)
reader.Close
If Not fs.FileExists(nodeExe) Then WScript.Quit 11
cmdline = Chr(34) & nodeExe & Chr(34) & " " & Chr(34) & fs.BuildPath(dir, "agent-bootstrap.js") & Chr(34)
exitCode = sh.Run(cmdline, 0, True)
WScript.Quit exitCode