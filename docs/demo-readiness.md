# VoDoCo demo readiness

Current local six-model evidence was observed on 2026-09-24. Historical three- and
four-model evidence remains below and is labelled explicitly. This is not evidence of a
published Replit application or a GPU-enabled RunPod container.

## Six-model NER release — observed 2026-09-24

The one-command preparation trained Logistic Regression, Linear SVM and CRF from the
pinned VietMed-NER train split, verified both validation and test F1, reopened the safe
runtime artifacts with prediction parity, and combined them with the four neural runtime
exports. The release contains 39 declared assets. Its manifest and
`services/inference/model-manifest.json` are byte-identical at SHA-256
`0895b7f2307cb0ee3f3c0ff95838193ef4674a5eac565d61b18aa246ec980af9`.
The current Python lock hash is
`3289f97b95e517cbdd87b494c73cb757471208923e5b1b92fdf49caca9bdef8a`;
the OpenAPI contract hash is
`700800dfec9031de63d2fa91ad75bfddb6caa7c78c830b6a8a3dd7a03443ca0c`.

Native preflight loaded the three classical models on `cpu` and ASR plus the three
Transformer NER models on `cuda:0`. Peak GPU allocation was 3,009,780,224 bytes and peak
reservation was 3,177,185,280 bytes. The complete cold preflight took 11.16 seconds.
Classical load measurements allocated no GPU memory. All six NER passes succeeded on the
approved sample transcript.

Authenticated HTTP verification returned `asr`, `logreg`, `linear-svm`, `crf`, `xlmr`,
`phobert`, `vihealthbert-ner-seed2024` in that order. The required sentence hash was
`ed5eaba3fa1d2b5f38830a1647293053c1c959381b924f75f65b2b8a64601a16`.
Every NER model returned three entities; classical and XLM-R offsets were exact source
slices, slow-tokenizer offsets were unavailable, and classical scores were `null`.

The production-built web app traversed the actual Node BFF and supervised inference
service. A fresh worker completed the approved sample on its first submission. Browser
verification measured three ordered columns at 1440 px and one 343 px column at a 390 px
viewport, with no page-level horizontal overflow. All six panel completion announcements,
six canonical benchmark rows, the source attribution and the independently scrollable
benchmark region were present. Logistic Regression F1 rendered exactly as
`56,22630504520268%`.

## ViHealthBERT extension — observed 2026-09-22

The owner-provided `vihealthbert-ner-seed2024` export was packaged as seven inference-only files; `training_args.bin` was excluded. Its checkpoint SHA-256 is `5782557b853a348731b5bd4480087167624ba8457ecd243375b1b0d71fea2765`. The four-model release now contains 31 declared assets, and both manifest copies hash to `97f1eb811b8928bd925d4b04d807d9d6c5c717f0d11f5261cc0093ede90f8b8b`.

The rebuilt Compose inference container loaded ASR, PhoBERT, XLM-R and ViHealthBERT on `cuda:0`. ViHealthBERT used the slow `PhobertTokenizer`, reported no validated offsets, loaded in 352.4 ms and returned four entities for the approved sample in 3.7 ms. The complete four-model preflight took 6.38 s, with peak allocated GPU memory 3,009,780,224 bytes and peak reserved memory 3,179,282,432 bytes (approximately 2.96 GiB). These are one-workstation measurements, not latency or accuracy guarantees.

A separate real request traversed the production-built Node BFF, selected the exact `vihealthbert-ner-seed2024` identifier, completed ASR plus ViHealthBERT, returned four entities and preserved the model identity/device as `vihealthbert-ner-seed2024` on `cuda:0`. PhoBERT remains the default, and the historical two-model benchmark comparison remains XLM-R versus PhoBERT because no approved ViHealthBERT benchmark result was supplied.

## Historical three-model baseline — observed 2026-09-18

The remaining measurements in this document describe the original ASR/PhoBERT/XLM-R release unless explicitly superseded above.

## Approved inputs and artifact provenance

The owner explicitly approved replaying `giai_doan_14_hoan_thien/audio.wav` in the password-protected research demo. The same owner confirmed that `phobert-best-seed.zip`, containing `seed_123_lr3e-05_ep8_wd0.05`, is the selected fine-tuned PhoBERT export. These decisions do not authorize public weights, paid resources, or a different checkpoint.

The preparation command extracted only seven allowlisted PhoBERT inference files. Training arguments, optimizer states and the nested training checkpoint were excluded. ASR and XLM-R were copied from the existing pinned snapshots, with their recorded hashes recomputed. Original research artifacts were not modified.

| Artifact | Verified SHA-256 |
|---|---|
| Approved audio | `e5b8d54910e5a8c11cb93dbe1a524d93645e0b6ecea1074b42a64cd69277b784` |
| PhoBERT source ZIP | `ed4d9557485c88b46d77f3d8d60381424c941b9435ad2d8f35ecf5b7a2c70e52` |
| Whisper-small checkpoint | `9da16b622b0055ace9573250e93013842fd830b9adb3d0b34cac1002513b6c50` |
| PhoBERT seed 123 checkpoint | `6bdb21e18a9b8d34c0e836da0b7461e5bacaa2b5822cb52ad60c9515f2606e5f` |
| XLM-R checkpoint | `b2248828396a934dd02326af520c5edd366295410f05630ae8aa294ec61a329b` |
| Release manifest, including both owner attestations | `0f213cfcb4e94a3fe7695195199744bd06a7ab106694afdd10904d9f4b4d6749` |
| Python runtime lock | `5eb24956bfe3711fbed2416f649d30b4dd1f0d2fc2a361bb83e5c21466acd2c9` |
| Web dependency lock | `6de5aecc383c23ece74da0006967c28b76cd34bc4527a7d95000a2a22b67de93` |
| Canonical OpenAPI contract | `f6e96630ff1891e8650964a58122afe8824dc0491336df2276aa6de65b4df42b` |

Full asset hashes, actual label maps, tokenizer identities, source revisions and generation settings are in [`services/inference/model-manifest.json`](../services/inference/model-manifest.json). The release contains 24 inference assets. Weights and the source ZIP remain outside Git.

## Actual native CUDA preflight

Environment: Linux x86_64; Python 3.12.13; PyTorch 2.8.0+cu128; Transformers 4.57.6; tokenizers 0.22.2; safetensors 0.8.0; NumPy 2.2.6; sentencepiece 0.2.1. The service dependencies are locked, including FastAPI 0.141.1, uvicorn 0.52.4 and Pydantic 2.13.5. Web validation uses Node 24.20.0 and npm 11.19.0.

GPU: NVIDIA GeForce RTX 5060 Ti, compute capability 12.0, reported memory 16,660,430,848 bytes. Host driver: NVIDIA 610.57.04, read from `/proc/driver/nvidia/version`. All three models loaded and executed on `cuda:0`; no CPU fallback was used.

| Observation | Measured result |
|---|---|
| Audio | WAV, 6.0 s, 8 kHz mono; decoded to 16 kHz mono float32 |
| Cold model load | ASR 4,891.8 ms; PhoBERT 570.1 ms; XLM-R 1,755.3 ms |
| ASR execution | 1,029.6 ms |
| PhoBERT execution | 80.1 ms; four returned entities |
| XLM-R execution | 4.0 ms; four returned entities |
| Complete preflight | 10.32 s |
| Peak allocated GPU memory | 2,357 MiB |
| Peak reserved GPU memory | 2,482 MiB, approximately 2.42 GiB |

These are one-machine, one-clip observations, not latency guarantees or an accuracy benchmark. A candidate Pod needs at least 2 GiB above measured peak reserved memory, plus confirmation on its actual driver/GPU. Availability and price are not established by this local result.

The subsequently launched supervised FastAPI service also reported all three models ready on CUDA. A real browser sample submission traversed the production-built Node BFF and completed ASR plus PhoBERT. Tokenizer, upload, duration, admission, microphone, export, responsive and container evidence is recorded in [`demo-acceptance.md`](demo-acceptance.md).

PhoBERT uses the selected **slow** `PhobertTokenizer`. Its four sample entities have null offsets and must remain list-only. XLM-R uses `XLMRobertaTokenizerFast`; the Unicode probe and sample entities provide validated code-point spans. Both tokenizers reported 28 tokens including special tokens for the sample, with a hard limit of 256 and no truncation. This is not a promise that every XLM-R entity has a usable span: ambiguous or non-exact spans remain null.

ASR is immutable after one surrounding-whitespace strip. Hashes are SHA-256 of exact UTF-8 text. NER source/revision/hash/model/job guards, Unicode code-point offsets and typed error/result fields are defined by [`contracts/demo-api.openapi.yaml`](../contracts/demo-api.openapi.yaml).

## Reproduction

Use the locked service environment, not an unrelated research notebook environment:

```sh
uv run --project services/inference --frozen --group export \
  python scripts/prepare_demo_models.py \
  --phobert-zip "$PHOBERT_ZIP" \
  --vihealthbert-dir "$VIHEALTHBERT_DIR" \
  --dataset-dir do_an_may_hoc/data/vietmed-ner \
  --output .local/vodoco-models/release
uv run --project services/inference --frozen \
  python -m vodoco_inference.preflight \
  --manifest services/inference/model-manifest.json \
  --model-root .local/vodoco-models/release \
  --audio giai_doan_14_hoan_thien/audio.wav \
  --report .local/vodoco-preflight.json
INFERENCE_SERVICE_TOKEN="$INFERENCE_SERVICE_TOKEN" \
  uv run --project services/inference --frozen python \
  scripts/verify_six_model_demo.py --base-url http://127.0.0.1:8000
```

Preparation deliberately refuses an existing output directory. Reuse the already verified release, or supply a new explicit release directory; do not delete research artifacts to make the command succeed. The private preflight report includes the approved transcript and is ignored by Git. Keep shared evidence redacted.

All nine actual Pencil reference images and frame/state mappings are in [`demo-design/frame-map.md`](demo-design/frame-map.md). Their PNG dimensions were checked: desktop frames 1440×900, mobile 390×1280, plus the native-size state boards and handoff reference. No Pencil canvas mutation was made.

## License and deployment gates

| Component | Evidence and delivery requirement |
|---|---|
| ASR, `leduckhai/MultiMed-ST` | The Hugging Face model card metadata declares `license: mit`, but no licence text is published: the `LICENSE` path its README links to returns 404 on both `main` and `master`, the repository holds no `LICENSE`/`COPYING` file, and GitHub reports SPDX `NOASSERTION` (checked 2026-09-19). The declaration is recorded as-is; no MIT text was reproduced because none exists upstream. |
| PhoBERT, `vinai/phobert-base-v2` (AGPL-3.0) + the fine-tuned seed-123 export | The export is a modified version: fine-tuned on Vietnamese medical entity data and reduced to the inference file set. The modification statement, the verbatim licence text (`services/inference/licenses/AGPL-3.0.txt`, copied from upstream) and the section-13 Corresponding Source offer are recorded in [`../services/inference/THIRD_PARTY_NOTICES.md`](../services/inference/THIRD_PARTY_NOTICES.md) and shipped inside the image at `/opt/vodoco/`. |
| XLM-R baseline, `leduckhai/VietMed-NER` | No licence is declared and no licence file exists upstream. Transfer and operation are covered only by the owner attestation recorded below, which is scoped to one private registry, one leased GPU and a password-protected internal demo. Public download availability is not distribution permission. |
| Noto Sans | Installed package declares OFL-1.1. The upstream `LICENSE` is shipped as `apps/web/public/noto-sans-OFL.txt` and served from the built site root, so the font licence travels with the bundled assets. |
| Owner licence attestation | On 2026-09-19 the owner authorised private-registry transfer, execution on one leased GPU and use inside a password-protected internal demo, and accepted the AGPL-3.0 obligations of `vinai/phobert-base-v2`, while withholding approval for public redistribution of weights, weights in Git and cloud spend. Recorded verbatim in `services/inference/model-manifest.json` and in the notices file. |

License source links and inspection evidence are retained in the [plan evidence register](../plans/260917-1541-vodoco-replit-runpod-demo/research/evidence.md). A private registry or shared password does not itself satisfy license obligations.

Outstanding external gates:

- Replit Publishing access with native **Password protected** available, the intended published origin, and production-only service secrets.
- RunPod account access, an approved private registry with push credentials and a read-only pull credential, actual single-GPU/region availability, and an explicit spend ceiling with a shutdown deadline. Model distribution clearance is no longer a gate: the owner granted it on 2026-09-19 for one private registry, one leased GPU and a password-protected internal demo, and that grant does not extend to public redistribution of weights.
- GPU execution of the historical three-model immutable container is verified locally. `docker run --gpus all` still fails with `failed to discover GPU vendor from CDI: no known GPU vendor found`, because this Docker exposes only `runc` runtimes and no CDI GPU specification; no daemon configuration was changed. Supplying the device nodes and driver libraries explicitly instead ran those three models on `cuda:0` inside that image, authenticated, non-root and with read-only weights. The exact command and measurements are in [`demo-acceptance.md`](demo-acceptance.md). The current six-model container and any Pod running its digest must still confirm readiness on their own driver and GPU.
- Published HTTPS ingress, password bypass attempts, exactly-10-MiB traversal through both real proxies, provider cold start, public rollback and cost-safe shutdown remain unverified.

No paid Pod, registry publication, Replit publication or push was performed for this
six-model verification. A local commit does not satisfy any external gate.
