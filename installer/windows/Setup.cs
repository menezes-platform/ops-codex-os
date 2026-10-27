using System;
using System.IO;
using System.IO.Compression;
using System.Diagnostics;
using System.Reflection;
using System.Collections.Generic;

internal static class FleetSetup {
  static string Quote(string value) {
    if (value.IndexOfAny(new char[]{'\r','\n','\0'}) >= 0) throw new ArgumentException("invalid argument");
    return "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
  }
  static int Main(string[] args) {
    if (Array.Exists(args, x => x == "--help" || x == "/?")) {
      Console.WriteLine("Gabriel Fleet Runner Setup for Windows");
      Console.WriteLine("Optional arguments: -NodeId node-id -BaseUrl https://your-persistflow -InstallDir C:\\path -SkipTask");
      Console.WriteLine("Requires Node.js 22-24. This does not enroll or enable remote task routing on the authority.");
      return 0;
    }
    string tempDir = Path.Combine(Path.GetTempPath(), "GabrielFleetSetup-" + Guid.NewGuid().ToString("N"));
    try {
      Directory.CreateDirectory(tempDir);
      using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("fleet_bundle")) {
        if (stream == null) throw new Exception("Embedded Fleet bundle missing");
        using (var zip = new ZipArchive(stream, ZipArchiveMode.Read)) {
          foreach (var entry in zip.Entries) {
            if (String.IsNullOrEmpty(entry.Name)) continue;
            var name = entry.FullName.Replace('/', Path.DirectorySeparatorChar);
            var target = Path.GetFullPath(Path.Combine(tempDir, name));
            if (!target.StartsWith(Path.GetFullPath(tempDir) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
              throw new Exception("Invalid bundle entry");
            Directory.CreateDirectory(Path.GetDirectoryName(target));
            using (var input = entry.Open()) using (var output = File.Create(target)) input.CopyTo(output);
          }
        }
      }
      var installer = Path.Combine(tempDir,"Install-FleetRunner.ps1");
      if (!File.Exists(installer)) throw new Exception("Installer script missing");
      var info = new ProcessStartInfo("powershell.exe");
      info.UseShellExecute = false;
      info.Arguments = "-NoProfile -ExecutionPolicy Bypass -File " + Quote(installer);
      foreach (var arg in args) info.Arguments += " " + Quote(arg);
      using (var proc = Process.Start(info)) { proc.WaitForExit(); return proc.ExitCode; }
    } catch(Exception ex) {
      Console.Error.WriteLine("Fleet setup failed: " + ex.Message);
      return 1;
    } finally {
      try { Directory.Delete(tempDir,true); } catch { /* retain temporary files for OS cleanup if locked */ }
    }
  }
}