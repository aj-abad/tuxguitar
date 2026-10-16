import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once, EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { audioTarget } from '../scripts/audio-target.mjs';

const target = audioTarget();
const binary = resolve('sidecar/bin', target.folder, target.binary);
const soundFont = resolve('sidecar/bin/GeneralUser.sf2');
function launch({ font = soundFont, driver = process.env.TG_AUDIO_TEST_NATIVE === '1' ? undefined : 'dummy' } = {}) {
  const child = spawn(binary, [font], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...(driver ? { SDL_AUDIODRIVER: driver } : {}), DOTNET_ROOT: resolve('.cache/no-dotnet-runtime') } });
  const closed = once(child, 'close');
  const messages = [];
  const events = new EventEmitter();
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  createInterface({ input: child.stdout }).on('line', line => {
    try { messages.push(JSON.parse(line)); events.emit('message'); }
    catch { events.emit('bad-output', line); }
  });
  let nextId = 0;
  function waitFor(predicate, start = 0, timeout = 6000) {
    return new Promise((resolve, reject) => {
      const check = () => {
        const message = messages.slice(start).find(predicate);
        if (message) { cleanup(); resolve(message); }
      };
      const fail = () => { cleanup(); reject(new Error(`Sidecar exited: ${stderr}`)); };
      const bad = line => { cleanup(); reject(new Error(`Non-JSON stdout: ${line}`)); };
      const timer = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for audio: ${stderr}\n${JSON.stringify(messages.slice(-6))}`)); }, timeout);
      function cleanup() { clearTimeout(timer); events.off('message', check); events.off('bad-output', bad); child.off('close', fail); }
      events.on('message', check);
      events.on('bad-output', bad);
      child.on('close', fail);
      check();
    });
  }
  async function request(method, params) {
    const id = ++nextId;
    const reply = waitFor(message => message.id === id);
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    return reply;
  }
  return { child, closed, messages, request, waitFor, stderr: () => stderr };
}

test('published sidecar: protocol, tempo, seek, stop, completion, and EOF', { timeout: 20000 }, async () => {
  const audio = launch();
  try {
    await audio.waitFor(message => message.event === 'ready');
    assert.match(audio.stderr(), /\.NET \/ MeltySynth \/ SDL/);
    assert.ok((await audio.request('unknown')).error);
    assert.ok((await audio.request('synth.load', { tpq: 0, events: [] })).error);
    audio.child.stdin.write('this is not json\n');
    const events = [
      { type: 'tempo', tick: 0, usq: 500000 },
      { type: 'control', tick: 0, ch: 0, cc: 7, value: 0 },
      { type: 'note_on', tick: 0, ch: 0, note: 60, vel: 0 },
      { type: 'tempo', tick: 960, usq: 1000000 },
      { type: 'note_off', tick: 1920, ch: 0, note: 60 },
    ];
    assert.equal((await audio.request('synth.load', { tpq: 960, events })).result, null);
    assert.equal((await audio.request('synth.play', { from_tick: 0 })).result, null);
    await audio.waitFor(message => message.event === 'tick' && message.qtick > 0 && message.bpm === 120);
    // A rejected replacement must leave the loaded schedule usable.
    assert.ok((await audio.request('synth.load', { tpq: 960, events: [{ type: 'tempo', tick: 0, usq: 0 }] })).error);
    let start = audio.messages.length;
    assert.equal((await audio.request('synth.seek', { tick: 960 })).result, null);
    await audio.waitFor(message => message.event === 'tick' && message.qtick >= 960 && message.bpm === 60, start);
    assert.ok((await audio.request('synth.seek', { tick: -1 })).error);
    await audio.request('synth.stop');
    start = audio.messages.length;
    await delay(200);
    assert.equal(audio.messages.slice(start).filter(message => message.event === 'tick' || message.event === 'playbackEnded').length, 0);
    await audio.request('synth.play', { from_tick: 1920 });
    await audio.waitFor(message => message.event === 'playbackEnded', start);
    await delay(150);
    assert.equal(audio.messages.slice(start).filter(message => message.event === 'playbackEnded').length, 1);
    await audio.request('synth.play');
    audio.child.stdin.end();
    const [code] = await Promise.race([audio.closed, delay(3000).then(() => { throw new Error('Audio did not shut down on EOF.'); })]);
    assert.equal(code, 0);
  } finally { audio.child.kill(); }
});

test('startup failures never announce audio ready', { timeout: 10000 }, async () => {
  for (const options of [{ font: resolve('.cache/missing-soundfont.sf2') }, { driver: 'tabbycat-invalid-driver' }]) {
    const audio = launch(options);
    try {
      const [code] = await audio.closed;
      assert.equal(code, 1);
      assert.equal(audio.messages.some(message => message.event === 'ready'), false);
      assert.match(audio.stderr(), /\[audio\]/);
    } finally { audio.child.kill(); }
  }
});
