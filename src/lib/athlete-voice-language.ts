export type WhisperLanguageConfig = {
  decoder_start_token_id: number;
  lang_to_id: Record<string, number>;
  task_to_id: { transcribe: number };
  no_timestamps_token_id: number;
};

/** Let Whisper infer a language from each audio chunk, then force transcription. */
export function applyWhisperLanguagePrefix(scores: Float32Array, prefixLength: number, config: WhisperLanguageConfig): void {
  if (prefixLength === 1) {
    const languageIds = new Set(Object.values(config.lang_to_id));
    for (let token = 0; token < scores.length; token++) {
      if (!languageIds.has(token)) scores[token] = -Infinity;
    }
  } else if (prefixLength === 2 || prefixLength === 3) {
    scores.fill(-Infinity);
    scores[prefixLength === 2 ? config.task_to_id.transcribe : config.no_timestamps_token_id] = 0;
  }
}
