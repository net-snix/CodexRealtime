# CodexRealtime

Voice-native Codex desktop prototype.

[![Status](https://img.shields.io/badge/status-prototype-e7a64a)](https://github.com/net-snix/CodexRealtime)
[![Platform](https://img.shields.io/badge/platform-macOS-f5f1e8)](https://github.com/net-snix/CodexRealtime)
[![Electron](https://img.shields.io/badge/electron-40.8.0-9db0b7)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/react-19.2.4-7fa7b5)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/typescript-5.9.3-6e92a3)](https://www.typescriptlang.org/)

Electron app. React renderer. Local Codex app-server bridge. Realtime voice loop. Workspace threads, approvals, settings, archives, worker controls.

## Status

Working local prototype.

Current surface:

- workspace + thread navigation
- live timeline + worker activity
- inline approvals + clarification
- voice bar + device selection
- settings page + archived chats
- worker model / reasoning / plan / approval controls
- Electron E2E regression coverage

## Screenshots

| Thread workspace | Settings |
| --- | --- |
| ![Thread workspace screenshot](docs/images/thread-view.png) | ![Settings screenshot](docs/images/settings-view.png) |

## Stack

- Electron
- React
- TypeScript
- electron-vite
- pnpm
- Vitest
- Playwright

## Run

```bash
pnpm install
pnpm --filter @codex-realtime/desktop dev
```

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
```

## Repo Notes

- app code: `/apps/desktop`
- shared contracts: `/packages/shared`
- product spec: `/swe-voice-codex-product-spec.md`
