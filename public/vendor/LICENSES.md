# Third-party code served from /vendor

| File | Project | Version | License |
| --- | --- | --- | --- |
| pdf.min.js, pdf.worker.min.js | pdf.js (Mozilla Foundation), npm `pdfjs-dist` | 3.11.174 | Apache-2.0 |
| qrcode.js | QR Code Generator (Kazuhiko Arase), npm `qrcode-generator` | 1.4.4 | MIT |

Files are copied unmodified from the npm packages; each keeps its original license header.
| noise/ (index.js, rnnoise worklet, rnnoise wasm) | web-noise-suppressor (sapphi-red), npm `@sapphi-red/web-noise-suppressor`; RNNoise (Xiph) via shiguredo/rnnoise-wasm | 0.4.1 | MIT (see noise/LICENSE); RNNoise BSD-3-Clause |
| selfie/ | MediaPipe Selfie Segmentation (Google), npm `@mediapipe/selfie_segmentation` | 0.1.1675465747 | Apache-2.0 |
| ../icons.svg | Lucide icons (Lucide Contributors; portions © Cole Bemis, Feather, MIT), npm `lucide-static` — 64 icons rebuilt into a sprite by `scripts/build-icons.ts` (stroke attributes removed so CSS sets them) | 0.460.0 | ISC |

## tasks-vision (MediaPipe Tasks Vision 1.2.2)

`/vendor/tasks-vision/vision_bundle.mjs`, from the npm package `@mediapipe/tasks-vision@1.2.2`. Apache License 2.0, Copyright Google LLC. The WebAssembly engine loads from unpkg.com at the same version; the selfie_multiclass_256x256 model (Apache 2.0) from storage.googleapis.com.
