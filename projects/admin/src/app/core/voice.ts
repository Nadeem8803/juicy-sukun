import { Injectable, signal } from '@angular/core';
import { Capacitor, registerPlugin } from '@capacitor/core';

export type VoiceMode = 'recorded' | 'phone' | 'bell';

interface AlarmVoicePlugin {
  setVoice(o: { mode: VoiceMode; interval: number }): Promise<void>;
}
const NativeVoice = registerPlugin<AlarmVoicePlugin>('AlarmVoice');
const KEY = 'js.voice.v1';

function load(): { mode: VoiceMode; interval: number } {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return {
      mode: v.mode === 'phone' || v.mode === 'bell' ? v.mode : 'recorded',
      interval: Number.isFinite(v.interval) ? Math.max(2, Math.min(15, Math.round(v.interval))) : 3,
    };
  } catch {
    return { mode: 'recorded', interval: 3 };
  }
}

/** Which sound the order alarm uses (our recorded voice, the phone's voice, or a bell) and how often it repeats. */
@Injectable({ providedIn: 'root' })
export class AlarmVoice {
  private readonly initial = load();
  readonly mode = signal<VoiceMode>(this.initial.mode);
  readonly interval = signal<number>(this.initial.interval);
  readonly native = Capacitor.isNativePlatform();

  constructor() {
    this.push();
  }

  set(mode: VoiceMode, interval: number): void {
    this.mode.set(mode);
    this.interval.set(interval);
    try {
      localStorage.setItem(KEY, JSON.stringify({ mode, interval }));
    } catch {
      /* storage blocked: the choice still applies for this session */
    }
    this.push();
  }

  /** Tells the native alarm. Also runs at start-up so the phone always matches what Settings shows. */
  private push(): void {
    if (this.native) void NativeVoice.setVoice({ mode: this.mode(), interval: this.interval() }).catch(() => undefined);
  }
}
