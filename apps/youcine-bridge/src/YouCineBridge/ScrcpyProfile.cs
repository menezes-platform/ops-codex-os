namespace YouCineBridge;

public sealed record ScrcpyProfile(
    string Display,
    int MaxFps,
    string VideoBitRate,
    bool Fullscreen)
{
    public static ScrcpyProfile Balanced { get; } = new("1920x1080/240", 60, "12M", true);

    public IReadOnlyList<string> BuildArguments(string endpoint)
    {
        var args = new List<string>
        {
            "--serial", endpoint,
            $"--new-display={Display}",
            "--flex-display",
            "--start-app=+com.world.youcinemobile",
            "--no-vd-system-decorations",
            "--audio-source=playback",
            $"--video-bit-rate={VideoBitRate}",
            $"--max-fps={MaxFps}",
            "--window-title=YouCine-PC"
        };
        if (Fullscreen) args.Add("--fullscreen");
        return args;
    }
}
