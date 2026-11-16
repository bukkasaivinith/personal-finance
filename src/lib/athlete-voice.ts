export const ATHLETE_VOICE_MAX_SECONDS = 120;

export type AthleteVoiceProgress = { message: string; percent?: number };
export type AthleteVoiceWorkerRequest = { id: number; audio: Float32Array };
export type AthleteVoiceWorkerResponse =
  | { id: number; type: 'progress'; message: string; percent?: number }
  | { id: number; type: 'complete'; text: string }
  | { id: number; type: 'error'; message: string };

const sampleRate = 16_000;

/** Decode locally and supply Whisper with its expected mono 16 kHz waveform. */
export async function prepareAthleteVoiceAudio(recording: Blob): Promise<Float32Array> {
  if (!recording.size) throw new Error('No audio was recorded. Please try again.');
  if (recording.size > 12 * 1024 * 1024) throw new Error('That recording is too large. Keep your spoken entry under two minutes.');
  const audioContext = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await audioContext.decodeAudioData(await recording.arrayBuffer());
  } catch {
    throw new Error('This browser could not read the recording. Please record again or type your entry below.');
  } finally {
    await audioContext.close().catch(() => undefined);
  }
  if (decoded.duration < 0.6) throw new Error('The recording was too short. Speak for a few seconds, then stop.');
  if (decoded.duration > ATHLETE_VOICE_MAX_SECONDS + 2) throw new Error('Keep your recording under two minutes so it can be processed on your device.');
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * sampleRate), sampleRate);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  const audio = rendered.getChannelData(0).slice();
  let energy = 0;
  let peak = 0;
  for (const value of audio) {
    energy += value * value;
    peak = Math.max(peak, Math.abs(value));
  }
  // Silence can cause speech models to invent words. Ask for another recording.
  if (peak < 0.008 || Math.sqrt(energy / audio.length) < 0.0008) {
    throw new Error('The recording is silent or too quiet. Move closer to your microphone and try again.');
  }
  return audio;
}

/** A worker lives only while its voice modal is open; audio is never uploaded. */
export class LocalAthleteVoiceReader {
  private worker: Worker | null = null;
  private nextId = 0;
  private rejectPending: ((reason: Error) => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  async transcribe(recording: Blob, onProgress: (progress: AthleteVoiceProgress) => void): Promise<string> {
    if (this.disposed) throw new DOMException('Voice entry closed.', 'AbortError');
    if (this.rejectPending) throw new Error('A recording is already being processed.');
    onProgress({ message: 'Preparing your recording on this device…' });
    const audio = await prepareAthleteVoiceAudio(recording);
    if (this.disposed) throw new DOMException('Voice entry closed.', 'AbortError');
    const id = ++this.nextId;
    this.worker ??= new Worker(new URL('./athlete-voice.worker.ts', import.meta.url), { type: 'module' });
    const worker = this.worker;
    return new Promise<string>((resolve, reject) => {
      const finish = () => {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.rejectPending = null;
        worker.onmessage = null;
        worker.onerror = null;
      };
      this.rejectPending = (error) => { finish(); reject(error); };
      worker.onmessage = (event: MessageEvent<AthleteVoiceWorkerResponse>) => {
        const message = event.data;
        if (message.id !== id || this.disposed) return;
        if (message.type === 'progress') onProgress({ message: message.message, percent: message.percent });
        else if (message.type === 'complete') { finish(); resolve(message.text); }
        else { finish(); reject(new Error(message.message)); }
      };
      worker.onerror = () => {
        finish();
        worker.terminate();
        this.worker = null;
        reject(new Error('The local speech reader could not run in this browser. Try an updated desktop browser or type your entry below.'));
      };
      this.timer = setTimeout(() => {
        finish();
        worker.terminate();
        this.worker = null;
        reject(new Error('The speech reader took too long. Try a shorter recording on a faster connection, or type your entry below.'));
      }, 5 * 60_000);
      worker.postMessage({ id, audio } satisfies AthleteVoiceWorkerRequest, [audio.buffer]);
    });
  }

  dispose(): void {
    this.disposed = true;
    this.rejectPending?.(new DOMException('Voice entry closed.', 'AbortError'));
    this.worker?.terminate();
    this.worker = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
