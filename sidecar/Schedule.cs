using System.Text.Json;

namespace Tabbycat.Audio;

public enum MidiKind { Tempo, Program, Control, PitchBend, NoteOn, NoteOff }
public readonly record struct MidiMessage(long Tick, MidiKind Kind, int Channel, int Data1, int Data2 = 0);
public readonly record struct FrameEvent(long Frame, MidiMessage Message);
public readonly record struct TempoSegment(long Tick, double Frame, double FramesPerTick, double Bpm);

public sealed class Schedule
{
    public FrameEvent[] Events { get; }
    public TempoSegment[] Tempos { get; }
    public long EndFrame { get; }

    public Schedule(IEnumerable<MidiMessage> messages, int ticksPerQuarter, int sampleRate)
    {
        if (ticksPerQuarter <= 0 || sampleRate <= 0)
            throw new ArgumentException("The tick resolution and sample rate must be positive.");
        // OrderBy is stable: setup and note-off/note-on ordering at a shared tick matters.
        var sorted = messages.OrderBy(message => message.Tick).ToArray();
        if (sorted.Any(message => message.Tick < 0)) throw new ArgumentException("Ticks cannot be negative.");
        var tempos = new List<TempoSegment> { new(0, 0, sampleRate * 0.5 / ticksPerQuarter, 120) };
        foreach (var message in sorted.Where(message => message.Kind == MidiKind.Tempo))
        {
            if (message.Data1 <= 0) throw new ArgumentException("Tempo must be positive.");
            var previous = tempos[^1];
            var frame = previous.Frame + (message.Tick - previous.Tick) * previous.FramesPerTick;
            if (message.Tick == previous.Tick) tempos.RemoveAt(tempos.Count - 1);
            tempos.Add(new(message.Tick, frame, sampleRate * (double)message.Data1 / (ticksPerQuarter * 1_000_000.0),
                60_000_000.0 / message.Data1));
        }
        Tempos = tempos.ToArray();
        Events = sorted.Where(message => message.Kind != MidiKind.Tempo)
            .Select(message => new FrameEvent(TickToFrame(message.Tick), message)).ToArray();
        EndFrame = checked((Events.Length == 0 ? 0 : Events[^1].Frame) + sampleRate);
    }

    public long TickToFrame(long tick)
    {
        if (tick < 0) throw new ArgumentException("Ticks cannot be negative.");
        var segment = Tempos[FindSegment(tick, byFrame: false)];
        return checked((long)Math.Floor(segment.Frame + (tick - segment.Tick) * segment.FramesPerTick));
    }

    public (long Tick, double Bpm) Position(long frame)
    {
        var segment = Tempos[FindSegment(frame, byFrame: true)];
        return (Math.Max(0, segment.Tick + (long)Math.Floor((frame - segment.Frame) / segment.FramesPerTick)), segment.Bpm);
    }

    private int FindSegment(long value, bool byFrame)
    {
        var low = 0;
        var high = Tempos.Length;
        while (low + 1 < high)
        {
            var middle = (low + high) / 2;
            if ((byFrame ? Tempos[middle].Frame : Tempos[middle].Tick) <= value) low = middle;
            else high = middle;
        }
        return low;
    }

    public static Schedule Parse(JsonElement parameters, int sampleRate)
    {
        var tpq = parameters.GetProperty("tpq").GetInt32();
        var events = parameters.GetProperty("events");
        if (events.ValueKind != JsonValueKind.Array || events.GetArrayLength() > 1_000_000)
            throw new ArgumentException("Expected an array of at most one million MIDI events.");
        return new(events.EnumerateArray().Select(ParseMessage), tpq, sampleRate);
    }

    private static MidiMessage ParseMessage(JsonElement value)
    {
        var tick = value.GetProperty("tick").GetInt64();
        var type = value.GetProperty("type").GetString();
        if (type == "tempo") return new(tick, MidiKind.Tempo, 0, ReadRange(value, "usq", 1, 60_000_000));
        var channel = ReadRange(value, "ch", 0, 15);
        return type switch
        {
            "program" => new(tick, MidiKind.Program, channel, ReadRange(value, "program", 0, 127)),
            "control" => new(tick, MidiKind.Control, channel, ReadRange(value, "cc", 0, 127), ReadRange(value, "value", 0, 127)),
            "pitch_bend" => new(tick, MidiKind.PitchBend, channel, ReadRange(value, "value", 0, 16383)),
            "note_on" => new(tick, MidiKind.NoteOn, channel, ReadRange(value, "note", 0, 127), ReadRange(value, "vel", 0, 127)),
            "note_off" => new(tick, MidiKind.NoteOff, channel, ReadRange(value, "note", 0, 127)),
            _ => throw new ArgumentException($"Unknown MIDI event: {type}")
        };
    }

    private static int ReadRange(JsonElement value, string name, int minimum, int maximum)
    {
        var number = value.GetProperty(name).GetInt32();
        if (number < minimum || number > maximum) throw new ArgumentException($"{name} must be between {minimum} and {maximum}.");
        return number;
    }
}
