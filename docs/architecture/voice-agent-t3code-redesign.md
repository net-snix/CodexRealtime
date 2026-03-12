# Voice-Agent T3code Redesign ADR

## Status
Accepted

## Date
2026-03-12

## Branch
`codex/t3code-voice-redesign`

## Decision
CodexRealtime will move from a single Electron-heavy app shape toward a `t3code`-style split:

- `apps/desktop`: native shell only
- `apps/server`: local source of truth for sessions, orchestration, projections, and provider runtime ingestion
- `packages/contracts`: hard runtime-validated boundary for shell/server transport, events, DTOs, and commands
- `packages/shared`: non-boundary runtime helpers only

Voice agent remains the product center. Native mic/audio capabilities stay in the desktop shell where required, but all voice activity must attach to the same canonical thread/session model as text turns.

## Rules
- One canonical path. No long-lived compatibility bridge between old Electron IPC flows and new server/event flows.
- `apps/server` is the single writer for durable thread/session state.
- Desktop main/preload may expose native-only capabilities, but not orchestration or timeline business logic.
- Renderer consumes a transport API, not direct Electron knowledge.
- Old code gets deleted after each migrated slice reaches parity.

## Persistence
- Canonical persistence root: Electron `userData`, under a server-owned subdirectory chosen during implementation.
- Storage must be versioned.
- Writes must be atomic.
- Startup must detect and handle corrupt state explicitly.
- Resume/replay semantics must be backed by persisted session identity and monotonic sequencing.

## Migration Order
1. Branch + contracts seam
2. Local server skeleton
3. Shell/server transport boundary
4. Canonical provider runtime events
5. Durable session directory
6. Event store + projections
7. Voice domain extraction
8. Renderer cutover by feature slice

## Why
- Current `main` + `App.tsx` are too coupled to scale safely.
- Voice reliability needs durable session identity, replay, and better observability.
- A server/client split unlocks cleaner renderer state and future multi-client options without making web the product center.

## Consequences
- Near-term churn across package boundaries, build scripts, and tests.
- Faster iteration later: clearer seams, better logging, safer replay/resume, thinner desktop shell.
- Any new domain logic added to Electron main/preload during the redesign should be treated as architecture debt and moved out quickly.
