mod audio;
mod protocol;

use std::io::{BufRead, Write};
use std::sync::{Arc, Mutex};

use audio::{compute_segments, frame_to_qtick, qtick_to_frame, Cmd, FrameEvent, SynthAction, TempoSegment};
use protocol::{Event, LoadParams, Out, PlayParams, RawEvent, RawRequest, SeekParams};

fn emit(out: &Out) {
    let line = serde_json::to_string(out).unwrap();
    println!("{line}");
    std::io::stdout().flush().ok();
}

fn ok(id: u64) {
    emit(&Out::Result { id, result: serde_json::Value::Null });
}

fn err(id: u64, msg: &str) {
    emit(&Out::Error { id, error: msg });
}

fn main() {
    let sf_path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| {
            // fall back to soundfont adjacent to binary
            let exe = std::env::current_exe().unwrap_or_default();
            exe.parent()
                .unwrap_or(std::path::Path::new("."))
                .join("GeneralUser.sf2")
                .to_string_lossy()
                .into_owned()
        });

    // Audio thread discovers the device's actual output sample rate and
    // returns it; all tick↔frame math must use the same value.
    let (cmd_tx, current_frame, is_playing, ended, sample_rate) =
        audio::spawn(sf_path);

    // Shared tempo segments for tick conversion (written on Load, read in reporter thread).
    let tempo_segs: Arc<Mutex<Vec<TempoSegment>>> = Arc::new(Mutex::new(vec![]));

    // Tick/end reporter thread
    {
        let cf   = Arc::clone(&current_frame);
        let ip   = Arc::clone(&is_playing);
        let en   = Arc::clone(&ended);
        let segs = Arc::clone(&tempo_segs);
        std::thread::spawn(move || {
            loop {
                std::thread::sleep(std::time::Duration::from_millis(50));

                if en.swap(false, std::sync::atomic::Ordering::Relaxed) {
                    emit(&Out::Event(Event::PlaybackEnded));
                }

                if !ip.load(std::sync::atomic::Ordering::Relaxed) {
                    continue;
                }

                let frame = cf.load(std::sync::atomic::Ordering::Relaxed);
                let locked = segs.lock().unwrap();
                if locked.is_empty() { continue; }
                let (qtick, bpm) = frame_to_qtick(frame, &locked);
                drop(locked);

                emit(&Out::Event(Event::Tick { qtick, bpm }));
            }
        });
    }

    emit(&Out::Event(Event::Ready));

    // stdin JSON-RPC loop
    let stdin = std::io::stdin();
    for line in stdin.lock().lines() {
        let line = match line { Ok(l) => l, Err(_) => break };
        let line = line.trim();
        if line.is_empty() { continue; }

        let req: RawRequest = match serde_json::from_str(line) {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[sidecar] parse error: {e}");
                continue;
            }
        };

        match req.method.as_str() {
            "synth.load" => {
                match serde_json::from_value::<LoadParams>(req.params) {
                    Ok(p) => {
                        let (events, segs, end_frame) = build_schedule(&p.events, p.tpq, sample_rate);
                        *tempo_segs.lock().unwrap() = segs;
                        let _ = cmd_tx.send(Cmd::Load { events, end_frame });
                        ok(req.id);
                    }
                    Err(e) => err(req.id, &e.to_string()),
                }
            }

            "synth.play" => {
                let from_tick = serde_json::from_value::<PlayParams>(req.params)
                    .map(|p| p.from_tick)
                    .unwrap_or(0);
                let segs = tempo_segs.lock().unwrap().clone();
                let start_frame = qtick_to_frame(from_tick, &segs);
                let _ = cmd_tx.send(Cmd::Play { start_frame });
                ok(req.id);
            }

            "synth.stop" => {
                let _ = cmd_tx.send(Cmd::Stop);
                ok(req.id);
            }

            "synth.seek" => {
                match serde_json::from_value::<SeekParams>(req.params) {
                    Ok(p) => {
                        let segs = tempo_segs.lock().unwrap().clone();
                        let frame = qtick_to_frame(p.tick, &segs);
                        let _ = cmd_tx.send(Cmd::Seek { frame });
                        ok(req.id);
                    }
                    Err(e) => err(req.id, &e.to_string()),
                }
            }

            unknown => {
                eprintln!("[sidecar] unknown method: {unknown}");
                err(req.id, &format!("unknown method: {unknown}"));
            }
        }
    }
}

/// Convert raw MIDI events → scheduled frame events + tempo segments + end_frame.
fn build_schedule(
    raw: &[RawEvent],
    tpq: u32,
    sample_rate: u32,
) -> (Vec<FrameEvent>, Vec<TempoSegment>, u64) {
    // Extract tempo events (sorted, first beat = tick 0)
    let mut tempos: Vec<(i64, u32)> = raw.iter().filter_map(|e| {
        if let RawEvent::Tempo { tick, usq } = e {
            Some((*tick, *usq))
        } else {
            None
        }
    }).collect();
    if tempos.is_empty() {
        tempos.push((0, 500_000)); // 120 BPM default
    }

    let segs = compute_segments(&tempos, tpq, sample_rate);

    // Convert every non-tempo event tick → frame, build FrameEvent list
    let mut events: Vec<FrameEvent> = raw.iter().filter_map(|e| {
        let tick = e.tick();
        let frame = qtick_to_frame(tick, &segs);
        let action = raw_to_action(e)?;
        Some(FrameEvent { frame, action })
    }).collect();

    events.sort_by_key(|e| e.frame);

    // End frame = last event frame + 1 second of tail
    let end_frame = events.last().map(|e| e.frame).unwrap_or(0)
        + sample_rate as u64; // 1s tail for reverb decay

    (events, segs, end_frame)
}

fn raw_to_action(e: &RawEvent) -> Option<SynthAction> {
    Some(match e {
        RawEvent::Tempo { .. } => return None, // handled separately
        RawEvent::Program   { ch, program, .. } => SynthAction::Program { ch: *ch, prog: *program },
        RawEvent::Control   { ch, cc, value, .. } => SynthAction::Control { ch: *ch, cc: *cc, val: *value },
        RawEvent::PitchBend { ch, value, .. } => SynthAction::PitchBend { ch: *ch, value: *value },
        RawEvent::NoteOn    { ch, note, vel, .. } => SynthAction::NoteOn  { ch: *ch, key: *note, vel: *vel },
        RawEvent::NoteOff   { ch, note, .. } => SynthAction::NoteOff { ch: *ch, key: *note },
    })
}
