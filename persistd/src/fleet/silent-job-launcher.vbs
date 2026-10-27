Option Explicit
Dim sh, fs, dir, nodeExe, pathEntries, candidate, cmdline, exitCode, manifest
Set sh = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
If WScript.Arguments.Count <> 1 Then WScript.Quit 11
manifest = WScript.Arguments(0)
dir = fs.GetParentFolderName(WScript.ScriptFullName)
nodeExe = ""
pathEntries = Split(sh.ExpandEnvironmentStrings("%PATH%"), ";")
For Each candidate In pathEntries
  If Len(candidate) > 0 Then
    If fs.FileExists(fs.BuildPath(candidate, "node.exe")) Then
      nodeExe = fs.BuildPath(candidate, "node.exe")
      Exit For
    End If
  End If
Next
If nodeExe = "" Then WScript.Quit 10
cmdline = Chr(34) & nodeExe & Chr(34) & " " & Chr(34) & fs.BuildPath(dir, "silent-job-cli.js") & Chr(34) & " " & Chr(34) & manifest & Chr(34)
exitCode = sh.Run(cmdline, 0, True)
WScript.Quit exitCode
