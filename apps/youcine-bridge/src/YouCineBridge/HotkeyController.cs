using System.Runtime.InteropServices;

namespace YouCineBridge;

public enum BridgeHotkey
{
    TogglePip,
    Focus,
    Reconnect,
    ToggleFullscreen
}

public sealed class HotkeyController : IDisposable
{
    private const int WmHotkey = 0x0312;
    private const uint ModControlAlt = 0x0003;
    private readonly Action<BridgeHotkey> _dispatch;
    private readonly Func<bool> _isYouCineFocused;
    private readonly Action<int, int>? _registrationFailure;
    private readonly HotkeyWindow _window;
    private bool _started;

    public HotkeyController(
        Action<BridgeHotkey> dispatch,
        Func<bool> isYouCineFocused,
        Action<int, int>? registrationFailure = null)
    {
        _dispatch = dispatch;
        _isYouCineFocused = isYouCineFocused;
        _registrationFailure = registrationFailure;
        _window = new HotkeyWindow(HandleHotkey);
    }

    public static BridgeHotkey? ResolveAction(int id, bool youCineFocused) => id switch
    {
        1 => BridgeHotkey.TogglePip,
        2 => BridgeHotkey.Focus,
        3 => BridgeHotkey.Reconnect,
        _ => null
    };

    public static IReadOnlyList<int> RegisterAvailable(
        IEnumerable<(int Id, uint Modifiers, uint Key)> bindings,
        Func<int, uint, uint, bool> tryRegister)
    {
        var unavailable = new List<int>();
        foreach (var binding in bindings)
        {
            if (!tryRegister(binding.Id, binding.Modifiers, binding.Key))
                unavailable.Add(binding.Id);
        }
        return unavailable;
    }

    public void Start()
    {
        if (_started) return;

        RegisterAvailable(
            new (int Id, uint Modifiers, uint Key)[]
            {
                (1, ModControlAlt, (uint)Keys.P),
                (2, ModControlAlt, (uint)Keys.Y),
                (3, ModControlAlt, (uint)Keys.R)
            },
            TryRegister);

        _started = true;
    }

    private bool TryRegister(int id, uint modifiers, uint key)
    {
        if (RegisterHotKey(_window.Handle, id, modifiers, key)) return true;
        _registrationFailure?.Invoke(id, Marshal.GetLastWin32Error());
        return false;
    }

    private void HandleHotkey(int id)
    {
        var action = ResolveAction(id, _isYouCineFocused());
        if (action is BridgeHotkey value) _dispatch(value);
    }


    public void Dispose()
    {
        for (var id = 1; id <= 3; id++) UnregisterHotKey(_window.Handle, id);
        _window.Dispose();
    }

    private sealed class HotkeyWindow : NativeWindow, IDisposable
    {
        private readonly Action<int> _handler;

        public HotkeyWindow(Action<int> handler)
        {
            _handler = handler;
            CreateHandle(new CreateParams
            {
                Caption = "YouCineBridge.Hotkeys",
                Parent = new IntPtr(-3)
            });
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == WmHotkey) _handler(m.WParam.ToInt32());
            base.WndProc(ref m);
        }

        public void Dispose() => DestroyHandle();
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

    [DllImport("user32.dll")]
    private static extern bool UnregisterHotKey(IntPtr hWnd, int id);
}
