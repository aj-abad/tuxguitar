using System.Text;
using System.Text.Json;
using System.Threading.Channels;

namespace Tabbycat.Audio;

internal static class Program
{
    public static async Task<int> Main(string[] args)
    {
        Console.InputEncoding = new UTF8Encoding(false);
        Console.OutputEncoding = new UTF8Encoding(false);
        try
        {
            var soundFont = args.Length > 0 ? args[0] : Path.Combine(AppContext.BaseDirectory, "GeneralUser.sf2");
            using var engine = new PlaybackEngine(soundFont);
            var sampleRate = await engine.Ready;
            Console.Error.WriteLine($"[audio] .NET / MeltySynth / SDL, {sampleRate} Hz stereo");
            Write(new { @event = "ready" });
            using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(50));
            var pulse = timer.WaitForNextTickAsync().AsTask();
            // Console's synchronized reader can block even through ReadLineAsync.
            // Keep stdin on its own thread so an idle controller cannot stop ticks.
            var lines = Channel.CreateBounded<string>(16);
            var reader = new Thread(() =>
            {
                try
                {
                    while (Console.ReadLine() is { } line)
                        lines.Writer.WriteAsync(line).AsTask().GetAwaiter().GetResult();
                    lines.Writer.TryComplete();
                }
                catch (Exception error) { lines.Writer.TryComplete(error); }
            }) { Name = "Tabbycat audio input", IsBackground = true };
            reader.Start();
            var input = lines.Reader.WaitToReadAsync().AsTask();
            while (true)
            {
                await Task.WhenAny(input, pulse, engine.Completion);
                if (engine.Completion.IsCompleted) await engine.Completion;
                if (input.IsCompleted)
                {
                    if (!await input) break;
                    var line = await lines.Reader.ReadAsync();
                    if (!string.IsNullOrWhiteSpace(line)) await Handle(line, engine, sampleRate);
                    input = lines.Reader.WaitToReadAsync().AsTask();
                }
                if (pulse.IsCompleted)
                {
                    var report = engine.ReadReport();
                    if (report.Ended) Write(new { @event = "playbackEnded" });
                    else if (report.Playing) Write(new { @event = "tick", qtick = report.Tick, bpm = report.Bpm });
                    pulse = timer.WaitForNextTickAsync().AsTask();
                }
            }
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine($"[audio] {error.Message}");
            return 1;
        }
    }

    private static async Task Handle(string line, PlaybackEngine engine, int sampleRate)
    {
        long? id = null;
        try
        {
            using var document = JsonDocument.Parse(line);
            var request = document.RootElement;
            id = request.GetProperty("id").GetInt64();
            var method = request.GetProperty("method").GetString();
            switch (method)
            {
                case "synth.load":
                    await engine.Execute(method, Schedule.Parse(request.GetProperty("params"), sampleRate));
                    break;
                case "synth.play":
                    var tick = request.TryGetProperty("params", out var parameters) &&
                        parameters.TryGetProperty("from_tick", out var from) ? from.GetInt64() : 0;
                    await engine.Execute(method, tick: ValidateTick(tick));
                    break;
                case "synth.seek":
                    await engine.Execute(method, tick: ValidateTick(request.GetProperty("params").GetProperty("tick").GetInt64()));
                    break;
                case "synth.stop":
                    await engine.Execute(method);
                    break;
                default:
                    throw new ArgumentException($"Unknown method: {method}");
            }
            Write(new { id, result = (object?)null });
        }
        catch (Exception error) when (error is JsonException or ArgumentException or KeyNotFoundException or InvalidOperationException or FormatException or OverflowException)
        {
            if (id is not null) Write(new { id, error = error.Message });
            else Console.Error.WriteLine($"[audio] Invalid request: {error.Message}");
        }
    }

    private static long ValidateTick(long tick)
    {
        if (tick < 0 || tick > int.MaxValue) throw new ArgumentException("Tick must be between zero and 2147483647.");
        return tick;
    }

    private static void Write<T>(T message)
    {
        // One writer owns stdout; diagnostic messages belong on stderr.
        Console.WriteLine(JsonSerializer.Serialize(message));
        Console.Out.Flush();
    }
}
