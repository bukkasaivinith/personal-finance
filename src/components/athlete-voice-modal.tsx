import { useEffect, useRef, useState } from 'react';
import { Loader2, Mic, ShieldCheck, Square } from 'lucide-react';
import { ModalShell } from '@/components/ui';
import { ATHLETE_VOICE_MAX_SECONDS, LocalAthleteVoiceReader, type AthleteVoiceProgress } from '@/lib/athlete-voice';
import './athlete-voice-modal.css';

type VoiceStatus = 'idle' | 'requesting' | 'recording' | 'transcribing';

function microphoneError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return 'Microphone access was not allowed. Enable it in your browser, or type your entry below.';
    if (error.name === 'NotFoundError') return 'No microphone was found. Connect one or type your entry below.';
    if (error.name === 'NotReadableError') return 'Your microphone is unavailable. Close other apps using it, then try again.';
  }
  return error instanceof Error ? error.message : 'Recording could not start. Please try again or type your entry below.';
}

export function AthleteVoiceModal({ onReview, onClose }: { onReview: (text: string) => void; onClose: () => void }) {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [transcript, setTranscript] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<AthleteVoiceProgress>({ message: '' });
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const interval = useRef<ReturnType<typeof setInterval> | null>(null);
  const limit = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reader = useRef<LocalAthleteVoiceReader | null>(null);
  const operation = useRef(0);
  const alive = useRef(true);

  const releaseMicrophone = () => {
    if (interval.current) clearInterval(interval.current);
    if (limit.current) clearTimeout(limit.current);
    interval.current = null;
    limit.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  };

  const cleanup = () => {
    operation.current += 1;
    if (recorder.current) {
      recorder.current.onstop = null;
      recorder.current.ondataavailable = null;
      recorder.current.onerror = null;
      if (recorder.current.state !== 'inactive') recorder.current.stop();
      recorder.current = null;
    }
    releaseMicrophone();
    chunks.current = [];
    reader.current?.dispose();
    reader.current = null;
  };

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; cleanup(); };
    // Cleanup only reads refs and must run on unmount, including during permission prompts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = () => { cleanup(); onClose(); };
  const stop = () => { if (recorder.current?.state === 'recording') recorder.current.stop(); };
  const cancelProcessing = () => { cleanup(); setStatus('idle'); setProgress({ message: '' }); setError(''); };

  const start = async () => {
    if (status !== 'idle') return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined' || typeof AudioContext === 'undefined') {
      setError('Recording needs a supported browser and a secure connection. You can type your entry below.');
      return;
    }
    const id = ++operation.current;
    setStatus('requesting');
    setError('');
    setElapsed(0);
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      if (!alive.current || id !== operation.current) { media.getTracks().forEach((track) => track.stop()); return; }
      stream.current = media;
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((type) => MediaRecorder.isTypeSupported(type));
      const capture = new MediaRecorder(media, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 64_000 });
      recorder.current = capture;
      chunks.current = [];
      capture.ondataavailable = (event) => { if (id === operation.current && event.data.size) chunks.current.push(event.data); };
      capture.onerror = () => {
        if (id !== operation.current || !alive.current) return;
        cleanup();
        setStatus('idle');
        setError('Recording stopped unexpectedly. Please try again or type your entry below.');
      };
      capture.onstop = async () => {
        releaseMicrophone();
        if (id !== operation.current || !alive.current) return;
        recorder.current = null;
        const recording = new Blob(chunks.current, { type: capture.mimeType });
        chunks.current = [];
        setStatus('transcribing');
        reader.current ??= new LocalAthleteVoiceReader();
        try {
          const text = await reader.current.transcribe(recording, (update) => { if (alive.current && id === operation.current) setProgress(update); });
          if (alive.current && id === operation.current) setTranscript(text);
        } catch (caught) {
          if (alive.current && id === operation.current && !(caught instanceof DOMException && caught.name === 'AbortError')) setError(microphoneError(caught));
        } finally {
          if (alive.current && id === operation.current) setStatus('idle');
        }
      };
      capture.start(1_000);
      setStatus('recording');
      const started = Date.now();
      interval.current = setInterval(() => setElapsed(Math.min(ATHLETE_VOICE_MAX_SECONDS, Math.floor((Date.now() - started) / 1_000))), 250);
      limit.current = setTimeout(stop, ATHLETE_VOICE_MAX_SECONDS * 1_000);
    } catch (caught) {
      releaseMicrophone();
      if (alive.current && id === operation.current) { setError(microphoneError(caught)); setStatus('idle'); }
    }
  };

  const busy = status !== 'idle';
  const timerLabel = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
  return <ModalShell eyebrow="Athlete Hub" title="Speak your entry" labelId="athlete-voice-title" onClose={close}>
    <div className="athlete-voice-entry">
      <p className="modal-description">Describe a completed activity, a future workout, recovery, a race, strength work or a goal. Review your words before we prepare the details.</p>
      <div className="athlete-voice-privacy"><ShieldCheck size={18} aria-hidden="true" /><p>Speech is processed on this device; your recording is never uploaded. First use downloads a multilingual model and reader, approximately 180 MB. Your browser can cache them for later.</p></div>
      <div className={`athlete-voice-recorder ${status === 'recording' ? 'is-recording' : ''}`}>
        <span className="athlete-voice-icon" aria-hidden="true">{status === 'transcribing' || status === 'requesting' ? <Loader2 className="auth-spin" size={25} /> : <Mic size={25} />}</span>
        <div className="athlete-voice-state" role="status">
          <strong>{status === 'recording' ? `Listening · ${timerLabel}` : status === 'requesting' ? 'Allow microphone access' : status === 'transcribing' ? progress.message || 'Preparing the speech reader…' : 'Ready when you are'}</strong>
          <span>{status === 'recording' ? 'Stop when finished. Recording ends at 2:00.' : 'Language is detected automatically. Mixed-language speech may need corrections.'}</span>
        </div>
        {status === 'recording' ? <button type="button" className="primary-button" onClick={stop}><Square size={14} /> Stop and transcribe</button>
          : status === 'transcribing' || status === 'requesting' ? <button type="button" className="secondary-button" onClick={cancelProcessing}>Cancel</button>
            : <button type="button" className="primary-button" onClick={() => void start()}><Mic size={15} /> {transcript ? 'Record again' : 'Start recording'}</button>}
      </div>
      {status === 'transcribing' && progress.percent !== undefined ? <progress className="athlete-voice-progress" value={progress.percent} max={100} aria-label="Speech model download progress" /> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <label className="athlete-voice-transcript">Review or type your words<textarea value={transcript} onChange={(event) => setTranscript(event.target.value)} disabled={busy} rows={6} maxLength={5000} placeholder="Yesterday I ran 5 kilometres in 31 minutes. My average heart rate was 145…" /></label>
      <p className="form-hint">Check numbers, dates and names. Review details opens a confirmation; nothing is saved until you choose Save in the entry form.</p>
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={close}>Cancel</button><button type="button" className="primary-button" disabled={busy || !transcript.trim()} onClick={() => { cleanup(); onReview(transcript.trim()); }}>Review details</button></div>
    </div>
  </ModalShell>;
}
