using YouCineBridge;

namespace YouCineBridge.Tests;

public sealed class HotkeyControllerTests
{
    [Theory]
    [InlineData(1, true, BridgeHotkey.TogglePip)]
    [InlineData(2, true, BridgeHotkey.Focus)]
    [InlineData(3, true, BridgeHotkey.Reconnect)]
    public void ResolveAction_MapsRegisteredIds(int id, bool focused, BridgeHotkey expected)
    {
        Assert.Equal(expected, HotkeyController.ResolveAction(id, focused));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void ResolveAction_LeavesF11ToScrcpy(bool focused)
    {
        Assert.Null(HotkeyController.ResolveAction(4, focused));
    }

    [Fact]
    public void RegisterAvailable_ContinuesAfterAConflict()
    {
        var attempted = new List<int>();
        var bindings = new (int Id, uint Modifiers, uint Key)[]
        {
            (1, 3, 0x50),
            (2, 3, 0x59),
            (3, 3, 0x52)
        };

        var unavailable = HotkeyController.RegisterAvailable(
            bindings,
            (id, _, _) =>
            {
                attempted.Add(id);
                return id != 1;
            });

        Assert.Equal(new[] { 1, 2, 3 }, attempted);
        Assert.Equal(new[] { 1 }, unavailable);
    }
}
