// Tomo Portable launcher (Tomo.exe at the top of the portable folder). Starts App\Tomo.exe; the app sees
// App\portable.json and keeps everything in Data\ next to this launcher (src/main/paths.ts portableRoot).
// Built by scripts/make-portable.mjs with the C# compiler that ships with Windows (.NET Framework 4).
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

static class Launcher
{
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int MessageBox(IntPtr hWnd, string text, string caption, uint type);

    [STAThread]
    static int Main(string[] args)
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string app = Path.Combine(root, "App");
        string exe = Path.Combine(app, "Tomo.exe");
        if (!File.Exists(exe))
        {
            MessageBox(IntPtr.Zero, "App\\Tomo.exe is missing. Extract the whole Tomo Portable folder again.", "Tomo Portable", 0x10);
            return 1;
        }
        var line = new StringBuilder();
        foreach (string a in args)
        {
            if (line.Length > 0) line.Append(' ');
            line.Append('"').Append(a.Replace("\"", "\\\"")).Append('"');
        }
        Process.Start(new ProcessStartInfo(exe, line.ToString()) { UseShellExecute = false, WorkingDirectory = app });
        return 0;
    }
}
