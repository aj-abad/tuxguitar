using System.Reflection;
using System.Runtime.InteropServices;

namespace Tabbycat.Audio;

internal sealed partial class SdlAudioDevice : IDisposable
{
    private const uint AudioSubsystem = 0x10;
    private const ushort Float32LittleEndian = 0x8120;
    private readonly uint device;
    public int SampleRate { get; }
    public long QueuedFrames => GetQueuedAudioSize(device) / (2 * sizeof(float));

    static SdlAudioDevice() => NativeLibrary.SetDllImportResolver(typeof(SdlAudioDevice).Assembly, ResolveLibrary);

    private static nint ResolveLibrary(string name, Assembly assembly, DllImportSearchPath? searchPath)
    {
        if (name != "tabbycat-sdl") return 0;
        var library = OperatingSystem.IsWindows() ? "SDL2.dll" : OperatingSystem.IsMacOS() ? "libSDL2-2.0.dylib" : "libSDL2-2.0.so";
        return NativeLibrary.Load(library, assembly, searchPath);
    }

    public SdlAudioDevice()
    {
        if (InitSubSystem(AudioSubsystem) != 0) throw Error("Audio initialization failed");
        var desired = new AudioSpec { Frequency = 48000, Format = Float32LittleEndian, Channels = 2, Samples = 1024 };
        device = OpenAudioDevice(0, 0, ref desired, out var obtained, 1); // allow the device's sample rate
        if (device == 0)
        {
            var error = Error("No usable audio output device");
            QuitSubSystem(AudioSubsystem);
            throw error;
        }
        SampleRate = obtained.Frequency;
        if (SampleRate <= 0 || obtained.Channels != 2 || obtained.Format != Float32LittleEndian)
        {
            Dispose();
            throw new InvalidOperationException("The audio device did not provide stereo float output.");
        }
    }

    public unsafe void Queue(ReadOnlySpan<float> samples)
    {
        fixed (float* pointer = samples)
            if (QueueAudio(device, pointer, checked((uint)(samples.Length * sizeof(float)))) != 0)
                throw Error("Could not queue audio");
    }

    public void Resume()
    {
        PauseAudioDevice(device, 0);
        CheckRunning();
    }

    public void CheckRunning()
    {
        if (GetAudioDeviceStatus(device) != 1) throw new InvalidOperationException("Audio output device stopped.");
    }

    public void Clear()
    {
        PauseAudioDevice(device, 1);
        ClearQueuedAudio(device);
    }

    public void Dispose()
    {
        if (device != 0) CloseAudioDevice(device);
        QuitSubSystem(AudioSubsystem);
    }

    private static Exception Error(string context) => new InvalidOperationException($"{context}: {Marshal.PtrToStringUTF8(GetError())}");

    [StructLayout(LayoutKind.Sequential)]
    private struct AudioSpec
    {
        public int Frequency;
        public ushort Format;
        public byte Channels;
        public byte Silence;
        public ushort Samples;
        public ushort Padding;
        public uint Size;
        public nint Callback;
        public nint UserData;
    }

    [LibraryImport("tabbycat-sdl", EntryPoint = "SDL_InitSubSystem")] private static partial int InitSubSystem(uint flags);
    [LibraryImport("tabbycat-sdl", EntryPoint = "SDL_QuitSubSystem")] private static partial void QuitSubSystem(uint flags);
    [LibraryImport("tabbycat-sdl", EntryPoint = "SDL_GetError")] private static partial nint GetError();
    [LibraryImport("tabbycat-sdl", EntryPoint = "SDL_OpenAudioDevice")] private static partial uint OpenAudioDevice(nint name, int capture, ref AudioSpec desired, out AudioSpec obtained, int changes);
    [LibraryImport("tabbycat-sdl", EntryPoint = "SDL_CloseAudioDevice")] private static partial void CloseAudioDevice(uint device);
    [LibraryImport("tabbycat-sdl", EntryPoint = "SDL_PauseAudioDevice")] private static partial void PauseAudioDevice(uint device, int pause);
    [LibraryImport("tabbycat-sdl", EntryPoint = "SDL_GetAudioDeviceStatus")] private static partial int GetAudioDeviceStatus(uint device);
    [LibraryImport("tabbycat-sdl", EntryPoint = "SDL_QueueAudio")] private static unsafe partial int QueueAudio(uint device, float* data, uint length);
    [LibraryImport("tabbycat-sdl", EntryPoint = "SDL_GetQueuedAudioSize")] private static partial uint GetQueuedAudioSize(uint device);
    [LibraryImport("tabbycat-sdl", EntryPoint = "SDL_ClearQueuedAudio")] private static partial void ClearQueuedAudio(uint device);
}
