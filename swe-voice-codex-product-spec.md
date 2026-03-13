# Product Spec: Voice-Native SWE for Codex (macOS Electron)

**Status:** Draft v0.1  
**Date:** 2026-03-07  
**Platform:** macOS-first, Electron desktop app  
**Working names:** SWE Voice, Codex Voice, Pair SWE

## 1. Product summary

Build a macOS Electron app that feels like talking to a strong software engineer.

The user speaks naturally. The visible assistant keeps a normal spoken conversation, asks clarifying questions when needed, explains what it is doing, and decides when work needs to be delegated to Codex. When repo work is needed, the assistant creates a structured task envelope and sends it to `codex app-server`, which becomes the execution engine for reading files, planning, editing, running commands, reviewing diffs, and requesting approvals.

The user should experience **one assistant personality**. Internally, there are two layers:

- **Realtime SWE layer** = conversation, voice, orchestration, narration, clarification
- **Codex worker layer** = repo-aware execution, plans, diffs, approvals, commands, edits

## 2. Product vision

The app should feel like pair programming with a senior engineer who:

- listens continuously and naturally
- can answer conceptual questions directly
- can say “I’ll go inspect that” and then actually do the work in the repo
- checks back in with short spoken progress updates
- asks the user for input instead of guessing when requirements are unclear
- shows all concrete work visually: plan, commands, diffs, approvals, final result

## 3. Goals

### Primary goals

1. Make software work feel conversational rather than prompt-box driven.
2. Let users talk naturally instead of typing Codex prompts.
3. Preserve Codex as the authoritative repo worker and execution engine.
4. Show progress, plans, diffs, and approvals in a rich desktop UI.
5. Prefer asking the user over guessing whenever the task is ambiguous.
6. Keep the product local-first and safe by default.

### Secondary goals

1. Make it easy to resume work per repository/workspace.
2. Support both “just explain” and “go do the work” experiences in one interface.
3. Keep the path open for future MCP/tool integrations.

## 4. Non-goals (v1)

1. Multi-user collaboration.
2. Remote/cloud-hosted shared sessions.
3. Background autonomous jobs.
4. Full voice-only approvals for risky actions.
5. Letting the Realtime assistant modify the repo directly.
6. Supporting Windows or Linux at launch.

## 5. Core product principles

### 5.1 One visible assistant

The user talks to one assistant only. They should not need to understand or manage “Realtime vs Codex.”

### 5.2 Conversation first, delegation second

The assistant answers directly when it can. It delegates to Codex only when local codebase state, files, commands, or edits are required.

### 5.3 Codex is the execution authority

All repo work runs through `codex app-server`. Realtime should not act like a second coding agent with its own file-editing authority.

### 5.4 Ask instead of assume

This is a hard product rule:

- if the user request is ambiguous before work starts, the assistant asks a follow-up question
- if ambiguity appears while Codex is planning or mid-task, Codex should ask the user instead of silently assuming
- the default behavior for unclear work should be `default_mode_request_user_input`

### 5.5 Visual proof for real work

Anything that changes state or affects the repo must be represented visually in the app: plan, commands, approvals, diffs, errors, and final result.

### 5.6 Short spoken updates

The assistant should narrate milestones, not every token. Spoken output should be useful, calm, and interruptible.

## 6. Target users

### Primary user

A solo developer on macOS who already uses a local repo and wants a faster, more natural workflow than typing prompts into Codex.

### Secondary user

A technical lead or staff engineer who wants to think out loud, ask questions, and periodically hand concrete tasks to a coding agent.

## 7. Top user jobs to be done

1. “Explain what’s going on in this repo.”
2. “Figure out why this test is failing.”
3. “Make the smallest safe fix and show me the diff.”
4. “Refactor this module, but ask before touching public APIs.”
5. “What are you doing right now?”
6. “Stop, change direction, and focus on the auth tests first.”
7. “Can you compare two approaches before you edit anything?”

## 8. Core user experience

### 8.1 Default experience

The user opens a repo, presses talk or simply starts speaking, and talks to the assistant normally.

Examples:

- “Why is login flaky?”
- “Can you inspect the auth middleware and propose a fix?”
- “Before you touch anything, explain your plan.”
- “Actually, focus on tests first.”

### 8.2 What the assistant does

The assistant should:

1. understand whether the request is conversational or execution-oriented
2. answer directly when it can
3. ask concise follow-up questions when required
4. convert spoken intent into a structured Codex task envelope
5. launch Codex work
6. narrate progress in human language
7. surface approvals and wait for explicit user decisions
8. summarize outcomes and next steps

### 8.3 What “normal conversation with an SWE” means

The assistant should behave like a calm, senior pair programmer:

- conversational but not chatty
- proactive but not reckless
- able to reason aloud at a high level
- careful with commands, file edits, and dependencies
- always willing to stop and clarify

## 9. Scope

## 9.1 MVP scope

- Single-window Electron app for macOS
- Realtime voice conversation layer
- Codex app-server integration over local process transport
- One workspace open at a time per window
- One active Codex thread per workspace
- Rich timeline with transcript, commentary, plan, diff, approvals, final answer
- Voice interruption / “stop” behavior
- Explicit approval UI
- Resume prior thread for a workspace
- Strong ambiguity handling via request-for-input behavior

### 9.2 Post-MVP scope

- Multiple workspace windows
- Menu-bar quick capture helper
- MCP tool integrations
- Background tasks
- Review mode / PR mode
- Shared sessions or handoff

## 10. Information architecture / UI

## 10.1 Main window layout

### Left rail
- Workspaces / recent repos
- Threads for current workspace
- Current connection state

### Center pane
- Main conversation timeline
- User speech transcript
- Assistant spoken replies
- Codex commentary stream
- Final summaries

### Right pane
Tabbed utility area:
- Plan
- Diff
- Commands / tool activity
- Approvals
- Errors / logs (developer mode)

### Bottom voice bar
- Mic state
- Push-to-talk button (optional default)
- Listening / Thinking / Working state
- Interrupt / Stop
- Device controls
- Transcript preview when needed

## 10.2 Primary states

- Idle
- Listening
- Thinking
- Clarifying
- Starting work
- Working
- Needs approval
- Waiting for user input
- Done
- Error
- Disconnected / reconnecting

## 11. Product behavior model

## 11.1 Two-loop architecture

### Loop A: conversation loop
Always on.

Responsibilities:
- mic input
- speech output
- transcript
- barge-in / interruption
- assistant persona
- deciding whether to delegate
- summarizing Codex status back to the user

### Loop B: execution loop
Started only when repo work is needed.

Responsibilities:
- create/resume thread
- start/steer/interrupt turns
- stream plan/diff/messages
- handle approvals
- surface final output

## 11.2 Delegation decision

The assistant should **delegate to Codex** when the request depends on:

- current repo contents
- local file inspection
- code edits
- shell commands
- tests
- diffs
- git-aware operations
- MCP/app actions with side effects

The assistant should **stay conversational** when the request is:

- explanation
- brainstorming
- architecture discussion
- tradeoff analysis
- summarization of already-known information
- clarification of intent

## 11.3 Task envelope

The assistant should not send raw speech blindly to Codex. It should create a normalized task envelope.

### Envelope shape

```json
{
  "workspaceId": "wksp_123",
  "threadId": "optional existing thread id",
  "userGoal": "Fix the flaky auth test",
  "distilledPrompt": "Inspect the auth test failures, identify root cause, propose the smallest safe fix, run relevant tests, and summarize what changed.",
  "constraints": [
    "Ask before adding dependencies",
    "Prefer the smallest patch",
    "Explain simply"
  ],
  "acceptanceCriteria": [
    "Relevant auth tests pass",
    "Diff is reviewable",
    "Root cause is explained"
  ],
  "clarificationPolicy": "request_user_input",
  "replyStyle": "concise milestones + clear final summary"
}
```

### Envelope rules

- keep exact file names, commands, error strings, branch names, and identifiers
- rewrite filler language into clean intent
- preserve constraints and preferences from the conversation
- include clarification policy explicitly

### Implemented desktop path

The current desktop implementation should carry spoken repo-work through this canonical path:

1. Realtime item becomes a structured `VoiceIntent`
2. Renderer dispatches `dispatchVoiceIntent(...)`, not a raw prompt string
3. Main/workspace resolves `work_request` into start-vs-steer using authoritative active-turn state
4. A normalized `VoiceTaskEnvelope` is preserved through workspace execution and reduced into Codex worker input

Current intent kinds:
- `conversation`
- `interrupt_request`
- `work_request`

## 12. Ambiguity and clarification policy

This is the most important product rule after safety.

## 12.1 Requirement

When details are missing or uncertain, the product should prefer user input over assumptions.

## 12.2 Default behavior

Wherever behavior is unclear, use `default_mode_request_user_input` so Codex asks the user while working out the plan.

## 12.3 Practical interpretation

There are three layers of fallback:

### A. Before Codex starts
Realtime asks the user directly.

Example:
- “Do you want a minimal fix or a refactor?”
- “Should I touch only this package or the whole auth flow?”

### B. While Codex is planning or executing
Codex should ask through request-user-input behavior instead of guessing.

### C. If the runtime does not expose the exact feature flag/config path
The client falls back to explicit follow-up questions and/or handles app-server `tool/requestUserInput` flows in the UI.

## 12.4 Product requirement for implementation

At startup, the app should:

1. detect support for experimental features
2. detect whether request-user-input behavior is available
3. enable/support `default_mode_request_user_input` when available
4. always implement the `tool/requestUserInput` client path
5. never silently continue planning when a small clarifying question would materially reduce wrong work

## 13. Functional requirements

## 13.1 Conversation layer

The app must:

- support natural spoken input and spoken output
- let the user interrupt the assistant
- keep a visible text transcript
- show when the assistant is thinking vs when Codex is working
- support follow-up questions during an active task

## 13.2 Codex work lifecycle

The app must:

- initialize a Codex app-server client connection
- create or resume a thread per workspace
- start a turn for delegated work
- steer the active turn when the user changes direction without fully restarting
- interrupt a turn when the user says stop or changes task
- stream message deltas, plan updates, diff updates, and completion

## 13.3 Approval handling

The app must:

- surface approvals visually before destructive or side-effectful actions
- speak a short approval summary
- allow explicit user decisions
- not auto-approve risky operations in v1
- support “accept”, “decline”, and “cancel” behavior

## 13.4 Planning visibility

The app must:

- show the latest plan as structured steps
- update the plan when it changes
- keep prior completed steps visible
- distinguish between “planning” and “executing”

## 13.5 Diff visibility

The app must:

- show the current unified diff for the active turn
- update diff incrementally
- clearly indicate whether changes are staged, pending, or just proposed

## 13.6 Workspace persistence

The app must:

- persist workspace-to-thread mappings locally
- reopen the last thread when the same repo is opened again
- preserve conversation history in the UI

## 13.7 Error handling

The app must:

- recover cleanly from app-server disconnects
- recover from expired Realtime client secrets
- show actionable error states
- preserve work history after transient failures

## 14. Recommended defaults

## 14.1 Product defaults

- **Voice model:** `gpt-realtime-1.5`
- **Execution engine:** Codex via `codex app-server`
- **App-server transport:** stdio
- **Default sandbox posture:** workspace-write style access, not full-access by default
- **Default approvals posture:** prompt the user for impactful actions
- **Default ambiguity posture:** `default_mode_request_user_input`
- **Default narration style:** short milestone summaries
- **Default thread strategy:** one active thread per workspace

## 14.2 Voice UX defaults

- conversational mode should feel hands-free and natural
- if precision is critical, the app may briefly show a transcript preview before dispatching work
- the user should always be able to interrupt spoken output

## 15. Technical architecture

```text
Renderer (React)
  - WebRTC / audio / transcript / UI state
  - no direct access to Codex or secrets

Preload
  - narrow IPC API only

Main process
  - Realtime client-secret minting
  - CodexBridge (JSON-RPC over stdio)
  - secure credential storage
  - workspace/thread persistence
  - approval router

Child process
  - codex app-server
```

## 15.1 Renderer responsibilities

- microphone capture
- speaker playback
- waveform / voice state UI
- conversation timeline rendering
- diff / plan / approval views
- calling narrow preload APIs only

## 15.2 Main-process responsibilities

- spawn and supervise `codex app-server`
- JSON-RPC request/response handling
- session brokering for Realtime
- credential handling
- local persistence
- global shortcuts (optional)
- approval routing

## 15.3 Data storage

Local persistence should include:

- workspace records
- thread ids by workspace
- device preferences
- UI preferences
- last known connection state
- optional local conversation summaries for fast reopen

## 16. Realtime assistant design

## 16.1 Role

The Realtime assistant is the visible SWE persona.

It should:
- talk naturally
- think in terms of developer intent
- decide when to delegate
- ask for clarification when needed
- narrate Codex status in plain English
- never pretend to have completed repo work that only Codex can verify

## 16.2 Realtime system behavior

The assistant prompt should encode these rules:

1. Be a concise senior software engineer.
2. Answer directly when repo access is not needed.
3. Delegate repo-affecting work to Codex.
4. Convert user intent into a structured task envelope.
5. Preserve exact technical strings.
6. Ask for clarification when the request is under-specified.
7. Never approve commands or edits on the user’s behalf.
8. Give short spoken milestone updates.
9. Prefer asking the user over making assumptions.

## 16.3 Recommended tool surface exposed to Realtime

### Required tools

1. `codex_start_turn(envelope)`
2. `codex_steer_turn(threadId, turnId, deltaInstruction)`
3. `codex_interrupt_turn(threadId, turnId)`
4. `codex_get_status(threadId)`
5. `codex_respond_approval(requestId, decision)`
6. `codex_read_latest_diff(threadId, turnId)`

### Optional later tools

- `codex_switch_workspace(...)`
- `codex_list_threads(...)`
- `codex_fork_thread(...)`
- MCP / connector tools

## 17. Codex worker design

## 17.1 Role

Codex is the execution authority for anything involving the local repo.

## 17.2 Behavior requirements

Codex should:

- inspect code and environment
- create/update plans
- run commands under the current sandbox/approval policy
- produce diffs
- ask the user when requirements are unclear
- stop when interrupted
- summarize results clearly

## 17.3 Codex-side developer instructions

For delegated turns, the app should supply concise developer instructions such as:

- You are executing work on behalf of a voice-native SWE assistant.
- Ask the user rather than guessing when requirements are unclear.
- Prefer `request_user_input` during planning instead of silently assuming.
- Keep plans structured and concise.
- Narrate meaningful milestones through normal agent commentary.
- Do not approve risky actions automatically.
- Prefer the smallest safe change unless told otherwise.
- Preserve exact technical details from the user.

## 18. Event handling model

## 18.1 Events the UI must understand

- thread started / resumed
- turn started
- message deltas
- plan updates
- diff updates
- approval requests
- request-user-input prompts
- turn completed / interrupted / failed
- auth updated
- reconnect / disconnect

## 18.2 Spoken update policy

Speak only:
- planning start
- meaningful plan changes
- approval needs
- major findings
- completion summary
- hard errors

Do not read:
- every token delta
- raw shell logs
- full diffs by default

## 19. Thread and workspace model

## 19.1 Canonical mapping

- one workspace has one primary active thread
- a workspace may have multiple historical threads
- opening a workspace resumes the last active thread unless the user explicitly starts fresh

## 19.2 Steering rules

Use steer when:
- the user changes emphasis mid-task
- the task remains the same thread of work

Start a new turn when:
- the user changes to a new task
- the prior run is complete or no longer relevant

Interrupt when:
- the user says stop
- the user wants to fully redirect work immediately

## 20. Approvals UX

## 20.1 Approval panel content

Show:
- what action is being requested
- exact command or action name
- cwd / target
- reason
- possible side effects
- decision buttons

## 20.2 Voice behavior

The assistant may say:
- “I need approval to run npm install in the project root.”
- “I need approval to modify three files.”

But the visual approval UI remains the source of truth in v1.

## 21. Security and trust model

## 21.1 Trust boundaries

Renderer is untrusted for secrets and privileged operations.

Main process is trusted to:
- hold long-lived credentials
- mint short-lived Realtime client secrets
- spawn Codex
- write local settings
- process approvals

## 21.2 Security requirements

- never expose a standard API key directly to the renderer
- use a narrow preload bridge only
- keep privileged operations in main
- prefer local packaged content over remote web content
- keep the approval model explicit

## 22. Startup flow

1. Launch Electron app.
2. Main spawns `codex app-server`.
3. Main sends `initialize` / `initialized`.
4. App checks auth state.
5. App loads workspace and prior thread mapping.
6. App checks feature support.
7. App enables/supports ambiguity behavior, especially `default_mode_request_user_input` where available.
8. Renderer requests a fresh Realtime client secret.
9. Voice session connects.
10. User begins talking.

## 23. First-run setup flow

1. Choose or open a local repo.
2. Connect Codex/auth.
3. Connect voice session capability.
4. Grant microphone permission.
5. Show a short onboarding explaining:
   - you can ask questions normally
   - the assistant will sometimes “go work” in Codex
   - you will be asked before risky actions
   - unclear tasks will trigger clarification instead of guessing

## 24. Implementation notes for `default_mode_request_user_input`

This should be treated as a product requirement, not a best-effort nicety.

### What the implementation should do

- detect whether the Codex build/runtime supports request-user-input behavior in default mode
- enable that behavior where supported
- implement the app-server request/response path for user-input prompts
- keep a clean fallback path when only partial support is available

### What we should not do

- hardcode silent assumptions as the normal path
- force Codex to continue planning with missing requirements
- let the assistant hide ambiguity behind confident language

## 25. Open questions and default resolutions

### Q1. Should the app be fully hands-free or push-to-talk by default?
**Default resolution:** support both; keep conversation natural, but allow a transcript confirmation moment for execution-critical prompts.

### Q2. Should approvals be voice-only?
**Default resolution:** no. Voice can assist, but the visual approval surface is authoritative in v1.

### Q3. What happens if `default_mode_request_user_input` is not exposed in a given build?
**Default resolution:** fall back to app-server `tool/requestUserInput` and direct assistant clarification.

### Q4. Should the Realtime assistant ever edit files directly?
**Default resolution:** no. Codex remains the repo execution authority.

### Q5. Should we use collaboration mode presets?
**Default resolution:** optional. Use them only if they improve planning UX without reducing explicit control.

## 26. Acceptance criteria

The MVP is successful when all of the following are true:

1. A user can open a repo and talk naturally to one assistant.
2. The assistant can answer conceptual questions without starting Codex.
3. The assistant can delegate repo work to Codex through app-server.
4. Codex work appears as plan, diff, progress, approvals, and final answer in the UI.
5. The user can interrupt or redirect work.
6. Ambiguous tasks lead to clarification instead of silent assumptions.
7. The app supports request-user-input behavior during planning where available.
8. The user never needs to type raw Codex prompts to get value.
9. Secrets and privileged operations stay outside the renderer.
10. A workspace can be closed and reopened without losing its primary thread context.

## 27. Suggested build order

### Phase 1: skeleton
- Electron shell
- main/preload/renderer split
- Codex app-server spawn + initialize
- workspace open + thread resume

### Phase 2: voice layer
- Realtime session connection
- transcript + speech output
- basic conversational assistant

### Phase 3: delegation
- `codex_start_turn` tool
- task-envelope creation
- timeline integration

### Phase 4: live work UI
- plan updates
- diff updates
- approvals
- interrupt / steer

### Phase 5: ambiguity handling
- `request_user_input` UI path
- `default_mode_request_user_input` support where available
- fallback clarification flows

### Phase 6: polish
- settings
- device persistence
- better summaries
- thread history
- onboarding and recovery states

## 28. Final product statement

This product should feel like speaking with a capable software engineer who can both reason with you and actually do the work in your codebase.

The defining behavior is not just voice. It is **voice + delegation + visible execution + clarification instead of guessing**.

That last part is non-negotiable:

> When the work is unclear, use `default_mode_request_user_input` so Codex asks the user while planning, rather than silently making assumptions.
