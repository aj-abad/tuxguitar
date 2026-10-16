using System.Collections.Concurrent;

namespace Tabbycat.Audio;

public readonly record struct PlaybackReport(long Tick, double Bpm, bool Playing, bool Ended);

internal sealed class PlaybackEngine : IDisposable
{
    private sealed record Command(string Method, Schedule? Schedule, long Tick, TaskCompletionSource Done);
    private readonly BlockingCollection<Command> commands = new(16);
    private readonly TaskCompletionSource<int> ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly TaskCompletionSource completion = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly object reportLock = new();
    private readonly Thread worker;
    private PlaybackReport report = new(0, 120, false, false);
    public Task<int> Ready => ready.Task;
    public Task Completion => completion.Task;

    public PlaybackEngine(string soundFont)
    {
        worker = new Thread(() => Run(soundFont)) { Name = "Tabbycat audio", IsBackground = true };
        worker.Start();
    }

    public Task Execute(string method, Schedule? schedule = null, long tick = 0)
    {
        if (completion.Task.IsCompleted) return Task.FromException(new IOException("Audio output has stopped."));
        var done = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        commands.Add(new(method, schedule, tick, done));
        return done.Task;
    }

    public PlaybackReport ReadReport()
    {
        lock (reportLock)
        {
            var result = report;
            report = report with { Ended = false };
            return result;
        }
    }

    private void Publish(Schedule schedule, long frame, bool playing, bool ended = false, bool resetEnd = false)
    {
        var (tick, bpm) = schedule.Position(frame);
        lock (reportLock) report = new(tick, bpm, playing, ended || (!resetEnd && report.Ended));
    }

    private void Run(string soundFont)
    {
        Exception? failure = null;
        Command? active = null;
        try
        {
            using var device = new SdlAudioDevice();
            var renderer = new SynthRenderer(soundFont, device.SampleRate);
            var left = new float[1024];
            var right = new float[1024];
            var interleaved = new float[2048];
            var playing = false;
            var running = false;
            long position = 0;
            ready.SetResult(device.SampleRate);

            while (!commands.IsCompleted)
            {
                if (commands.TryTake(out active, playing ? 5 : 50))
                {
                    // Queue consumption follows the audio device. It excludes queued
                    // software buffers, but cannot measure the final hardware buffer.
                    if (playing) position = Math.Max(0, renderer.Frame - device.QueuedFrames);
                    device.Clear();
                    running = false;
                    switch (active.Method)
                    {
                        case "synth.load":
                            renderer.Load(active.Schedule!);
                            position = 0;
                            playing = false;
                            break;
                        case "synth.play":
                            renderer.Seek(renderer.Schedule.TickToFrame(active.Tick));
                            position = renderer.Frame;
                            playing = true;
                            break;
                        case "synth.seek":
                            renderer.Seek(renderer.Schedule.TickToFrame(active.Tick));
                            position = renderer.Frame;
                            break;
                        case "synth.stop":
                            renderer.Seek(position);
                            playing = false;
                            break;
                    }
                    Publish(renderer.Schedule, position, playing, resetEnd: true);
                    active.Done.SetResult();
                    active = null;
                }

                if (!playing) continue;
                if (running) device.CheckRunning();
                var queued = device.QueuedFrames;
                position = Math.Max(position, renderer.Frame - queued);
                // About 100 ms of reusable PCM buffers gives the managed worker
                // headroom without introducing managed callbacks on SDL's thread.
                while (queued < device.SampleRate / 10 && renderer.Frame < renderer.Schedule.EndFrame)
                {
                    var count = (int)Math.Min(left.Length, renderer.Schedule.EndFrame - renderer.Frame);
                    renderer.Render(left.AsSpan(0, count), right.AsSpan(0, count));
                    for (var i = 0; i < count; i++)
                    {
                        interleaved[2 * i] = left[i];
                        interleaved[2 * i + 1] = right[i];
                    }
                    device.Queue(interleaved.AsSpan(0, count * 2));
                    queued += count;
                }
                if (!running && queued > 0)
                {
                    device.Resume();
                    running = true;
                }
                if (renderer.Frame >= renderer.Schedule.EndFrame && queued == 0)
                {
                    playing = false;
                    Publish(renderer.Schedule, renderer.Schedule.EndFrame, false, ended: true);
                }
                else Publish(renderer.Schedule, position, true);
            }
        }
        catch (Exception error)
        {
            failure = error;
            ready.TrySetException(error);
            active?.Done.TrySetException(error);
        }
        finally
        {
            // Mark completion before draining so callers cannot enqueue after failure.
            if (failure is null) completion.TrySetResult();
            else completion.TrySetException(failure);
            commands.CompleteAdding();
            while (commands.TryTake(out var pending))
                pending.Done.TrySetException(failure ?? new IOException("Audio process stopped."));
        }
    }

    public void Dispose()
    {
        commands.CompleteAdding();
        worker.Join();
        commands.Dispose();
    }
}
