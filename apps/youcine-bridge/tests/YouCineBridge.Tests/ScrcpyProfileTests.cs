using YouCineBridge;

namespace YouCineBridge.Tests;

public sealed class ScrcpyProfileTests
{
    [Fact]
    public void Balanced_BuildArguments_ContainsCanonicalYouCineProfile()
    {
        var args = ScrcpyProfile.Balanced.BuildArguments("100.106.31.127:38177");
        Assert.Contains("--serial", args);
        Assert.Contains("100.106.31.127:38177", args);
        Assert.Contains("--new-display=1920x1080/240", args);
        Assert.Contains("--flex-display", args);
        Assert.Contains("--start-app=+com.world.youcinemobile", args);
        Assert.Contains("--no-vd-system-decorations", args);
        Assert.Contains("--audio-source=playback", args);
        Assert.Contains("--video-bit-rate=12M", args);
        Assert.Contains("--max-fps=60", args);
        Assert.Contains("--window-title=YouCine-PC", args);
        Assert.Contains("--fullscreen", args);
    }
}
