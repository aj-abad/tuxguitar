using System.Text.Json;
using Tabbycat.Audio;

var passed = 0;
var failed = 0;
void Check(bool condition, string message)
{
    if (!condition) throw new Exception(message);
}
void Test(string name, Action test)
{
    try { test(); passed++; Console.WriteLine($"PASS: {name}"); }
    catch (Exception error) { failed++; Console.Error.WriteLine($"FAIL: {name}: {error.Message}"); }
}
Schedule Parse(string json)
{
    using var document = JsonDocument.Parse(json);
    return Schedule.Parse(document.RootElement, 48000);
}

Test("tempo changes, default tempo before the first change, and device sample rates", () =>
{
    foreach (var rate in new[] { 44100, 48000, 96000 })
    {
        var schedule = new Schedule([
            new(1920, MidiKind.NoteOff, 0, 60), new(960, MidiKind.Tempo, 0, 1_000_000),
            new(0, MidiKind.NoteOn, 0, 60, 100)
        ], 960, rate);
        Check(schedule.TickToFrame(960) == rate / 2, "First quarter must use the default 120 BPM.");
        Check(schedule.TickToFrame(1920) == rate * 3 / 2, "Second quarter must use 60 BPM.");
        Check(schedule.Position(rate).Tick == 1440, "Device frames must map back across the tempo change.");
        Check(schedule.Position(rate).Bpm == 60, "Reported tempo must follow the current segment.");
        Check(schedule.EndFrame == rate * 5 / 2, "Keep one second of release/reverb tail.");
    }
});
Test("same-tick tempo replacement and stable MIDI event ordering", () =>
{
    var schedule = new Schedule([
        new(0, MidiKind.Tempo, 0, 600_000), new(0, MidiKind.Tempo, 0, 500_000),
        new(0, MidiKind.Program, 0, 25), new(0, MidiKind.NoteOff, 0, 60), new(0, MidiKind.NoteOn, 0, 60, 100)
    ], 960, 48000);
    Check(schedule.TickToFrame(960) == 24000, "The final tempo at a tick must win.");
    Check(schedule.Events.Select(e => e.Message.Kind).SequenceEqual([MidiKind.Program, MidiKind.NoteOff, MidiKind.NoteOn]),
        "Do not reorder channel setup or retriggered notes at one tick.");
});
Test("invalid schedules are rejected before replacing the song", () =>
{
    foreach (var json in new[] {
        "{\"tpq\":0,\"events\":[]}",
        "{\"tpq\":960,\"events\":[{\"type\":\"tempo\",\"tick\":0,\"usq\":0}]}",
        "{\"tpq\":960,\"events\":[{\"type\":\"note_on\",\"tick\":-1,\"ch\":0,\"note\":60,\"vel\":100}]}",
        "{\"tpq\":960,\"events\":[{\"type\":\"note_on\",\"tick\":0,\"ch\":16,\"note\":60,\"vel\":100}]}",
        "{\"tpq\":960,\"events\":[{\"type\":\"pitch_bend\",\"tick\":0,\"ch\":0,\"value\":16384}]}"
    })
    {
        var rejected = false;
        try { Parse(json); } catch (ArgumentException) { rejected = true; }
        Check(rejected, $"Accepted invalid schedule: {json}");
    }
});

var soundFont = Path.GetFullPath(args.FirstOrDefault() ?? "sidecar/bin/GeneralUser.sf2");
Test("real SoundFont PCM starts at the scheduled note and contains finite audio", () =>
{
    var renderer = new SynthRenderer(soundFont, 48000);
    renderer.Load(new([new(960, MidiKind.NoteOn, 0, 60, 100), new(1920, MidiKind.NoteOff, 0, 60)], 960, 48000));
    var left = new float[24000];
    var right = new float[24000];
    renderer.Render(left, right);
    Check(left.All(value => value == 0) && right.All(value => value == 0), "Unexpected sound before the note.");
    renderer.Render(left, right);
    Check(left.All(float.IsFinite) && right.All(float.IsFinite), "PCM must not contain NaN or infinity.");
    Check(left.Any(value => Math.Abs(value) > 0.001F), "The synth produced no audible PCM.");
});
Test("seek restores channel controls; loading another song resets them", () =>
{
    var renderer = new SynthRenderer(soundFont, 48000);
    renderer.Load(new([
        new(0, MidiKind.Program, 0, 25), new(0, MidiKind.Control, 0, 7, 0),
        new(0, MidiKind.PitchBend, 0, 8192), new(960, MidiKind.NoteOn, 0, 60, 100), new(1920, MidiKind.NoteOff, 0, 60)
    ], 960, 48000));
    renderer.Seek(24000);
    var left = new float[24000];
    var right = new float[24000];
    renderer.Render(left, right);
    Check(left.All(value => Math.Abs(value) < 0.00001F), "Seek lost the earlier channel volume.");
    renderer.Load(new([new(0, MidiKind.NoteOn, 0, 60, 100), new(960, MidiKind.NoteOff, 0, 60)], 960, 48000));
    renderer.Render(left, right);
    Check(left.Any(value => Math.Abs(value) > 0.001F), "A previous song's mute leaked into the new song.");
    renderer.Load(new([], 960, 48000));
    renderer.Render(left, right);
    Check(left.All(value => value == 0), "Loading an empty score left old notes or effects ringing.");
});
Console.WriteLine($"Audio checks: {passed} passed, {failed} failed.");
return failed == 0 ? 0 : 1;
