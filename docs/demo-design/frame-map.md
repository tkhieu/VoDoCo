# VoDoCo Pencil-to-web handoff

## Source and extraction

The implementation reproduces the approved **Calm Clinical Notebook** product UI. It does not introduce a new visual direction. `UI_DIRECTION.md` controls behavior and `contracts/demo-api.openapi.yaml` controls HTTP types; illustrative Pencil transcripts and model readiness are never live fixtures.

All nine reference images were exported through the live Pencil MCP `execute` tool using `Export(ids, 'png', outputDirectory, {scale: 1})` on 2026-09-18. MCP returned the absolute exported paths. The canvas was accessed with `Get` and `Export` only; no nodes, variables, components, or `design.pen` bytes were changed or parsed through filesystem tools.

| Approved source | Native bounds reported by Pencil | Export | Implementation |
|---|---:|---|---|
| `JNywo`, input | 1440 × 900 | [Input](references/JNywo.png) | `apps/web/src/features/AudioInput.tsx` |
| `nFGw4`, review | 1440 × 900 | [Review](references/nFGw4.png) | `features/Workspace.tsx`, `features/Entities.tsx` |
| `IpaIy`, comparison | 1440 × 900 | [Compare](references/IpaIy.png) | Workspace compare tab, always current raw ASR |
| `oH48M`, mobile review | 390 × 1280 full document | [Mobile](references/oH48M.png) | Single-column document flow, normal-flow export/new-record actions |
| `hWGm3`, input/model states | 1440 × 1690 | [Input states](references/hWGm3.png) | AudioInput recording, preview, readiness, missing/error states |
| `TG7d9`, review/export states | 1440 × 1992 | [Review states](references/TG7d9.png) | Draft editor, stale invalidation, manual confirmation, entity details, dialogs, benchmark |
| `w1UboP`, recovery states | 1440 × 1826 | [Recovery states](references/w1UboP.png) | Inline audio/ASR/NER errors, empty entities, offsets disclosure, retained session |
| `g7O8Qc`, design tokens | 4950 × 320 | [Tokens](references/g7O8Qc.png) | `src/styles.css` theme tokens |
| `GFFWr`, implementation handoff | 390 × 1311 | [Handoff](references/GFFWr.png) | Responsive rules, accessibility, data semantics |

The mobile frame title mentions a 390 × 844 viewport, but the actual frame is a 1280px-tall scroll document. It must not be squashed into 844px. Native-scale export was requested explicitly; no separate higher-density export or file-pixel metadata validation was run. Tool-rendered previews can be resized or re-encoded and are not evidence of the on-disk image format or density.

## Approved tokens and deliberate implementation choices

- Light canvas `#F7F8FA`, white document surfaces, ink `#18212F`, muted `#526174`, teal `#0F766E`, hover `#115E59`, decorative border `#E2E8F0`, control border `#64748B`, focus `#2563EB`.
- Noto Sans Variable, self-hosted through pinned Fontsource assets with explicit Latin and Vietnamese subsets. No third-party font requests. Lucide outline icons only.
- A 1200px container, 32px desktop and 16px mobile gutters, 64px header, 12px panels, 8px controls, minimum 44px actions. Desktop review uses a flexible transcript and a minimum-320px entity column; tablet/mobile stack in reading order.
- Transcript type is 19/32px desktop and 17/29px mobile. Body controls remain 16px. Entity color groups and all eighteen Vietnamese labels follow the source.
- Native audio controls deliberately replace the illustrative custom Pencil player, as explicitly permitted by `UI_DIRECTION.md`, to preserve keyboard and playback semantics. “Nghe từ đầu” resets actual playback time, not entity alignment.
- Radix-backed tabs, dialogs, and model popover follow the shadcn copy-owned component pattern. Dialog focus is contained, Escape closes, and focus returns to the visible trigger. Mobile export and new-record controls remain in normal document flow.
- Motion is limited to 160ms state feedback and is disabled for reduced-motion preference. No waveform, progress percentage, timer estimate, typewriter transcript, diagnostic certainty, or winner badge is invented.

## State and provenance mapping

`src/lib/session.ts` owns the in-memory session. HTTP types are imported from generated `contracts/generated/demo-api.ts`; no duplicated HTTP schema is maintained.

- Browser creates a job UUID and separate 256-bit capability before submission. Capabilities stay in memory and request headers only.
- Ambiguous submissions poll the known identity; a receiving upload remains receiving. Connection loss pauses with an explicit resume control. Terminal unavailable jobs permit explicit new attempts without discarding the audio or draft.
- Polls are sequential, slower in hidden documents, and bounded to ten minutes per client wait. Session, source, revision, exact hash, model identity, active job, and polling generation reject stale replies.
- Raw ASR is immutable. Draft edits synchronously increment revision, clear confirmation and remove old review results/highlights. Updating a draft runs NER only. Model selection is explicit.
- Comparison uses raw ASR for both models, submits only missing results, keeps independent errors/loading/results, and preserves the review draft.
- Unicode code-point offsets are mapped to UTF-16 boundaries and exact substring equality is required. Unmapped, mismatching, or overlapping spans remain list-only; repeated occurrences are not merged or located by first-string search.
- TXT is the exact selected text, with source/revision/model/review state in its generated filename. JSON retains raw, optional draft, per-model source/revision/hash/results and provenance. Stale entities are omitted, not silently reassigned. Neither format includes audio bytes, object URLs, job capabilities, or server paths.
- Export failures preserve the session. The success message reports download initiation only. New session and browser departure warn about in-memory data; no autosave or completed cloud-job cancellation is promised.
- Offline benchmark starts collapsed and cites stage-14 corrected gold results: XLM-R 58.62%, PhoBERT 62.42%, 3,497 test sentences. It is never the uploaded audio's score.

## Runtime integration

The package pins Node 24.20.0 and npm 11.19.0. `package-lock.json` pins installed dependencies. Scripts generate API types, typecheck client and server, build Vite plus Main's Express entrypoint with esbuild, and serve `dist-server/index.js`. Vite development proxies `/api` to `127.0.0.1:3000`.

Audio sample capability and bytes are fetched from Main's BFF endpoints `/api/sample` and `/api/sample/audio`. The owner approved the existing research sample for the password-protected demo during implementation. The source audio is not copied into public frontend assets. If the service does not configure it or cannot serve it, the UI keeps upload and recording available and explains the actual unavailable condition.

The browser explains Replit transit, RunPod processing, bounded ephemeral results and tab-memory lifetime. It does not claim local-only processing or patient-data compliance.

## Verification handoff

Per the assigned integration freeze, no build, test, lint, formatter, browser verification, or model execution was run by the UI owner. Dependency installation and OpenAPI code generation completed successfully. Pencil reference reading/exporting completed through actual MCP. Input, review, compare and mobile image previews plus all state-board text were inspected as design sources, not as screenshots of the implemented app.

`src/lib/boundaries.test.ts` contains focused regressions for supplementary Unicode/repeated occurrences, ambiguous spans, and an in-flight NER result arriving after a newer draft edit, including stale-safe export assertions. Main owns running these and the integration checks after all edits settle.

Main must exercise the application against the real BFF/service at 1440×900, 1024×768, 1023px, 390×844 and 375px; verify keyboard focus, 200% zoom, Vietnamese font loading, reduced motion, microphone denial/stop/permission-race cleanup, same-ID receiving recovery, independent model errors, stale edits during inference, and TXT/JSON contents. Native-format advertising must remain contingent on real decoder verification; the default input hint therefore states duration/byte policy rather than claiming all codecs have already passed.

## Remaining external gates

Actual cloud deployment, password-gate coverage, GPU inference proof, public ingress limits and operator approvals belong to Main's integration/deployment phases. This handoff does not claim that local package installation or Pencil exports prove those gates.
