# VoDoCo local acceptance evidence

Observed on 2026-09-18 against the production client build, the Node BFF and the supervised inference service on this workstation. Everything below was executed, not inferred. No published Replit application, RunPod Pod or paid resource existed during these runs, so provider ingress, cold start, password-gate coverage and cloud cost behaviour remain unverified.

Raw per-run JSON, screenshots and the extraction probe are retained under the Git-ignored `.local/acceptance/` directory. Only redacted summaries belong in Git. The approved sample transcript is quoted in [`demo-readiness.md`](demo-readiness.md); this document refers to it by SHA-256.

## ViHealthBERT extension — observed 2026-09-22

The production Compose images were rebuilt and both `inference` and `web` reached healthy state. Authenticated `/v2/models` returned exactly `asr`, `phobert`, `xlmr` and `vihealthbert-ner-seed2024`; all four were `ready` on `cuda:0`, with ViHealthBERT correctly reporting `supports_offsets: false`. `/v1/models` remains the compatibility surface and returns only the original three model keys.

A real approved-sample request traversed the production Node BFF and selected `vihealthbert-ner-seed2024`. The terminal job was `succeeded`, retained the exact model identity, returned four entities and did not reuse a PhoBERT/XLM-R result. Focused regression checks passed for exact model-ID forwarding, strict near-match rejection, independent browser result slots, export inclusion, 256/257-token enforcement, and runtime-only asset packaging. The existing comparison view intentionally remains the historically measured XLM-R/PhoBERT pair.

The production UI rendered a third option labelled `ViHealthBERT NER · seed 2024`. Selecting it changed the readiness message to `ViHealthBERT NER đã sẵn sàng`, and the model-information popover showed the new checkpoint identity. The default remained PhoBERT.

## Historical three-model acceptance — observed 2026-09-18

The remaining acceptance evidence describes the original ASR/PhoBERT/XLM-R release unless explicitly superseded above.

## Surface under test

| Component | Actual state |
|---|---|
| Client | `npm --prefix apps/web run build` output served by the bundled Express BFF on `127.0.0.1:3000` |
| BFF | Node 24.20.0 entrypoint `dist-server/index.js`, streaming upload and `/api/v1/*` proxy |
| Inference | Supervised FastAPI service, one spawned CUDA worker, all three checkpoints ready on `cuda:0` |
| GPU | NVIDIA GeForce RTX 5060 Ti, compute capability 12.0, host driver 610.57.04 |
| ASR text SHA-256 | `e84f1d06d764f319e37e7f060f388429c010a0a05a4a95a2c74ddae383e4bbb3` (identical on host and inside the container) |

Requests below were issued directly to the running BFF, not to a mock. Jobs used a fresh 256-bit capability each; no capability, object URL or server path appears in any retained artifact.

## Tokenizer boundary behaviour

Both real tokenizers were used to build inputs whose `input_ids` length including special tokens is exactly 255, 256 and 257, then submitted through `PUT /api/v1/ner-jobs/{id}`.

| Model | 255 tokens | 256 tokens | 257 tokens |
|---|---|---|---|
| PhoBERT (slow tokenizer) | succeeded | succeeded | failed `NER_INPUT_TOO_LONG` |
| XLM-R (fast tokenizer) | succeeded | succeeded | failed `NER_INPUT_TOO_LONG` |

The accepted 256-token input still returned entities from `cuda:0`, so the boundary is inclusive and never silently truncated. `services/inference/tests/test_runtime_boundaries.py` pins the same rule with a fake tokenizer that honours `add_special_tokens` and `truncation`.

## Upload, duration and admission boundaries

| Case | Result |
|---|---|
| Exactly 10,485,760 bytes (valid WAV padded with a JUNK chunk) | accepted, decoded 6.0 s, ASR + NER succeeded |
| Declared `Content-Length: 10485761` | `413` returned before the body was read |
| Chunked transfer of exactly 10,485,760 bytes | accepted, decoded 6.0 s, succeeded |
| Zero bytes | `422 EMPTY_AUDIO` |
| Non-audio bytes | accepted, then failed `AUDIO_INVALID` in the worker |
| Decoded exactly 30.00 s | accepted, ASR succeeded |
| Decoded 30.01 s | failed `AUDIO_TOO_LONG` |

Admission and isolation on `PUT /api/v1/audio-jobs/{id}`:

- Three concurrent chunked uploads all reported `receiving`, so partial uploads are visible without blocking others.
- Replaying an accepted-but-unfinished job ID with the same capability returned `202` and the same `receiving` state instead of starting a second job.
- A wrong capability and a never-issued job ID returned byte-identical `404` payloads, so a probe cannot distinguish them.
- A fourth concurrent upload was rejected with `429`.
- The two uploads whose clients disconnected failed by upload timeout; no partial file survived.

## Browser workflow on the production build

Executed at 1440×1100 against the real service, capturing every `PUT` the page issued:

1. Selecting the approved sample produced one audio submission; ASR plus PhoBERT returned four entities and no page errors.
2. The raw ASR transcript is displayed verbatim; PhoBERT entities carry no offsets, so the raw view rendered zero inline highlights and lists them as list-only.
3. Draft creation copied the raw text; editing to a longer draft invalidated the old result, and the explicit update ran NER on the draft only, with `source: review`, `revision: 1` and the draft SHA-256.
4. The comparison view auto-ran only the missing raw XLM-R job, submitted the raw text with `revision: 0`, and kept the review draft intact on return. Total compute: one ASR plus three NER jobs — no repeated ASR, no duplicate NER.
5. The comparison heading kept the raw confirmation state while the review tab kept the draft confirmation, so the badge never claimed the selected draft was reviewed.
6. Benchmark details stayed collapsed by default and cite the offline stage-14 gold figures (XLM-R 58.62%, PhoBERT 62.42%, 3,497 test sentences) as offline, not as the uploaded clip's score.
7. Selecting an entity row moved focus to its highlight and back, and all interactive markup remained keyboard reachable with visible focus.

## Microphone, in an isolated browser with a virtual capture device

Run in a separate Chromium instance launched with `--use-fake-device-for-media-stream` and the approved WAV as its capture file, so the harness never touched a physical microphone.

| Case | Result |
|---|---|
| Microphone denied natively | `getUserMedia` rejected with `NotAllowedError`, the UI explained the denial, and the retained audio plus the upload tab stayed usable |
| Manual stop | tracks ended, `audio/webm;codecs=opus`, preview metadata shown |
| Automatic 10 s stop | tracks ended at 10.00 s of encoded media (`audio/webm;codecs=opus`), preview retained |
| Submitting the recording | 9.96 s decoded, ASR produced text, NER returned seven entities |
| Before pressing the processing button | zero audio submissions |

## Export contents

Three downloads were produced through the real dialog: review TXT, session JSON and a comparison TXT.

- Both TXT files hashed to the exact `text_sha256` recorded for that text, so a TXT export is byte-for-byte the reviewed/raw text.
- The JSON export carries schema version, session identity, audio metadata, ASR provenance, optional draft with revision/hash/confirmation, per-model source/revision/hash/results, `correction: "off"`, `raw_confirmed_by_user: false` and `review.confirmed_by_user: true`.
- The JSON contains no job capability, no object URL and no local filesystem path.
- Dialog focus stayed contained, Escape closed it, and focus returned to the export trigger once the dialog settled.

## Responsive, zoom and accessibility measurements

| Viewport | Horizontal overflow | Minimum action height | Notes |
|---|---:|---:|---|
| 1440×1100 | 0 | 44 px | 1200 px container, two-column review/compare |
| 1024×768 | 0 | 44 px | two columns inside a 960 px container |
| 1023×768 | 0 | 44 px | single-column stacked panels |
| 720×900 | 0 | 44 px | equivalent to 200% zoom on 1440; still no overflow |
| 390×844 | 0 | 44 px | mobile document flow, export/new-record static in flow |
| 375×812 | 0 | 44 px | no overflow |

Fonts resolve to the self-hosted `Noto Sans Variable` Vietnamese subset with no third-party request, transcript type measures 17/29 px on mobile and 19/32 px on desktop, controls stay 16 px, and `prefers-reduced-motion: reduce` reduces the measured transition and animation durations to `0s`.

## Immutable container verification

The local image `vodoco-inference:local-20260919` (`sha256:29aeef1eac6226163d430f8247bf73ae40c282e4d69442ade2d6c65c981b40e2`, 24,000,911,832 bytes) was built from `deploy/runpod/Dockerfile` with the real model bundle, the frozen Python lock, and the third-party notices and licence texts. Docker on this host exposes only `runc` and no CDI GPU specification, so `--gpus all` fails with `failed to discover GPU vendor from CDI`. The container was therefore given the GPU explicitly:

```sh
docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges \
  --device /dev/nvidia0 --device /dev/nvidiactl --device /dev/nvidia-uvm \
  --mount type=bind,src=/usr/lib64/libcuda.so.610.57.04,dst=/usr/lib/x86_64-linux-gnu/libcuda.so.1,readonly \
  --mount type=bind,src=/usr/lib64/libnvidia-ptxjitcompiler.so.610.57.04,dst=/usr/lib/x86_64-linux-gnu/libnvidia-ptxjitcompiler.so.1,readonly \
  --mount type=bind,src=/usr/lib64/libnvidia-gpucomp.so.610.57.04,dst=/usr/lib/x86_64-linux-gnu/libnvidia-gpucomp.so.610.57.04,readonly \
  -e INFERENCE_SERVICE_TOKEN \
  sha256:29aeef1eac6226163d430f8247bf73ae40c282e4d69442ade2d6c65c981b40e2
```

`INFERENCE_SERVICE_TOKEN` is supplied by the operating environment, never by a flag value committed to a file. The image was also given `--mount` for the approved WAV at `/tmp/approved.wav` when running the preflight entrypoint.

Observed inside that container:

| Check | Result |
|---|---|
| Runtime identity | uid 10001, no root |
| Anonymous `GET /v1/models` | `401` |
| Model readiness | ASR, PhoBERT and XLM-R all `ready` on `cuda:0` |
| Checkpoint write attempt | `PermissionError`; weights are read-only at mode `0444` |
| Real job through the container API | succeeded, 6.0 s decoded, ASR SHA-256 matches the host bit-for-bit, PhoBERT returned four entities |
| Temp upload directory after the job | no `*.upload` files |
| Cold load inside the container | ASR 3,495.7 ms, PhoBERT 556.0 ms, XLM-R 1,697.0 ms |
| Whole preflight inside the container | 8,261.8 ms; peak allocated 2,471,508,992 bytes, peak reserved 2,602,565,632 bytes (≈2.42 GiB), matching the host preflight |
| Third-party notices | `/opt/vodoco/THIRD_PARTY_NOTICES.md` and `/opt/vodoco/licenses/AGPL-3.0.txt` present at mode `0444`; both SHA-256 values match the repository files |
| Licence directory traversal | `/opt/vodoco/licenses` is `0755`. An earlier build applied `0444` to the copied directory, which removed its execute bit and made the licence unreadable to uid 10001; this check caught it before any push |
| Manifest consistency | `/opt/vodoco/model-manifest.json` and the copy inside the model release are byte-identical, so the image carries exactly one attestation text |
| `docker stop -t 20` | exit code 0, worker group and GPU released |

The explicit device/library passthrough is a local workaround for the missing CDI specification, not a recommendation for the Pod, where the NVIDIA device plugin normally injects devices. The container's 2.42 GiB peak reserved memory matches the host preflight measurement, so a candidate Pod still needs at least that peak plus 2 GiB of headroom, with confirmation on its own driver and GPU.

## Not verified here

- Published HTTPS ingress, Replit password-gate bypass attempts, provider cold start and rollback.
- End-to-end traversal of the exact 10 MiB boundary through both real production proxies rather than the local BFF.
- Any behaviour that depends on RunPod, a private registry or paid capacity, all of which remain owner-gated.
