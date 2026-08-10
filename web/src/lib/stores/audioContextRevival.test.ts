import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { reviveAudioContext, type RevivableAudio, type RevivableContext } from './audioContextRevival';

class Emitter {
  private listeners = new Map<string, Set<() => void>>();
  addEventListener(type: string, cb: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(cb);
  }
  removeEventListener(type: string, cb: () => void) {
    this.listeners.get(type)?.delete(cb);
  }
  emit(type: string) {
    for (const cb of this.listeners.get(type) ?? []) cb();
  }
  listenerCount(type: string) {
    return this.listeners.get(type)?.size ?? 0;
  }
}

class FakeContext extends Emitter implements RevivableContext {
  state = 'running';
  resumeCalls = 0;
  resumeSucceeds = true;

  resume(): Promise<void> {
    this.resumeCalls++;
    if (!this.resumeSucceeds) return Promise.reject(new Error('blocked'));
    this.setState('running');
    return Promise.resolve();
  }

  setState(state: string) {
    this.state = state;
    this.emit('statechange');
  }
}

class FakeAudio extends Emitter implements RevivableAudio {
  paused = false;
}

let ctx: FakeContext;
let audio: FakeAudio;
let dispose: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  ctx = new FakeContext();
  audio = new FakeAudio();
  dispose = reviveAudioContext(ctx, audio, { retryMs: 1000 });
});

afterEach(() => {
  dispose();
  vi.useRealTimers();
});

describe('audio context revival', () => {
  it('leaves a healthy context alone', async () => {
    audio.emit('timeupdate');
    await vi.advanceTimersByTimeAsync(5000);
    expect(ctx.resumeCalls).toBe(0);
  });

  it('revives a context that suspends while the track is still playing', async () => {
    ctx.setState('suspended');
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.resumeCalls).toBe(1);
    expect(ctx.state).toBe('running');
  });

  it('revives a context interrupted by the phone locking', async () => {
    ctx.setState('interrupted');
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.state).toBe('running');
  });

  it('keeps trying while a hidden page refuses to resume', async () => {
    ctx.resumeSucceeds = false;
    ctx.setState('suspended');
    await vi.advanceTimersByTimeAsync(3500);
    expect(ctx.resumeCalls).toBeGreaterThanOrEqual(4);
  });

  it('stops trying once the context is running again', async () => {
    ctx.resumeSucceeds = false;
    ctx.setState('suspended');
    await vi.advanceTimersByTimeAsync(1000);
    ctx.resumeSucceeds = true;
    await vi.advanceTimersByTimeAsync(1000);
    const settled = ctx.resumeCalls;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ctx.resumeCalls).toBe(settled);
  });

  it('takes the still-ticking element as a signal that audio should be audible', async () => {
    ctx.resumeSucceeds = false;
    ctx.state = 'suspended'; // suspended without firing statechange (already hidden)
    audio.emit('timeupdate');
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.resumeCalls).toBe(1);
  });

  it('leaves a context suspended while the listener has playback paused', async () => {
    audio.paused = true;
    ctx.setState('suspended');
    await vi.advanceTimersByTimeAsync(5000);
    expect(ctx.resumeCalls).toBe(0);
  });

  it('resumes when playback starts again after a paused suspend', async () => {
    audio.paused = true;
    ctx.setState('suspended');
    audio.paused = false;
    audio.emit('play');
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.state).toBe('running');
  });

  it('lets go of every listener when disposed', () => {
    dispose();
    expect(ctx.listenerCount('statechange')).toBe(0);
    expect(audio.listenerCount('timeupdate')).toBe(0);
    expect(audio.listenerCount('play')).toBe(0);
  });

  it('stops retrying after disposal', async () => {
    ctx.resumeSucceeds = false;
    ctx.setState('suspended');
    await vi.advanceTimersByTimeAsync(1000);
    const before = ctx.resumeCalls;
    dispose();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ctx.resumeCalls).toBe(before);
  });
});
