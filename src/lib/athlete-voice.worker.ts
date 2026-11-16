import { env, pipeline, LogitsProcessor, LogitsProcessorList, type Tensor, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import type { AthleteVoiceWorkerRequest, AthleteVoiceWorkerResponse } from './athlete-voice';
import { applyWhisperLanguagePrefix, type WhisperLanguageConfig } from './athlete-voice-language';

// Only public model files are downloaded. User audio remains in this worker.
env.allowLocalModels = false;
env.useBrowserCache = true;
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.wasm.proxy = false;
  env.backends.onnx.wasm.wasmPaths = `${new URL(import.meta.env.BASE_URL, self.location.origin).href}athlete-voice/`;
}

const model = 'onnx-community/whisper-base';
// Narrow the generic factory to this task to avoid expanding every model union.
const createSpeechPipeline = pipeline as unknown as (
  task: 'automatic-speech-recognition',
  model: string,
  options: {
    device: 'wasm';
    dtype: { encoder_model: 'fp32'; decoder_model_merged: 'q8' };
    progress_callback: (progress: { status: string; file?: string; loaded?: number }) => void;
  },
) => Promise<AutomaticSpeechRecognitionPipeline>;
let recognizer: Promise<AutomaticSpeechRecognitionPipeline> | null = null;
let busy = false;

// Transformers.js 3.8 defaults to English when language is omitted. Supply the
// Whisper start token alone and constrain only its three prefix positions so
// language detection really runs, independently for each overlapping chunk.
class AutomaticLanguagePrefix extends LogitsProcessor {
  constructor(private config: WhisperLanguageConfig) { super(); }
  _call(inputIds: bigint[][], logits: Tensor): Tensor {
    const width = logits.dims[logits.dims.length - 1];
    const scores = logits.data as Float32Array;
    for (let row = 0; row < inputIds.length; row++) {
      applyWhisperLanguagePrefix(scores.subarray(row * width, (row + 1) * width), inputIds[row].length, this.config);
    }
    return logits;
  }
}

function send(message: AthleteVoiceWorkerResponse) {
  self.postMessage(message);
}

self.addEventListener('message', async (event: MessageEvent<AthleteVoiceWorkerRequest>) => {
  const { id, audio } = event.data;
  if (busy) { send({ id, type: 'error', message: 'Another recording is still being processed.' }); return; }
  if (!(audio instanceof Float32Array) || !audio.length || audio.length > 16_000 * 122) {
    send({ id, type: 'error', message: 'The recording could not be read. Please record again.' });
    return;
  }
  busy = true;
  try {
    if (!recognizer) {
      send({ id, type: 'progress', message: 'Loading the multilingual speech model…' });
      const downloads = new Map<string, number>();
      let lastProgress = -1;
      recognizer = createSpeechPipeline('automatic-speech-recognition', model, {
        device: 'wasm',
        // Whisper's encoder is sensitive to quantization; retain its precision.
        dtype: { encoder_model: 'fp32', decoder_model_merged: 'q8' },
        progress_callback: (progress) => {
          if (progress.status !== 'progress' || !progress.file || typeof progress.loaded !== 'number') return;
          downloads.set(progress.file, Math.max(downloads.get(progress.file) ?? 0, progress.loaded));
          const loaded = Array.from(downloads.values()).reduce((sum, bytes) => sum + bytes, 0);
          const megabytes = Math.round(loaded / 1_000_000);
          if (megabytes === lastProgress) return;
          lastProgress = megabytes;
          send({ id, type: 'progress', message: `Downloading the speech model · ${Math.round(loaded / 1_000_000)} MB received`, percent: Math.min(99, Math.round(loaded / 140_000_000 * 100)) });
        },
      });
    }
    const transcribe = await recognizer;
    const languageConfig = transcribe.model.generation_config as unknown as WhisperLanguageConfig;
    if (!languageConfig?.lang_to_id || !languageConfig.task_to_id?.transcribe || !languageConfig.decoder_start_token_id || !languageConfig.no_timestamps_token_id) {
      throw new Error('The speech model language settings could not be loaded.');
    }
    const languagePrefix = new LogitsProcessorList();
    languagePrefix.push(new AutomaticLanguagePrefix(languageConfig));
    send({ id, type: 'progress', message: 'Transcribing on your device. You can cancel at any time.' });
    const transcriptionOptions = {
      task: 'transcribe',
      decoder_input_ids: [languageConfig.decoder_start_token_id],
      logits_processor: languagePrefix,
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: false,
      do_sample: false,
      num_beams: 1,
      max_new_tokens: 440,
    };
    const result = await transcribe(audio, transcriptionOptions);
    const text = (Array.isArray(result) ? result.map((item) => item.text).join(' ') : result.text).trim();
    if (!text) throw new Error('No speech was detected. Try a clearer recording or type your entry below.');
    send({ id, type: 'complete', text });
  } catch (error) {
    recognizer = null;
    send({ id, type: 'error', message: error instanceof Error && /No speech was detected/.test(error.message)
      ? error.message
      : 'The local speech model could not load or finish. Check your internet connection for the first download, try a shorter recording, or type below.' });
  } finally {
    busy = false;
  }
});
