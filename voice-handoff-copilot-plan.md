# Plan: Voice Handoff Copilot

**Generated**: 2026-03-13

## Overview
Ship a structured voice-to-Codex handoff path inside the current desktop app. The goal is to stop flattening realtime voice handoff events into plain chat text too early. Spoken repo-work requests should produce a normalized voice task envelope, flow through the native bridge as a first-class intent object, and start or steer live Codex work with preserved metadata.

Scope assumption for this plan:
- implement the feature in the current desktop/main architecture
- do not wait for the full server redesign
- preserve one canonical current-state path, not a long-lived fallback bridge

External research used for the plan:
- OpenAI Realtime guide: https://platform.openai.com/docs/guides/realtime
- OpenAI Voice agents guide: https://platform.openai.com/docs/guides/voice-agents
- OpenAI Speech-to-text guide: https://platform.openai.com/docs/guides/speech-to-text
- OpenAI Agents SDK handoffs: https://openai.github.io/openai-agents-python/handoffs/
- OpenAI GPT-5 Codex docs: https://platform.openai.com/docs/models/gpt-5-codex

## Prerequisites
- Keep current global Codex CLI path working: `codex app-server`
- No branch switch or push during implementation
- Preserve unrelated local changes already in the worktree

## Dependency Graph

```text
T1 ──┬── T2 ──┐
     │        ├── T4
     └── T3 ──┘
```

## Tasks

### T1: Add Canonical Voice Intent And Envelope Contracts
- **depends_on**: []
- **location**: `/Users/espenmac/Code/CodexRealtime/packages/contracts/src/index.ts`, `/Users/espenmac/Code/CodexRealtime/packages/contracts/src/server-api.ts`, `/Users/espenmac/Code/CodexRealtime/packages/contracts/src/ipc.ts`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/preload/index.ts`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/preload/global.d.ts`
- **description**: Add first-class types for structured voice dispatch. Define a canonical `VoiceIntent` model with variants for `conversation`, `work_request`, and `interrupt_request`, where start-vs-steer is intentionally deferred to main/workspace. Add a normalized `VoiceTaskEnvelope` carrying transcript text, distilled prompt, constraints, clarification policy, and handoff metadata like `handoffId`, source item ids, and raw payload fragments. Adapt to the current contract surface in-tree: if the old string path is already gone locally, do not restore it.
- **validation**: minimum gate: `pnpm --filter @codex-realtime/contracts typecheck`; integration gate after T2/T3 land: `pnpm --filter @codex-realtime/contracts build && pnpm --filter @codex-realtime/shared build && pnpm --filter @codex-realtime/desktop typecheck`. IPC/preload/global typing exposes the canonical method/channel used by the in-tree implementation.
- **status**: Completed
- **log**: Added the new voice-handoff contract types plus `dispatchVoiceIntent` at the contracts/preload seam. Kept the legacy `dispatchVoicePrompt` path available too so existing call sites and test mocks still compile while T2/T3 migrate onto the structured intent lane. `reason_not_testable`: contract-only slice; validated with typecheck/build gates instead of runtime RED tests.
- **files edited/created**: `/Users/espenmac/Code/CodexRealtime/packages/contracts/src/index.ts`, `/Users/espenmac/Code/CodexRealtime/packages/contracts/src/server-api.ts`, `/Users/espenmac/Code/CodexRealtime/packages/contracts/src/ipc.ts`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/preload/index.ts`, `/Users/espenmac/Code/CodexRealtime/voice-handoff-copilot-plan.md`

### T2: Parse Realtime Items Into Structured Voice Intents
- **depends_on**: [T1]
- **location**: `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/renderer/src/use-realtime-voice.ts`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/renderer/src/realtime-voice-intents.ts`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/renderer/src/use-realtime-voice.test.tsx`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/renderer/src/App.tsx`
- **description**: Refactor realtime voice parsing so `message` and `handoff_request` events can produce both transcript entries and structured `VoiceIntent` payloads. The renderer must only classify `conversation` vs `work_request`; it must not decide `start_turn` vs `steer_turn`. Preserve handoff metadata instead of collapsing it to a string. Add explicit dedupe/upgrade precedence for identifying one utterance across replayed items: `handoffId` first, then source item ids, then item id, then normalized text only as a last resort. Use that precedence to allow a later richer `handoff_request` to upgrade an earlier plain message without double-dispatching work, and to suppress a later plain message downgrade after a richer handoff already won.
- **validation**: RED->GREEN tests in `use-realtime-voice.test.tsx` prove that user speech items and `handoff_request` items dispatch structured intents, preserve ids/metadata, upgrade `message -> handoff_request` cleanly, suppress late `handoff_request -> message` downgrades, ignore redundant retransmits, and handle `handoff_request` items with missing transcript text safely. `App.tsx` compiles against the new callback/method surface.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T3: Route Voice Intents Through Main Process And Workspace Execution
- **depends_on**: [T1]
- **location**: `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/main/ipc.ts`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/main/realtime-service.ts`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/main/realtime-service.test.ts`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/main/workspace-service.ts`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/main/workspace-service.test.ts`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/main/voice-intent.ts`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/main/worker-settings.ts`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/main/codex-bridge.ts`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/main/codex-bridge.test.ts`
- **description**: Route structured voice intents through `dispatchVoiceIntent`. Convert them into explicit execution behavior in main/workspace: `interrupt_request` maps to active-turn interruption, `conversation` becomes no-op timeline state, and `work_request` resolves to start vs steer only after checking authoritative active-turn and thread state. Make thread-scoped active-turn safety explicit so work on one thread cannot accidentally steer another. Add a concrete envelope survival sink: preserve the normalized `VoiceTaskEnvelope` through the main/workspace path and reduce it into Codex worker input via a named helper/logging path rather than silently flattening it.
- **validation**: RED->GREEN tests cover no-op conversational intents, idle interrupt no-op, interrupt behavior with active work, new-turn start, active-turn steer, active turn on a different thread, stale/not-found steer fallback, and structured work-request envelope routing. `pnpm --filter @codex-realtime/desktop test -- workspace-service.test.ts codex-bridge.test.ts realtime-service.test.ts` passes.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T4: Integrate UI Feedback, Fixture Coverage, And Docs
- **depends_on**: [T2, T3]
- **location**: `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/renderer/src/App.tsx`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/src/main/codex-bridge-fixture.ts`, `/Users/espenmac/Code/CodexRealtime/apps/desktop/e2e/app-regression.test.ts`, `/Users/espenmac/Code/CodexRealtime/swe-voice-codex-product-spec.md`, `/Users/espenmac/Code/CodexRealtime/voice-handoff-copilot-plan.md`
- **description**: Update user-visible voice feedback so the app distinguishes conversational voice, steering, and explicit Codex handoff starts. First add a fixture/testability hook that can emit scripted realtime `itemAdded` notifications so end-to-end proof is not blocked at the end. Then extend regression coverage enough to prove `handoff_request`-driven delegation works end to end in the desktop app. If fixture-driven E2E remains too brittle, keep automated coverage at unit/integration level and document an exact manual/runtime check instead. Update the product spec with the implemented canonical envelope/intent path and then mark completed tasks in this plan with concise logs.
- **validation**: RED->GREEN regression coverage for the new voice handoff path where feasible, or documented runtime/manual validation with exact commands plus evidence. Product spec reflects the canonical envelope/intent behavior. Plan task entries updated after completion.
- **status**: Not Completed
- **log**:
- **files edited/created**:

## Parallel Execution Groups

| Wave | Tasks | Can Start When |
|------|-------|----------------|
| 1 | T1 | Immediately |
| 2 | T2, T3 | T1 complete |
| 3 | T4 | T2, T3 complete |

## Testing Strategy
- Add RED-first tests for renderer voice parsing and main/workspace routing.
- Reuse existing desktop Vitest suites before leaning on slow E2E.
- Run focused package tests during task work, then `pnpm lint`, `pnpm typecheck`, and `pnpm test` in the integration pass.
- Run `pnpm test:e2e` only if the new path is covered and existing timeouts do not block signal; otherwise report exact blocker lines.

## Risks & Mitigations
- Handoff item shape may vary by Codex/Realtime version.
  - Preserve unknown metadata, avoid overfitting to one payload shape, and test tolerant parsing.
- Cross-item replay can duplicate or downgrade intent quality.
  - Prefer richer `handoff_request` payloads over earlier plain transcript items using explicit upgrade rules keyed by handoff/source ids.
- Parallel workers could collide on shared files.
  - Keep canonical file ownership per task and reserve integration-only files for T4.
- String-based fallback could linger.
  - Replace the old API surface directly instead of keeping two long-lived dispatch paths.
- Conversational prompts could accidentally start work.
  - Keep explicit `conversation` no-op handling and main-process tests for gating behavior.
- Fixture limitations could block E2E proof.
  - Add test-time realtime event injection first; if that still falls short, treat unit/integration as the gating automation and record an exact manual proof path.
