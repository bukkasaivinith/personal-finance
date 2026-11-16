Athlete Hub local speech runtime

ort-wasm-simd-threaded.jsep.mjs and ort-wasm-simd-threaded.jsep.wasm
are copied without modification from onnxruntime-web/dist, version
1.22.0-dev.20250409-89f8206ba4 (used by @huggingface/transformers 3.8.1).
Upstream: https://github.com/microsoft/onnxruntime
License: MIT, reproduced in LICENSE.txt from upstream commit 89f8206ba4.
Upstream third-party notices are included in ThirdPartyNotices.txt.

Keep these files synchronized with the installed onnxruntime-web version when
upgrading Transformers.js. They are served from this app so browser workers
do not rely on a third-party runtime CDN. Speech model files are downloaded
separately from the public onnx-community/whisper-base repository on first use.
No recordings are sent to that model host.
