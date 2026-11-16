import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({ entryPoints: ['src/lib/athlete-voice-language.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { applyWhisperLanguagePrefix } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const config = { decoder_start_token_id: 0, lang_to_id: { '<|en|>': 1, '<|hi|>': 2, '<|te|>': 3 }, task_to_id: { transcribe: 4 }, no_timestamps_token_id: 5 };

test('audio language scores can select Hindi or Telugu instead of defaulting to English', () => {
  for (const language of [2, 3]) {
    const scores = new Float32Array([100, 2, 1, 1, 100, 100]);
    scores[language] = 8;
    applyWhisperLanguagePrefix(scores, 1, config);
    assert.equal(scores.indexOf(Math.max(...scores)), language);
  }
});
test('automatic language prefix forces transcription, not translation, then plain text', () => {
  for (const [length, token] of [[2, 4], [3, 5]]) {
    const scores = new Float32Array(6).fill(10);
    applyWhisperLanguagePrefix(scores, length, config);
    assert.equal(scores[token], 0);
    assert.equal([...scores].filter(Number.isFinite).length, 1);
  }
});
test('transcribed text scores remain unchanged after the language prefix', () => {
  const scores = new Float32Array([1, 2, 3, 4, 5, 6]);
  applyWhisperLanguagePrefix(scores, 4, config);
  assert.deepEqual([...scores], [1, 2, 3, 4, 5, 6]);
});
