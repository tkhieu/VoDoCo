# VoDoCo operator runbook

Start, demo, stop and recover the password-protected VoDoCo demo. Every command here was exercised locally except the provider-facing steps, which are marked **unverified** and exist only until an authorized operator runs them. Live measurements and the local-vs-deployed split are in [`demo-acceptance.md`](demo-acceptance.md); model provenance and rights are in [`demo-readiness.md`](demo-readiness.md).

Never place the demo password, the service token, the registry token or provider account keys in this repository, in a shell history on a shared machine, or in a screenshot. Never copy raw patient data into the demo.

## Docker Compose + Cloudflare Tunnel (`vodoco.hieutk.dev`)

This is the normal self-hosted demo path. Cloudflare is the only ingress, the web BFF is the only tunnel origin, and inference stays on an isolated Docker network. No host port is published.

### One-time local prerequisites

1. Keep the prepared model release at `.local/vodoco-models/release`. Its `manifest.json` must match `services/inference/model-manifest.json`.
2. Put one owner-approved, non-patient sample at `.local/vodoco-samples/demo.wav`. This ignored path is mounted read-only and is never copied into an image.
3. Create the internal service credential:

   ```sh
   umask 077
   printf 'INFERENCE_SERVICE_TOKEN=' > .env.service.local
   openssl rand -hex 32 >> .env.service.local
   ```

4. If the host differs from this workstation, create an ignored `.env` containing only the non-secret Compose substitutions that need changing:

   ```dotenv
   VODOCO_PUBLIC_ORIGIN=https://vodoco.hieutk.dev
   NVIDIA_DRIVER_LIBRARY_DIR=/usr/lib64
   NVIDIA_DRIVER_VERSION=615.71.09
   VODOCO_UID=1000
   VODOCO_GID=1000
   ```

   This workstation uses the values above. Keep the service token only in `.env.service.local`, not in `.env`.

The Compose inference target mounts weights instead of baking them into another image. It uses the locally proven `/dev/nvidia0`, `/dev/nvidiactl`, `/dev/nvidia-uvm` and versioned driver-library mapping because this host has no NVIDIA Docker runtime or CDI registration.

After an NVIDIA package update, set `NVIDIA_DRIVER_VERSION` to the suffix of the installed `libcuda.so.*`, `libnvidia-ptxjitcompiler.so.*` and `libnvidia-gpucomp.so.*` files before starting Compose. If inference then fails readiness with a kernel/user-space driver mismatch and `/proc/driver/nvidia/version` still reports the previous version, reboot the host before retrying.

### One-time Cloudflare owner setup

Do this in the Cloudflare dashboard; never paste account credentials or the tunnel token into chat or Git.

1. Confirm `hieutk.dev` is an active Cloudflare zone.
2. Create a Cloudflare Access self-hosted application for `vodoco.hieutk.dev` and an owner-approved Allow policy. A Tunnel provides transport, not audience authentication; publishing without Access violates this demo's password-protected authorization boundary.
3. Create a remotely managed tunnel such as `vodoco-local`.
4. Add one **Published application** route:
   - Hostname: `vodoco.hieutk.dev`
   - Service: `http://web:3000`
   - HTTP Host Header: `vodoco.hieutk.dev`
   - No path filter, no TLS-verification override, and no route to inference
5. Copy the tunnel token directly to `.local/vodoco-secrets/cloudflare-tunnel-token`, then set the directory to mode `0700` and the file to `0600`.

The connector image is pinned to `cloudflare/cloudflared:2026.9.1` by digest. Anyone holding the tunnel token can run another connector, so rotate it after suspected exposure.

### Start and stop

After the one-time prerequisites, the complete stack starts with:

```sh
docker compose up -d
docker compose ps
```

The first start builds the web image and the weightless inference runtime image. Normal subsequent starts reuse them. Wait until `inference`, `web`, and `cloudflared` are healthy, then authenticate through Cloudflare Access at:

```text
https://vodoco.hieutk.dev
```

Inspect bounded logs without exposing environment files:

```sh
docker compose logs --tail=100 inference web cloudflared
```

Stop the stack and release GPU ownership with:

```sh
docker compose down --timeout 20
```

Do not add `ports:` to the Compose services. A direct host port would bypass Cloudflare Access.

### Failure boundaries

- `cloudflared` health proves an active Cloudflare edge connection, not that the hostname route or Access policy is correct.
- Web `/healthz` proves the BFF process is alive.
- Inference `/health/live` proves the ASGI process is alive. Authenticated `/v1/models` is the original three-model compatibility surface; the current web demo uses `/v2/models` for four-model readiness.
- An unauthenticated HTTP `200` from `https://vodoco.hieutk.dev` is a deployment failure. Cloudflare Access must challenge or deny before the app is reachable.
- Keep Cloudflare cache rules away from `/api/*`; the BFF returns `Cache-Control: no-store`.


## 0. Clearing the owner gates, in order

Only three things below are genuinely owner-only: the licence decision, the choice of registry, and the spend ceiling plus shutdown deadline. Everything else is account access, and an implementer can execute it once the owner is signed in on the working machine (or once a live browser session is available).

| Step | Owner | Implementer, once access exists |
|---|---|---|
| 0.1 licence decision | decided and recorded 2026-09-19 | notices, AGPL text and source offer written and shipped in the image |
| 0.2 registry | choose host, provide a push login and a read-only pull token | tag, push, record the digest |
| 0.3 RunPod | create the account, fund it, set the ceiling and deadline | create the secret, template and Pod by digest, verify readiness |
| 0.4 Replit | provide account access | set secrets, enable Password protected, publish, verify |
| 0.5 hand-back | confirm the three decisions | run steps 1–6, run the acceptance matrix, stop the Pod, report |

**Do not paste secrets into chat.** Sign in on the working machine (`docker login`, provider CLI, or a live browser session) or enter values directly in provider secret stores, and share only the secret's name.

### 0.1 Licence position (cleared 2026-09-19)

The owner authorised the original three checkpoints and subsequently supplied `vihealthbert-ner-seed2024` for this same password-protected demo, bringing the release to four checkpoints. Public redistribution and weights in Git remain prohibited. The ViHealthBERT export declares no source repository, revision or licence, so its authorization is private-demo-only. The attestations are recorded in `services/inference/model-manifest.json` and [`../services/inference/THIRD_PARTY_NOTICES.md`](../services/inference/THIRD_PARTY_NOTICES.md), which also carries the PhoBERT modification statement, the verbatim AGPL text at `services/inference/licenses/AGPL-3.0.txt`, and the section-13 Corresponding Source offer. Both are shipped inside the image under `/opt/vodoco/`.

Two facts to keep in mind when pushing:

- `leduckhai/VietMed-NER` (XLM-R) declares no licence and publishes none; only the attestation above covers it. `leduckhai/MultiMed-ST` declares MIT in its model-card metadata but publishes no licence text at the path its README links to (verified 404), so no MIT text is reproduced.
- The owner-provided ViHealthBERT export declares no upstream repository, revision or licence. Keep it inside this password-protected demo and do not treat the folder name as licence evidence.
- Public redistribution, weights in Git, and cloud spend remain unauthorised. Do not widen the audience without revisiting the XLM-R terms with its authors.

The local Cloudflare path is implemented by `compose.yaml`: only the web BFF is tunneled, inference remains private, and the weights stay on this workstation. The workstation must remain powered and online for the demo window.

### 0.2 Create one private registry and one read-only pull credential

Either registry works; GHCR avoids Docker Hub's anonymous pull limits.

```sh
# GHCR
echo "$GHCR_PAT" | docker login ghcr.io -u <github-user> --password-stdin
docker tag vodoco-inference:local-20260919 ghcr.io/<owner>/vodoco-inference:<tag>
docker push ghcr.io/<owner>/vodoco-inference:<tag>

# or Docker Hub, as a private repository
docker login -u <dockerhub-user>
docker tag vodoco-inference:local-20260919 <dockerhub-user>/vodoco-inference:<tag>
docker push <dockerhub-user>/vodoco-inference:<tag>
```

Create a second credential scoped to read/pull only for the Pod. Push credentials never go on the Pod, and neither credential belongs in the repository or in a chat message.

### 0.3 Create the RunPod account, secret and spend decision

1. Create the account, add billing credit, and confirm the account may run a public-IP Pod.
2. Create a RunPod secret named `vodoco_inference_token` holding a fresh `openssl rand -hex 32` value. It must differ from any token used locally.
3. Read the live on-demand price for a single suitable GPU in the console and record it, along with a hard shutdown deadline and a maximum acceptable spend. Availability changes hourly; no price quoted in this repository should be trusted.
4. Confirm the chosen GPU has comfortable headroom above the measured four-model peak of 3,179,282,432 bytes reserved (approximately 2.96 GiB), and that the region's driver supports the CUDA 12.8 runtime the image ships.
5. Create the template from `deploy/runpod/template-settings.json` with the digest from step 1, container disk 32 GB, no volume, and port `8000/http`.

### 0.4 Prepare the Replit side

1. Import the repository into a Replit app. The committed `.replit` already pins `nodejs-24`, builds `apps/web` and starts `dist-server/index.js`, mapping external port 80 to the app's port 3000.
2. Add production secrets: `APP_ORIGIN` (the published HTTPS origin, no path), `INFERENCE_BASE_URL` (`https://<pod-id>-8000.proxy.runpod.net`), `INFERENCE_SERVICE_TOKEN` (the same value as the Pod secret), and the three `DEMO_SAMPLE_*` values.
3. Enable **Publishing → Password protected** and deliver the password out of band.
4. Keep the preview deployment free of `INFERENCE_BASE_URL` and `INFERENCE_SERVICE_TOKEN`, so an unauthenticated preview cannot reach the GPU.

### 0.5 Hand back, then the implementer continues

Tell the implementer that steps 0.1–0.4 are done, plus the recorded spend ceiling and deadline. Either sign in on this machine (`docker login`, provider CLI, or a live browser session) or supply values only through provider secret stores — never as chat text. From there the implementer runs steps 1–6 below, executes the acceptance matrix, stops the Pod, and reports the residual storage position.

Do not substitute a checkpoint-less or CPU-only Pod: an XLM-R-only deployment does not satisfy the selected demo.

## 1. Build and publish the image

```sh
docker build -f deploy/runpod/Dockerfile -t <registry>/vodoco-inference:<tag> .
docker push <registry>/vodoco-inference:<tag>
docker image inspect --format '{{index .RepoDigests 0}}' <registry>/vodoco-inference:<tag>
```

Record the printed digest in the handoff. Deploy by digest, not by tag, so a later push cannot change what the Pod runs.

The image already contains the frozen Python environment, the real 31-asset model release at `/opt/vodoco/models`, the manifest at `/opt/vodoco/model-manifest.json`, the third-party notices at `/opt/vodoco/THIRD_PARTY_NOTICES.md` with the licence texts under `/opt/vodoco/licenses/`, `ffmpeg`, a non-root user (uid 10001) and read-only weights. It reads `INFERENCE_SERVICE_TOKEN`, `VODOCO_MODEL_ROOT`, `VODOCO_MODEL_MANIFEST` and `VODOCO_TEMP_DIR` from the environment and serves port 8000.

Before pushing, confirm the licence material actually reached the image and is readable by the runtime user. `.dockerignore` is an allowlist (`**` first), so newly added paths are excluded until they are allowed, and a directory copied with `--chmod=0444` loses its execute bit and becomes untraversable — both were caught here only by inspecting the built image:

```sh
docker run --rm --entrypoint sh <registry>/vodoco-inference@sha256:<digest> -c '
  set -e
  sha256sum /opt/vodoco/THIRD_PARTY_NOTICES.md /opt/vodoco/licenses/AGPL-3.0.txt /opt/vodoco/model-manifest.json
  cmp /opt/vodoco/model-manifest.json /opt/vodoco/models/manifest.json && echo "manifest copies identical"
  id -u; stat -c "%a %n" /opt/vodoco/licenses'
```

The three SHA-256 values must match `services/inference/THIRD_PARTY_NOTICES.md`, `services/inference/licenses/AGPL-3.0.txt` and `services/inference/model-manifest.json`, the identity must be `10001`, and `/opt/vodoco/licenses` must be `0755` so the licence text stays readable.

Local verification (no CDI on this workstation, so the GPU is passed explicitly):

```sh
docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges \
  --device /dev/nvidia0 --device /dev/nvidiactl --device /dev/nvidia-uvm \
  --mount type=bind,src=/usr/lib64/libcuda.so.<driver>,dst=/usr/lib/x86_64-linux-gnu/libcuda.so.1,readonly \
  --mount type=bind,src=/usr/lib64/libnvidia-ptxjitcompiler.so.<driver>,dst=/usr/lib/x86_64-linux-gnu/libnvidia-ptxjitcompiler.so.1,readonly \
  --mount type=bind,src=/usr/lib64/libnvidia-gpucomp.so.<driver>,dst=/usr/lib/x86_64-linux-gnu/libnvidia-gpucomp.so.<driver>,readonly \
  -e INFERENCE_SERVICE_TOKEN <registry>/vodoco-inference@sha256:<digest>
```

The `--device`/library mounts are a workaround for a host without a CDI GPU specification. On the Pod the NVIDIA device plugin injects the device normally; do not copy the mounts there. If the Pod runtime rejects the image, the CUDA 12.8 runtime base and the host driver must be checked before anything else.

## 2. Provision the Pod

Fill `deploy/runpod/template-settings.json` (already present) and create one Pod:

| Setting | Required value |
|---|---|
| Template source | the digest recorded in step 1 |
| Container disk | 32 GB (the image plus four-model release is approximately 25 GB; no volume is mounted) |
| Exposed port | `8000/http`, which yields the fixed origin `https://<pod-id>-8000.proxy.runpod.net` |
| `INFERENCE_SERVICE_TOKEN` | Pod secret, `openssl rand -hex 32`, at least 32 printable ASCII bytes, never reused from local runs |
| `VODOCO_MODEL_ROOT` / `VODOCO_MODEL_MANIFEST` / `VODOCO_TEMP_DIR` | `/opt/vodoco/models`, `/opt/vodoco/model-manifest.json`, `/tmp/vodoco-inference` |
| GPU | one device with comfortable headroom above the measured four-model peak of approximately 2.96 GiB reserved; confirm compute capability and driver on the Pod itself |

Keep exactly one Pod. The service takes an exclusive directory lock and refuses a second ASGI process, so a duplicate Pod cannot silently become a second CUDA owner.

## 3. Verify the Pod before wiring the app

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://<pod-id>-8000.proxy.runpod.net/v2/models   # expect 401
curl -s https://<pod-id>-8000.proxy.runpod.net/health/live                                   # expect {"status":"ok"} (the only unauthenticated route)
curl -s -H "Authorization: Bearer $INFERENCE_SERVICE_TOKEN" \
  https://<pod-id>-8000.proxy.runpod.net/v2/models | head -c 600                              # expect asr/phobert/xlmr/vihealthbert-ner-seed2024 ready
```

The Pod is reachable before the checkpoints finish loading, so poll `/v2/models` until all four report `ready` rather than treating the first response as final. `/v1/models` deliberately remains limited to the original three keys for strict-client compatibility. Re-measure cold-load time and GPU peak on the final four-model image; the earlier three-model figures do not include ViHealthBERT.

Then run one real job for each NER selection to prove decode and model routing on the Pod's own GPU:

```sh
id=$(uuidgen); token=$(openssl rand -hex 32)
sha=$(sha256sum giai_doan_14_hoan_thien/audio.wav | cut -d' ' -f1)
curl -s -X PUT "https://<pod-id>-8000.proxy.runpod.net/v1/audio-jobs/$id?ner_model=phobert" \
  -H "Authorization: Bearer $INFERENCE_SERVICE_TOKEN" -H "X-Job-Token: $token" \
  -H "X-Session-Id: $(uuidgen)" -H "X-Input-Sha256: $sha" \
  -H 'Content-Type: application/octet-stream' --data-binary @giai_doan_14_hoan_thien/audio.wav
curl -s -H "Authorization: Bearer $INFERENCE_SERVICE_TOKEN" -H "X-Job-Token: $token" \
  "https://<pod-id>-8000.proxy.runpod.net/v1/jobs/$id"
```

Expect `202` then a terminal `succeeded` job whose `asr.text_sha256` matches the local value `e84f1d06d764f319e37e7f060f388429c010a0a05a4a95a2c74ddae383e4bbb3` and whose model identities list `cuda:0`. A different hash means the wrong checkpoint or a different decode path: stop and investigate before publishing.

## 4. Configure and publish the Replit app

Set these as production secrets on the published app, not in the repository:

| Variable | Value |
|---|---|
| `APP_ORIGIN` | the intended published HTTPS origin, no path or credentials |
| `INFERENCE_BASE_URL` | `https://<pod-id>-8000.proxy.runpod.net` |
| `INFERENCE_SERVICE_TOKEN` | the same Pod secret |
| `DEMO_SAMPLE_APPROVED` / `DEMO_SAMPLE_PATH` / `DEMO_SAMPLE_PROVENANCE` | `1`, `giai_doan_14_hoan_thien/audio.wav`, the approved provenance sentence |

The BFF refuses to start with a short or non-printable token, a non-HTTPS non-loopback origin, or an upstream that is not the fixed `*-8000.proxy.runpod.net` origin. Failures here are configuration errors, not model errors.

Turn on **Password protected** in Publishing access settings and keep the shared password out of band. Verify the preview deployment does **not** carry `INFERENCE_BASE_URL` or `INFERENCE_SERVICE_TOKEN`, so an unauthenticated preview cannot reach the GPU.

## 5. Demo and post-publish checks

Present in this order: sample or upload, transcription, review, comparison, export.

- Typing the published URL without the password, and calling the Pod directly without the service token, must both fail before any inference.
- Upload one approved clip and confirm the stages advance, the player works and the review/compare tabs keep their own state.
- Confirm the benchmark block stays offline-labelled and never appears as the uploaded clip's score.
- Re-run the exactly-10 MiB and over-10 MiB requests through the published origin and the Pod proxy to confirm both real proxies agree with the local results; this is the one limit that has not traversed two production proxies.

## 6. Stop, cost safety and rollback

```sh
# after the live window: stop the Pod from the RunPod console (or with the provider CLI)
curl -s -H "Authorization: Bearer $INFERENCE_SERVICE_TOKEN" https://<pod-id>-8000.proxy.runpod.net/v2/models   # must fail
```

Then confirm in the provider console that the Pod is stopped (not merely idle), that no other Pod or volume is attached to this demo, that the disabled inference token is revoked, and that any residual storage charge is recorded in the handoff. Terminating the Pod discards the container disk; the model release and the image are reproducible from the repository, registry and approved artifacts, so do not delete those.

Rollback: republish the previous Replit deployment, point `INFERENCE_BASE_URL` at a Pod running the previously recorded digest, and repeat step 3. Recovery after a model-load failure keeps the page healthy — the browser keeps received text and the draft while readiness reports the real error, and the worker is restarted at most twice in ten minutes before requiring operator action. Restore service by restarting the Pod, not by editing the running container.

## 7. What is already proven, and what is not

Proven locally against the real models and the production build: authenticated readiness, upload and duration boundaries, admission and replay isolation, immutable ASR, both NER adapters, partial results, worker supervision and cleanup, tokenizer limits, microphone allow/deny and recording, TXT/JSON provenance, responsive and zoom layout, reduced motion, GPU execution inside the published image, and a clean `docker stop`.

Not proven until an operator performs steps 2–6: provider ingress and cold start, the password gate under bypass attempts, proxy-to-proxy behaviour at the exact 10 MiB boundary, Pod-specific GPU/driver readiness, published rollback and confirmed billing stop.
