use serde::{Deserialize, Serialize};

// ---- inbound (stdin) -------------------------------------------------------

#[derive(Deserialize)]
pub struct RawRequest {
    pub id: u64,
    pub method: String,
    #[serde(default)]
    pub params: serde_json::Value,
}

#[derive(Deserialize)]
pub struct LoadParams {
    pub tpq: u32,
    pub events: Vec<RawEvent>,
}

#[derive(Deserialize)]
pub struct PlayParams {
    #[serde(default)]
    pub from_tick: i64,
}

#[derive(Deserialize)]
pub struct SeekParams {
    pub tick: i64,
}

/// One MIDI event as serialised by midi-export.ts.
#[derive(Deserialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RawEvent {
    Tempo     { tick: i64, usq: u32 },
    Program   { tick: i64, ch: u8, program: u8 },
    Control   { tick: i64, ch: u8, cc: u8, value: u8 },
    PitchBend { tick: i64, ch: u8, value: u16 },
    NoteOn    { tick: i64, ch: u8, note: u8, vel: u8 },
    NoteOff   { tick: i64, ch: u8, note: u8 },
}

impl RawEvent {
    pub fn tick(&self) -> i64 {
        match self {
            Self::Tempo     { tick, .. } => *tick,
            Self::Program   { tick, .. } => *tick,
            Self::Control   { tick, .. } => *tick,
            Self::PitchBend { tick, .. } => *tick,
            Self::NoteOn    { tick, .. } => *tick,
            Self::NoteOff   { tick, .. } => *tick,
        }
    }
}

// ---- outbound (stdout) -----------------------------------------------------

#[derive(Serialize)]
#[serde(untagged)]
pub enum Out<'a> {
    Result { id: u64, result: serde_json::Value },
    Error  { id: u64, error: &'a str },
    Event  (Event),
}

#[derive(Serialize)]
#[serde(tag = "event", rename_all = "camelCase")]
pub enum Event {
    Ready,
    Tick    { qtick: u64, bpm: f64 },
    PlaybackEnded,
}
