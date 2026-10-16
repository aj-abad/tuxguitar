using MeltySynth;

namespace Tabbycat.Audio;

// Only the playback worker touches the synth; MeltySynth is not thread safe.
public sealed class SynthRenderer
{
    private readonly Synthesizer synth;
    private int cursor;
    public Schedule Schedule { get; private set; }
    public long Frame { get; private set; }

    public SynthRenderer(string soundFont, int sampleRate)
    {
        synth = new Synthesizer(soundFont, sampleRate) { MasterVolume = 0.5F };
        Schedule = new([], 960, sampleRate);
    }

    public void Load(Schedule schedule)
    {
        Schedule = schedule;
        Seek(0);
    }

    public void Seek(long frame)
    {
        Frame = Math.Clamp(frame, 0, Schedule.EndFrame);
        synth.Reset();
        cursor = 0;
        // Preserve the original sidecar's seek semantics: restore channel state,
        // but do not retrigger notes which began before the requested position.
        while (cursor < Schedule.Events.Length && Schedule.Events[cursor].Frame < Frame)
        {
            var message = Schedule.Events[cursor++].Message;
            if (message.Kind is MidiKind.Program or MidiKind.Control or MidiKind.PitchBend) Apply(message);
        }
    }

    public void Render(Span<float> left, Span<float> right)
    {
        if (left.Length != right.Length) throw new ArgumentException("Stereo buffers must have equal lengths.");
        var offset = 0;
        while (offset < left.Length)
        {
            while (cursor < Schedule.Events.Length && Schedule.Events[cursor].Frame <= Frame)
                Apply(Schedule.Events[cursor++].Message);
            var nextEvent = cursor < Schedule.Events.Length ? Schedule.Events[cursor].Frame : long.MaxValue;
            var count = (int)Math.Min(left.Length - offset, nextEvent - Frame);
            synth.Render(left.Slice(offset, count), right.Slice(offset, count));
            Frame += count;
            offset += count;
        }
    }

    private void Apply(MidiMessage message)
    {
        var (command, data1, data2) = message.Kind switch
        {
            MidiKind.Program => (0xC0, message.Data1, 0),
            MidiKind.Control => (0xB0, message.Data1, message.Data2),
            MidiKind.PitchBend => (0xE0, message.Data1 & 127, message.Data1 >> 7),
            MidiKind.NoteOn => (0x90, message.Data1, message.Data2),
            MidiKind.NoteOff => (0x80, message.Data1, 0),
            _ => throw new ArgumentException("Tempo is handled by the frame schedule.")
        };
        synth.ProcessMidiMessage(message.Channel, command, data1, data2);
    }
}
