# Plan: Voice-Agent Redesign

**Generated**: 2026-03-12

## Overview
Rebuild CodexRealtime toward a desktop shell + local server shape while keeping voice agent as the product center: thin desktop shell, local server as source of truth, schema-first contracts, durable thread/session state, event/projection core, and a renderer that consumes one transport API instead of talking to Electron internals directly.

Assumption used for this plan: target shape is `desktop shell + local server`, not a pure web app and not the current single-app Electron architecture. This keeps native mic/audio control as the differentiator while moving orchestration and state to the server boundary.

Hard-cut policy for this redesign:
- Prefer one canonical new path.
- Do not carry long-lived compatibility bridges between old IPC/state flow and new server/event flow.
- Cut over in slices, but delete old code once each slice reaches parity.

## External References
- OpenAI Codex SDK and app server docs: [developers.openai.com/codex/sdk](https://developers.openai.com/codex/sdk/)
- Electron process model: [electronjs.org/docs/latest/tutorial/process-model](https://www.electronjs.org/docs/latest/tutorial/process-model)
- TanStack Router overview: [tanstack.com/router/latest/docs/framework/react/overview](https://tanstack.com/router/latest/docs/framework/react/overview)
- TanStack Query overview: [tanstack.com/query/latest/docs/framework/react/overview](https://tanstack.com/query/latest/docs/framework/react/overview)
- Effect docs: [effect.website](https://effect.website/)

## Current-State Readout
- Current repo is mostly `apps/desktop` plus `packages/shared`.
- Main process owns too much orchestration today: workspace loading, Codex bridge, realtime session flow, approvals, timeline shaping.
- Renderer voice hook (`use-realtime-voice`) mixes mic control, transport, heuristics, and UI state.
- Shared contracts exist, but not as a hard runtime-validated boundary.
- The target split is `apps/server`, `apps/web`, `apps/desktop`, `packages/contracts`, `packages/shared`, durable provider sessions, canonical runtime events, and a replayable WS transport.

## Prerequisites
- Create a dedicated branch before starting. Suggested name: `codex/voice-agent-redesign`.
- Keep a short ADR in the repo for the target shape and cutover rules before implementation begins.
- Decide one canonical persistence root for local server state, thread sessions, and logs.
- Use runtime-validated contracts for all new cross-process or cross-app boundaries.

## Dependency Graph

```text
T0 ── T1 ──┬── T2 ──┬── T2.1 ──┐
           │        │          │
           │        ├── T3 ──┬── T4 ──┬── T6 ── T6.1 ──┬── T7 ──┐
           │        │        │        │                │        │
           │        │        └── T10 ─┘                └── T8 ──┼── T10.1 ──┬── T11 ── T12
           │        │                                             │           │
           │        └── T5 ───────────────────────────────────────┘           │
           │                                                                  │
           └─────────────────────────────────────────────────────────── T9 ────┘
```

## Tasks

### T0: Create Redesign Branch And ADR
- **depends_on**: []
- **location**: `/Users/espenmac/Code/CodexRealtime`, `/Users/espenmac/Code/CodexRealtime/docs` or `/Users/espenmac/Code/CodexRealtime/README.md`
- **description**: Create a new branch for the redesign, for example `codex/voice-agent-redesign`. Add a short architecture note that locks the target shape: desktop shell, local server, canonical contracts, hard-cut migration, voice agent first-class. The ADR should also name the persistence root, storage versioning policy, single-writer rule (`apps/server` only), and cutover/delete-old-path rules. This prevents drifting back into incremental patches on the current main/preload/renderer coupling.
- **validation**: `git branch --show-current` shows the new branch; ADR or architecture note exists and names the cutover rules, voice-agent scope, persistence root, schema/versioning approach, and single-writer ownership.
- **status**: Completed
- **log**: Created branch `codex/voice-agent-redesign`. Added ADR capturing target architecture, single-writer persistence rule, migration order, and hard-cut deletion policy.
- **files edited/created**: `/Users/espenmac/Code/CodexRealtime/docs/architecture/voice-agent-redesign.md`

### T1: Split Shared Boundary Into Real Contracts Package
- **depends_on**: [T0]
- **location**: `/Users/espenmac/Code/CodexRealtime/packages`, `/Users/espenmac/Code/CodexRealtime/package.json`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/electron.vite.config.ts`
- **description**: Introduce `packages/contracts` as the hard seam for transport methods, event schemas, thread/session DTOs, approval payloads, voice control commands, and terminal/task progress messages. Split the boundary explicitly into `ShellApi` for desktop-native capabilities, `ServerApi` for orchestration/session/timeline work, and shared DTO/event contracts. Move runtime-only helpers to `packages/shared` or smaller focused packages. Replace stringly-typed IPC constants with central exports.
- **validation**: All cross-boundary types/constants import from `packages/contracts`; runtime validation exists for incoming transport payloads; `ShellApi` and `ServerApi` are separate surfaces; no duplicated channel strings remain in `main` and `preload`.
- **status**: Completed
- **log**: Created `packages/contracts` with shared DTO/event exports, explicit `ShellApi` and `ServerApi` surfaces, and centralized IPC channel constants. Wired `shared` and desktop package/build resolution to the new package, then switched desktop `main` and `preload` to consume contract-backed channel exports instead of duplicated string literals.
- **files edited/created**: `/Users/espenmac/Code/CodexRealtime/package.json`, `/Users/espenmac/Code/CodexRealtime/tsconfig.base.json`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/package.json`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/electron.vite.config.ts`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/preload/index.ts`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/preload/global.d.ts`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/main/ipc.ts`, `/Users/espenmac/Code/CodexRealtime/packages/shared/package.json`, `/Users/espenmac/Code/CodexRealtime/packages/shared/src/index.ts`, `/Users/espenmac/Code/CodexRealtime/packages/contracts/package.json`, `/Users/espenmac/Code/CodexRealtime/packages/contracts/tsconfig.json`, `/Users/espenmac/Code/CodexRealtime/packages/contracts/src/index.ts`, `/Users/espenmac/Code/CodexRealtime/packages/contracts/src/ipc.ts`, `/Users/espenmac/Code/CodexRealtime/packages/contracts/src/shell-api.ts`, `/Users/espenmac/Code/CodexRealtime/packages/contracts/src/server-api.ts`

### T2: Extract Local Server App Skeleton
- **depends_on**: [T1]
- **location**: `/Users/espenmac/Code/CodexRealtime/apps/server`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/main`
- **description**: Create `apps/server` as the new source of truth for sessions, orchestration, and provider runtime ingestion. Start with a minimal process entry, lifecycle, health endpoint or handshake, and dependency container. Desktop main should become a launcher/supervisor instead of the place where business logic lives.
- **validation**: Local server starts independently with a health/readiness handshake; `apps/server` builds and tests independently; desktop launcher/supervisor wiring remains deferred to T2.1.
- **status**: Completed
- **log**: Created standalone `@codex-realtime/server` workspace package with an independent entrypoint, health/ready HTTP handshake, and injectable container/logger/session store skeleton. Added RED->GREEN server tests and kept desktop bootstrap changes deferred to T2.1.
- **files edited/created**: `/Users/espenmac/Code/CodexRealtime/apps/server/package.json`, `/Users/espenmac/Code/CodexRealtime/apps/server/tsconfig.json`, `/Users/espenmac/Code/CodexRealtime/apps/server/src/index.ts`, `/Users/espenmac/Code/CodexRealtime/apps/server/src/server.ts`, `/Users/espenmac/Code/CodexRealtime/apps/server/src/server.test.ts`, `/Users/espenmac/Code/CodexRealtime/voice-agent-redesign-plan.md`

### T2.1: Add Desktop Bootstrap, Packaging, And Server Supervision
- **depends_on**: [T2]
- **location**: `/Users/espenmac/Code/CodexRealtime/apps/desktop`, `/Users/espenmac/Code/CodexRealtime/apps/server`, `/Users/espenmac/Code/CodexRealtime/package.json`
- **description**: Define how desktop launches, packages, supervises, and reconnects to `apps/server` in both dev and production. Cover path resolution, readiness timeout, crash policy, restart behavior, shutdown ordering, log capture, and version-mismatch handling between shell and server.
- **validation**: Desktop can launch and stop the local server in dev and packaged builds; readiness timeout and crash policy are tested; shell/server version mismatch behavior is explicit and observable.
- **status**: Completed
- **log**: Added desktop local-server bootstrap and shutdown wiring, plus a dedicated `LocalServerProcess` supervisor that resolves the dev vs packaged entry path, waits for the readiness handshake, fails fast on shell/server version mismatch, and surfaces post-ready crashes explicitly instead of letting the shell limp on. Updated root build/dev scripts to compile and bundle `apps/server` into the desktop output, added tests for entry resolution, startup timeout, version mismatch, and unexpected post-ready exit, and normalized contracts ESM export paths so the packaged server process resolves cleanly under NodeNext.
- **files edited/created**: `/Users/espenmac/Code/CodexRealtime/package.json`, `/Users/espenmac/Code/CodexRealtime/apps/server/package.json`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/main/index.ts`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/main/local-server-process.ts`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/main/local-server-process.test.ts`, `/Users/espenmac/Code/CodexRealtime/scripts/copy-local-server.mjs`, `/Users/espenmac/Code/CodexRealtime/packages/contracts/src/index.ts`, `/Users/espenmac/Code/CodexRealtime/packages/contracts/src/server-api.ts`, `/Users/espenmac/Code/CodexRealtime/packages/contracts/src/shell-api.ts`

### T3: Define NativeApi And Transport Abstraction
- **depends_on**: [T1, T2]
- **location**: `/Users/espenmac/Code/CodexRealtime/packages/contracts`, `/Users/espenmac/Code/CodexRealtime/apps/server`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/preload`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/renderer`
- **description**: Define one app-facing API that the renderer consumes regardless of whether the backend is local Electron or future web. Model request/response methods, push subscriptions, reconnect behavior, sequence numbers, replay-latest semantics, and auth/bootstrap. This is the seam that lets renderer reloads survive without losing the active session model.
- **validation**: Renderer accesses backend through one `NativeApi`-style surface; reconnect and snapshot-resync behavior are specified and testable; direct renderer knowledge of Electron IPC details is removed.
- **status**: Not Completed
- **log**: T3-A complete: added `packages/contracts/src/native-api.ts`, exported `NativeApi` from contracts, and exposed `window.nativeApi` from preload/global typing as the canonical renderer-facing seam. T3-B complete: removed the old `appBridge` exposure/type alias, added a renderer-side `native-api` adapter, switched `App.tsx`, voice/settings hooks, and tests over to the canonical `NativeApi`, and verified the renderer no longer references Electron IPC details directly. T3 overall stays open for the broader transport reconnect/snapshot-resync semantics and explicit replay-latest behavior.
- **files edited/created**: `/Users/espenmac/Code/CodexRealtime/packages/contracts/src/index.ts`, `/Users/espenmac/Code/CodexRealtime/packages/contracts/src/native-api.ts`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/preload/index.ts`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/preload/global.d.ts`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/renderer/src/native-api.ts`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/renderer/src/native-api.test.ts`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/renderer/src/App.tsx`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/renderer/src/use-app-settings.ts`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/renderer/src/use-worker-settings.ts`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/renderer/src/use-realtime-voice.ts`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/renderer/src/use-realtime-voice.test.tsx`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/e2e/app-regression.test.ts`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/renderer/src/vite-env.d.ts`

### T4: Build Durable Provider Session Directory
- **depends_on**: [T3]
- **location**: `/Users/espenmac/Code/CodexRealtime/apps/server/src/provider`, `/Users/espenmac/Code/CodexRealtime/apps/server/src/persistence`
- **description**: Persist thread-to-provider bindings, runtime mode, resume cursor, active request state, and any provider payload needed to resume voice or text work after reload/crash. Make thread session lookup authoritative on the server rather than implicit inside one in-memory bridge. Include storage schema versioning, atomic write/rename rules, corrupt-state recovery, and explicit server-only writer ownership.
- **validation**: Restarting desktop or reloading renderer preserves thread/session identity through the transport bootstrap flow; session lookup is file- or DB-backed; provider resume state is inspectable and recoverable; persistence uses versioned storage, atomic writes, startup recovery, and a single-writer model.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T5: Canonicalize Provider Runtime Events Early
- **depends_on**: [T2]
- **location**: `/Users/espenmac/Code/CodexRealtime/packages/contracts`, `/Users/espenmac/Code/CodexRealtime/apps/server/src/provider`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/main/timeline-runtime-events.ts`
- **description**: Convert raw Codex/OpenAI runtime messages into a canonical event schema before UI or projections touch them. Cover session lifecycle, thread/turn/item changes, tool calls, approvals, audio input/output deltas, interruptions, errors, and usage. Remove `unknown`-heavy normalization from renderer and desktop main.
- **validation**: Raw provider payloads map to typed runtime events in one place; renderer no longer parses provider-specific JSON shapes; audio and tool/task events are first-class variants in the contract; command idempotency and source ordering fields such as `commandId`, `sourceEventId`, and `sourceSeq` are defined for replay and dedupe.
- **status**: Completed
- **log**: Added canonical provider runtime request/notification + item schemas in `packages/contracts`, including replay metadata (`commandId`, `sourceEventId`, `sourceSeq`) and first-class session/thread/turn/tool/audio/error/usage variants. Switched desktop timeline request/notification normalization to consume canonical runtime events at the boundary, kept historical turn projection behavior intact, and added RED->GREEN coverage in the existing timeline runtime test. Added `apps/server/src/provider/runtime-events.ts` as the server-side re-export entry point for future ingestion work.
- **files edited/created**: `/Users/espenmac/Code/CodexRealtime/packages/contracts/package.json`, `/Users/espenmac/Code/CodexRealtime/packages/contracts/src/index.ts`, `/Users/espenmac/Code/CodexRealtime/packages/contracts/src/provider-runtime.ts`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/main/timeline-runtime-events.ts`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/main/timeline-runtime-events.test.ts`, `/Users/espenmac/Code/CodexRealtime/apps/server/src/provider/runtime-events.ts`

### T6: Introduce Orchestration Event Store And Projections
- **depends_on**: [T3, T4, T5]
- **location**: `/Users/espenmac/Code/CodexRealtime/apps/server/src/orchestration`, `/Users/espenmac/Code/CodexRealtime/apps/server/src/persistence`
- **description**: Replace ad-hoc timeline assembly with a command -> event -> projection pipeline. Project durable read models for workspace/project state, threads, turns, approvals, diffs, terminal activity, voice state, archives, session/account/features, and server-owned worker settings. Use monotonic sequence numbers so transports can replay from a known point, and define projector dedupe rules for reconnect/resume.
- **validation**: Thread and workspace state can be rebuilt from stored events; projections produce the UI read models the renderer actually needs; reconnect can request replay from sequence `N`; projector dedupe and idempotency rules prevent duplicate turns, approvals, transcript segments, and audio entries.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T6.1: Build Test Harness And Gating Coverage
- **depends_on**: [T3, T5, T6]
- **location**: `/Users/espenmac/Code/CodexRealtime/apps/server`, `/Users/espenmac/Code/CodexRealtime/apps/desktop`, `/Users/espenmac/Code/CodexRealtime/packages/contracts`
- **description**: Add the minimum test harness needed to keep the redesign safe before UI cutover. Cover contract validation, reconnect/replay integration, resume semantics, projector idempotency, and voice smoke tests for the new thread/session model.
- **validation**: Contract tests, replay/resume tests, and voice smoke tests run green on the new stack; T7, T8, and T11 cannot proceed without this coverage in place.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T7: Rebuild Renderer State Around Transported Read Models
- **depends_on**: [T3, T5, T6, T6.1]
- **location**: `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/renderer`
- **description**: Slim the renderer down to route/view/state concerns. Adopt a server-owned store boundary and, if useful, TanStack Router/Query for screen state and async cache management. The renderer should subscribe to projected backend read models for workspace/project/thread/archive/session/account/features state, while consuming shell-owned settings and device state only through `ShellApi`.
- **validation**: `App.tsx` no longer acts as a god object; thread/session/workspace/archive views load from backend read models; shell-native prefs and device state arrive only through `ShellApi`; renderer reload does not create a new implicit source of truth.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T8: Extract Voice Domain As A First-Class Server + Native Capability
- **depends_on**: [T5, T6, T6.1]
- **location**: `/Users/espenmac/Code/CodexRealtime/apps/server/src/voice`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/main`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/renderer/src/use-realtime-voice.ts`
- **description**: Keep voice agent as the product core by carving it into explicit capabilities: mic capture, VAD or push-to-talk control, interruption semantics, output audio playback, transcript alignment, and thread attachment. Decide which pieces remain native-only in desktop and which become server-managed state. The key rule: voice should sit on top of the same thread/session model, not beside it.
- **validation**: Voice flows use canonical thread/session IDs; interrupt/reconnect/reload keep coherent state; `use-realtime-voice` shrinks into a thin UI adapter rather than owning system behavior; mic denied/revoked, device hot-swap, sample-rate mismatch, backpressure, and server restart mid-capture are covered in validation or smoke tests.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T9: Thin Desktop Main/Preload Into Shell Adapters
- **depends_on**: [T2.1, T8]
- **location**: `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/main`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/preload`
- **description**: Move desktop-specific responsibilities to narrow adapters: process supervision, permissions, native audio devices, window lifecycle, filesystem pickers, notifications, and secure credential access. Remove orchestration/domain logic from Electron main and preload.
- **validation**: Main/preload primarily proxy native capabilities and server bootstrap; business logic lives in `apps/server`; preload surface is small and contract-backed; missing output device and permission-revocation paths are explicit and testable.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T10: Add Logging Substrate Early
- **depends_on**: [T2, T3]
- **location**: `/Users/espenmac/Code/CodexRealtime/apps/server`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/main`, `/Users/espenmac/Code/CodexRealtime/packages/contracts`
- **description**: Add the logging substrate early: correlation IDs, structured NDJSON sinks, bootstrap logs, transport diagnostics, and thread-scoped terminal/tool logs. This gives the new server and transport layers enough observability before projections and voice cutover land.
- **validation**: Shell launch, server bootstrap, transport handshake, and thread-scoped log records share correlation/thread/session identifiers and are queryable during development.
- **status**: Not Completed
- **log**: T10-A complete: added shared structured logging primitives under `packages/shared/src/structured-log.ts`, including NDJSON sinks plus correlation/thread/session-aware records that serialize error objects into queryable data. T10-B complete: wired desktop bootstrap, local-server supervision, and server bootstrap/handshake flow onto the shared logger, including correlation propagation through `CODEX_REALTIME_BOOTSTRAP_ID` and server log path propagation via `CODEX_REALTIME_SERVER_LOG_PATH`. T10 overall stays open for thread-scoped terminal/tool logs and broader end-to-end runtime diagnostics beyond bootstrap and handshake.
- **files edited/created**: `/Users/espenmac/Code/CodexRealtime/packages/shared/package.json`, `/Users/espenmac/Code/CodexRealtime/packages/shared/src/structured-log.ts`, `/Users/espenmac/Code/CodexRealtime/packages/shared/src/structured-log.test.ts`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/main/index.ts`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/main/local-server-process.ts`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/main/local-server-process.test.ts`, `/Users/espenmac/Code/CodexRealtime/apps/server/src/index.ts`, `/Users/espenmac/Code/CodexRealtime/apps/server/src/server.ts`, `/Users/espenmac/Code/CodexRealtime/apps/server/package.json`, `/Users/espenmac/Code/CodexRealtime/apps/server/tsconfig.json`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/package.json`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/tsconfig.json`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/tsconfig.node.json`

### T10.1: Add End-To-End Diagnostics And Replay Tracing
- **depends_on**: [T6, T8, T10]
- **location**: `/Users/espenmac/Code/CodexRealtime/apps/server`, `/Users/espenmac/Code/CodexRealtime/apps/desktop`, `/Users/espenmac/Code/CodexRealtime/packages/contracts`
- **description**: Extend the early logging substrate into end-to-end diagnostics once projections and voice are live on the new stack. Cover provider runtime ingestion, replay/resume, projection outputs, transcript/audio ordering, and shell-native voice actions.
- **validation**: A single thread/session can be traced end-to-end across transport, provider runtime, orchestration, projection, and voice actions; duplicate replay or ordering bugs are visible in diagnostics.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T11: Cut Over Features Slice By Slice
- **depends_on**: [T7, T8, T9, T10.1]
- **location**: `/Users/espenmac/Code/CodexRealtime/apps/desktop`, `/Users/espenmac/Code/CodexRealtime/apps/server`, `/Users/espenmac/Code/CodexRealtime/packages`
- **description**: Move features onto the new stack in this order: read-only workspace/thread list and detail views first, then approvals and user-input actions, then terminal/task progress, then plans/diffs/artifacts, then voice session controls and interruption semantics. After each slice reaches parity, delete the old path rather than leaving fallback code behind.
- **validation**: Each migrated slice runs only on the new contracts/server/projection flow; obsolete IPC/timeline code is deleted as slices land; no permanent dual-path runtime remains; cutover order is documented and followed so regressions stay diagnosable.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T12: Validate End-To-End And Decide On Web Shell Follow-Up
- **depends_on**: [T11]
- **location**: `/Users/espenmac/Code/CodexRealtime/apps/server`, `/Users/espenmac/Code/CodexRealtime/apps/desktop`, `/Users/espenmac/Code/CodexRealtime/apps/web` if created
- **description**: Run the full gate on the new canonical stack and then decide whether to add `apps/web` as a second client. The web shell should only start after the server contracts, session directory, projections, and voice boundaries are stable enough that another client will not force architecture churn.
- **validation**: Lint, typecheck, tests, and voice smoke tests pass on the redesign path; team can name which desktop-native voice capabilities block or permit a web client; optional `apps/web` kickoff is documented as a separate follow-up if not started yet.
- **status**: Not Completed
- **log**:
- **files edited/created**:

## Parallel Execution Groups

| Wave | Tasks | Can Start When |
|------|-------|----------------|
| 1 | T0 | Immediately |
| 2 | T1 | T0 complete |
| 3 | T2 | T1 complete |
| 4 | T2.1, T3, T5 | T2 complete |
| 5 | T4, T10 | T3 complete |
| 6 | T6 | T3, T4, T5 complete |
| 7 | T6.1 | T3, T5, T6 complete |
| 8 | T7, T8 | T6.1 complete |
| 9 | T9, T10.1 | T8 complete and their other deps complete |
| 10 | T11 | T7, T8, T9, T10.1 complete |
| 11 | T12 | T11 complete |

## Testing Strategy
- Contract tests for runtime schemas, transport payloads, and voice control commands.
- Server integration tests for session resume, event replay, reconnect, approvals, and thread projections.
- Desktop integration tests for local server lifecycle, preload/native adapter calls, and permissions.
- Voice smoke tests for mic start/stop, interruption, transcript continuity, output audio playback, and renderer reload recovery.
- Device/error-path tests for mic denial, permission revocation, hot-swap, missing output device, sample-rate mismatch, and backpressure.
- Regression tests for timelines, diffs, approvals, and task/terminal progress after projection cutover.
- Treat T6.1 as a gating milestone before major UI and voice cutover.

## Risks & Mitigations
- Voice regressions during transport rewrite. Mitigation: keep audio and interruption events first-class in contracts from day one; add voice smoke tests before cutover.
- Too much logic remains in Electron main. Mitigation: treat any new domain logic in main/preload as a bug unless it is truly native-only.
- Event model overreach stalls shipping. Mitigation: start with thread/session/turn/approval/audio/task events only; add richer projections after the core loop is stable.
- Replay/resume bugs create phantom thread state. Mitigation: monotonic sequence numbers, persisted resume cursor, and structured logs per thread.
- Web ambition distracts from core voice desktop product. Mitigation: do not begin `apps/web` until T12 says the server contracts are stable enough.

## Recommended First Implementation Slice
1. T0
2. T1
3. T2
4. T2.1
5. T3
6. T5

That slice gives the biggest structural win fast: clean branch, hard contracts seam, real server process, desktop bootstrap/supervision, transport boundary, canonical runtime events. After that, session persistence, projections, and voice cutover become much safer to parallelize.
