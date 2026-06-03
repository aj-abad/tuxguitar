use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{BufferSize, Device, SampleRate, StreamConfig};
use oxisynth::{MidiEvent as OxiEvent, SoundFont, Synth, SynthDescriptor};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc};

// ---- tempo segment ---------------------------------------------------------

#[derive(Clone, Debug)]
pub struct TempoSegment {
    pub start_frame: u64,
    pub start_tick:  i64,   // 0-normalised QT ticks (first beat = 0)
    pub frames_per_tick: f64,
    pub bpm: f64,
}

pub fn compute_segments(tempos: &[(i64, u32)], tpq: u32, sample_rate: u32) -> Vec<TempoSegment> {
    let tpq = tpq.max(1) as f64;
    if tempos.is_empty() {
        return vec![TempoSegment {
            start_frame: 0,
            start_tick: 0,
            frames_per_tick: sample_rate as f64 * 500_000.0 / (tpq * 1_000_000.0),
            bpm: 120.0,
        }];
    }
    let mut segs = Vec::new();
    let mut frame = 0u64;
    for (i, &(tick, usq)) in tempos.iter().enumerate() {
        let bpm = 60_000_000.0 / usq as f64;
        // frames per tick = sample_rate * (usq µs/quarter) / (tpq ticks/quarter) / 1_000_000
        let frames_per_tick = sample_rate as f64 * usq as f64 / (tpq * 1_000_000.0);
        segs.push(TempoSegment { start_frame: frame, start_tick: tick, frames_per_tick, bpm });
        if let Some(&(next_tick, _)) = tempos.get(i + 1) {
            frame += ((next_tick - tick) as f64 * frames_per_tick) as u64;
        }
    }
    segs
}

pub fn frame_to_qtick(frame: u64, segs: &[TempoSegment]) -> (u64, f64) {
    if segs.is_empty() { return (0, 120.0); }
    let seg = segs.iter().rev().find(|s| s.start_frame <= frame).unwrap_or(&segs[0]);
    let elapsed = frame.saturating_sub(seg.start_frame);
    let ticks = (elapsed as f64 / seg.frames_per_tick) as i64;
    let qtick = (seg.start_tick + ticks).max(0) as u64;
    (qtick, seg.bpm)
}

pub fn qtick_to_frame(qtick: i64, segs: &[TempoSegment]) -> u64 {
    if segs.is_empty() { return 0; }
    let seg = segs.iter().rev().find(|s| s.start_tick <= qtick).unwrap_or(&segs[0]);
    let tick_delta = (qtick - seg.start_tick).max(0) as f64;
    seg.start_frame + (tick_delta * seg.frames_per_tick) as u64
}

// ---- scheduled event -------------------------------------------------------

#[derive(Clone, Debug)]
pub struct FrameEvent {
    pub frame: u64,
    pub action: SynthAction,
}

#[derive(Clone, Debug)]
pub enum SynthAction {
    NoteOn    { ch: u8, key: u8, vel: u8 },
    NoteOff   { ch: u8, key: u8 },
    Program   { ch: u8, prog: u8 },
    Control   { ch: u8, cc: u8, val: u8 },
    PitchBend { ch: u8, value: u16 },
}

fn apply(synth: &mut Synth, action: &SynthAction) {
    let _ = match action {
        SynthAction::NoteOn  { ch, key, vel } =>
            synth.send_event(OxiEvent::NoteOn  { channel: *ch, key: *key, vel: *vel }),
        SynthAction::NoteOff { ch, key } =>
            synth.send_event(OxiEvent::NoteOff { channel: *ch, key: *key }),
        SynthAction::Program { ch, prog } =>
            synth.send_event(OxiEvent::ProgramChange { channel: *ch, program_id: *prog }),
        SynthAction::Control { ch, cc, val } =>
            synth.send_event(OxiEvent::ControlChange { channel: *ch, ctrl: *cc, value: *val }),
        SynthAction::PitchBend { ch, value } =>
            synth.send_event(OxiEvent::PitchBend { channel: *ch, value: *value }),
    };
}

// ---- commands from main thread ---------------------------------------------

pub enum Cmd {
    Load {
        events:  Vec<FrameEvent>,
        end_frame: u64,
    },
    Play { start_frame: u64 },
    Stop,
    Seek { frame: u64 },
}

// ---- internal audio state (lives inside cpal callback) ---------------------

struct AudioState {
    events:    Vec<FrameEvent>, // sorted by frame
    cursor:    usize,
    frame:     u64,
    playing:   bool,
    end_frame: u64,
}

impl AudioState {
    fn new() -> Self {
        Self {
            events: vec![],
            cursor: 0,
            frame: 0,
            playing: false,
            end_frame: 0,
        }
    }

    fn handle(&mut self, synth: &mut Synth, cmd: Cmd) {
        match cmd {
            Cmd::Load { events, end_frame } => {
                all_notes_off(synth);
                self.events    = events;
                self.cursor    = 0;
                self.frame     = 0;
                self.end_frame = end_frame;
                self.playing   = false;
            }
            Cmd::Play { start_frame } => {
                all_notes_off(synth);
                self.frame  = start_frame;
                self.cursor = self.events.partition_point(|e| e.frame < start_frame);
                self.apply_setup_before_cursor(synth);
                self.playing = true;
            }
            Cmd::Stop => {
                all_notes_off(synth);
                self.playing = false;
            }
            Cmd::Seek { frame } => {
                all_notes_off(synth);
                self.frame  = frame;
                self.cursor = self.events.partition_point(|e| e.frame < frame);
                self.apply_setup_before_cursor(synth);
            }
        }
    }

    /// Re-apply program/control events that precede the cursor so the synth
    /// has the right instrument/volume when starting mid-song.
    fn apply_setup_before_cursor(&self, synth: &mut Synth) {
        for e in &self.events[..self.cursor] {
            match &e.action {
                SynthAction::Program { .. }
                | SynthAction::Control { .. }
                | SynthAction::PitchBend { .. } => apply(synth, &e.action),
                _ => {}
            }
        }
    }
}

fn all_notes_off(synth: &mut Synth) {
    for ch in 0..16u8 {
        let _ = synth.send_event(OxiEvent::AllNotesOff { channel: ch });
    }
}

// ---- public entry point ----------------------------------------------------

/// Spawn the audio thread. Returns command sender, shared atomics, and the
/// actual output sample rate (discovered from the default device).
pub fn spawn(
    sf_path: String,
) -> (
    mpsc::SyncSender<Cmd>,
    Arc<AtomicU64>,  // current_frame
    Arc<AtomicBool>, // is_playing
    Arc<AtomicBool>, // ended
    u32,             // sample_rate
) {
    let host   = cpal::default_host();
    let device = host.default_output_device().expect("[audio] no output device");
    let sample_rate = device
        .default_output_config()
        .expect("[audio] no default output config")
        .sample_rate()
        .0;

    let (tx, rx) = mpsc::sync_channel::<Cmd>(8);
    let current_frame = Arc::new(AtomicU64::new(0));
    let is_playing    = Arc::new(AtomicBool::new(false));
    let ended         = Arc::new(AtomicBool::new(false));

    let cf = Arc::clone(&current_frame);
    let ip = Arc::clone(&is_playing);
    let en = Arc::clone(&ended);

    std::thread::spawn(move || {
        run_audio_thread(device, sample_rate, sf_path, rx, cf, ip, en);
    });

    (tx, current_frame, is_playing, ended, sample_rate)
}

fn run_audio_thread(
    device: Device,
    sample_rate: u32,
    sf_path: String,
    cmd_rx: mpsc::Receiver<Cmd>,
    current_frame: Arc<AtomicU64>,
    is_playing: Arc<AtomicBool>,
    ended: Arc<AtomicBool>,
) {
    let config = StreamConfig {
        channels: 2,
        sample_rate: SampleRate(sample_rate),
        buffer_size: BufferSize::Default,
    };

    let mut synth = {
        let desc = SynthDescriptor {
            sample_rate: sample_rate as f32,
            gain: 0.5, // default is 0.2; bump for audibility
            ..Default::default()
        };
        let mut s = Synth::new(desc).expect("[audio] failed to create synth");
        let mut f = std::fs::File::open(&sf_path)
            .unwrap_or_else(|e| panic!("[audio] cannot open soundfont {sf_path}: {e}"));
        // SoundFont::load returns Result<_, ()> — () has no Display, so use expect.
        let font = SoundFont::load(&mut f).expect("[audio] cannot load soundfont");
        s.add_font(font, true);
        s
    };

    let mut state = AudioState::new();

    let stream = device
        .build_output_stream(
            &config,
            move |data: &mut [f32], _info| {
                // Drain commands (non-blocking)
                while let Ok(cmd) = cmd_rx.try_recv() {
                    state.handle(&mut synth, cmd);
                }

                if !state.playing {
                    data.fill(0.0);
                    is_playing.store(false, Ordering::Relaxed);
                    return;
                }

                render(data, &mut synth, &mut state);

                current_frame.store(state.frame, Ordering::Relaxed);
                is_playing.store(state.playing, Ordering::Relaxed);
                if !state.playing {
                    ended.store(true, Ordering::Relaxed);
                }
            },
            |err| eprintln!("[audio] stream error: {err}"),
            None,
        )
        .expect("[audio] failed to build output stream");

    stream.play().expect("[audio] failed to start stream");

    // Keep thread (and therefore the stream) alive for the process lifetime.
    loop {
        std::thread::sleep(std::time::Duration::from_secs(3600));
    }
}

/// Render one audio buffer, firing scheduled MIDI events at their exact frame.
fn render(data: &mut [f32], synth: &mut Synth, state: &mut AudioState) {
    let total_frames = data.len() / 2;

    for i in 0..total_frames {
        let cur_frame = state.frame + i as u64;

        // Fire every event scheduled at or before this frame.
        while state.cursor < state.events.len()
            && state.events[state.cursor].frame <= cur_frame
        {
            apply(synth, &state.events[state.cursor].action);
            state.cursor += 1;
        }

        let (l, r) = synth.read_next();
        data[i * 2]     = l;
        data[i * 2 + 1] = r;
    }

    state.frame += total_frames as u64;

    if state.frame >= state.end_frame {
        all_notes_off(synth);
        state.playing = false;
    }
}
