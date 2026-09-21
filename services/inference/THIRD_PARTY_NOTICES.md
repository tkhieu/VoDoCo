# Third-party notices for the inference image

Scope: the immutable inference image built from `deploy/runpod/Dockerfile`, which contains the three checkpoints below, their tokenizers and the Python environment. The web application ships separately; its font notice is `/noto-sans-OFL.txt` in the built site root.

This file is copied into the image at `/opt/vodoco/THIRD_PARTY_NOTICES.md`, and the licence texts it references are copied to `/opt/vodoco/licenses/`. Recorded 2026-09-19.

## Owner attestation

> Tôi xác nhận có quyền cho phép sao chép Whisper/MultiMed-ST, PhoBERT seed 123 và VietMed-NER XLM-R vào một registry riêng tư, chạy trên một GPU thuê, dùng trong demo nội bộ có mật khẩu, không công bố lại weights, không đưa weights vào Git; chấp nhận nghĩa vụ AGPL-3.0 của `vinai/phobert-base-v2` (giữ notice, cung cấp corresponding source khi được yêu cầu).

Recorded verbatim as given by the project owner on 2026-09-19. It authorises private-registry transfer, execution on one leased GPU, and use inside a password-protected internal demo. It does **not** authorise public redistribution of the weights, publication of weights into Git, or any cloud spend. The earlier 2026-09-18 attestation selecting `seed_123_lr3e-05_ep8_wd0.05` as the fine-tuned checkpoint is recorded in `services/inference/model-manifest.json`.

## Inventory

| Component | Upstream | Pinned revision | Declared licence | Obligation carried |
|---|---|---|---|---|
| ASR Whisper-small Vietnamese (`checkpoint-5000`) | `leduckhai/MultiMed-ST` | `fb15edd1dfc68810a7d0c75e6cfc73c3e5ed01c1` | HF model card metadata declares `license: mit` | MIT notice preservation |
| PhoBERT fine-tuned, seed 123 | derived from `vinai/phobert-base-v2` | base tag `v2` | AGPL-3.0 | Notices, modification statement, licence copy, Corresponding Source offer |
| XLM-R baseline | `leduckhai/VietMed-NER` | `cccffb7de14423114f7d4bafc9f736b9d866e446` | none declared | Owner attestation above; no upstream terms to reproduce |

Exact hashes, tokenizer identities, label maps and generation settings are in `services/inference/model-manifest.json`.

## ASR component

The Hugging Face model card for `leduckhai/MultiMed-ST` declares `license: mit` in its metadata and its README badge links to `https://github.com/leduckhai/MultiMed-ST/blob/main/LICENSE`.

Checked on 2026-09-19: that path returns HTTP 404 on both the `main` and `master` branches, no `LICENSE`, `LICENSE.md`, `LICENSE.txt`, `license` or `COPYING` file exists in the Hugging Face repository, and the GitHub repository reports SPDX `NOASSERTION` because no licence file is present to detect. **No upstream MIT licence text was therefore available to reproduce, and none is fabricated here.** The declared licence is recorded as-is; if the upstream project later publishes the text, copy it verbatim into this directory and reference it here.

## PhoBERT component and AGPL-3.0

The shipped PhoBERT export is a **modified** version of `vinai/phobert-base-v2`: the base model was fine-tuned on Vietnamese medical entity data (`giai_doan_13_ner_finetune_phobert`, selected seed 123, export `seed_123_lr3e-05_ep8_wd0.05`) and converted to the inference-only file set in this release. That modification and its date are recorded here as required.

- Licence text: `services/inference/licenses/AGPL-3.0.txt`, copied verbatim from `https://huggingface.co/vinai/phobert-base-v2/raw/main/LICENSE` (SHA-256 `20b067f86de375aae6db0f283ab2e65de24d537733b89bd58432c101259d84cf`), and shipped in the image at `/opt/vodoco/licenses/AGPL-3.0.txt`.
- Corresponding Source, for section 13 of the licence: the complete source used to generate, train and run this component is the project repository `https://github.com/tkhieu/VoDoCo`, containing the fine-tuning notebook, the export and preparation scripts, the frozen Python lock and the container build. Anyone interacting with this deployment over a network may request that source; if repository access is unavailable to them, the operator provides it directly.
- The demo itself does not modify or redistribute the licence text, and no warranty is offered beyond that stated by the licence.

## Web application

The self-hosted Noto Sans Variable assets are licensed under the SIL Open Font License 1.1; the upstream licence is shipped at `/noto-sans-OFL.txt`. TypeScript and Python dependencies retain their own licences in their lock files and packages.

## Limits of this attestation

Public redistribution of the weights, publication of weights into Git, redistribution outside the attested single-GPU password-protected demo, and cloud spend remain unapproved. If the audience or the deployment changes, revisit the XLM-R terms with its authors and confirm that the Corresponding Source channel is still reachable by the people interacting with the service.
