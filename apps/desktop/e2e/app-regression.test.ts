import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import type { TimelineState, WorkspaceState } from "@shared";

type FixtureContext = {
  rootDir: string;
  userDataDir: string;
  fixturePath: string;
  askInLinePath: string;
  codexRealtimePath: string;
};

const now = Date.now();
const appRoot = process.cwd();

const writeJson = (path: string, value: unknown) => {
  writeFileSync(path, JSON.stringify(value, null, 2), "utf8");
};

const createFixtureContext = (): FixtureContext => {
  const rootDir = mkdtempSync(join(tmpdir(), "codex-realtime-e2e-"));
  const userDataDir = join(rootDir, "userData");
  const askInLinePath = join(rootDir, "AskInLine");
  const codexRealtimePath = join(rootDir, "CodexRealtime");
  const fixturePath = join(rootDir, "codex-fixture.json");
  const isoNow = new Date(now).toISOString();
  const unixNow = Math.floor(now / 1000);

  mkdirSync(userDataDir, { recursive: true });
  mkdirSync(askInLinePath, { recursive: true });
  mkdirSync(codexRealtimePath, { recursive: true });

  writeJson(join(userDataDir, "workspace-state.json"), {
    currentWorkspaceId: askInLinePath,
    workspaces: {
      [askInLinePath]: {
        id: askInLinePath,
        name: "AskInLine",
        path: askInLinePath,
        lastOpenedAt: isoNow,
        threadId: "thread-ask-1"
      },
      [codexRealtimePath]: {
        id: codexRealtimePath,
        name: "CodexRealtime",
        path: codexRealtimePath,
        lastOpenedAt: isoNow,
        threadId: "thread-codex-1"
      }
    }
  });

  writeJson(join(userDataDir, "app-settings.json"), {
    launchAtLogin: false,
    restoreLastWorkspace: true,
    reopenLastThread: true,
    autoNameNewThreads: false,
    autoStartVoice: false,
    showVoiceCaptions: true,
    density: "comfortable",
    reduceMotion: false,
    desktopNotifications: true,
    notifyOnApprovals: true,
    notifyOnTurnComplete: true,
    notifyOnErrors: true,
    developerMode: false
  });

  writeJson(join(userDataDir, "voice-preferences.json"), {
    selectedInputDeviceId: "",
    selectedOutputDeviceId: "",
    deviceHintDismissed: false,
    deviceSetupComplete: false
  });

  writeJson(fixturePath, {
    session: {
      account: {
        type: "chatgpt",
        planType: "pro"
      },
      features: {
        defaultModeRequestUserInput: true,
        realtimeConversation: true,
        voiceTranscription: true
      },
      requiresOpenaiAuth: false
    },
    config: {
      model: "gpt-5.4",
      model_reasoning_effort: "xhigh",
      approval_policy: "never",
      service_tier: "fast"
    },
    collaborationModes: [
      {
        name: "Code",
        mode: "default",
        model: "gpt-5.4",
        reasoning_effort: "xhigh"
      },
      {
        name: "Ask",
        mode: "plan",
        model: "gpt-5.4",
        reasoning_effort: "xhigh"
      }
    ],
    threads: [
      {
        id: "thread-ask-1",
        cwd: askInLinePath,
        archived: false,
        name: "archive smoke test",
        preview: "archive smoke test",
        updatedAt: unixNow,
        turns: [
          {
            id: "turn-ask-1",
            status: "completed",
            items: [
              {
                type: "userMessage",
                content: [{ type: "text", text: "Archive smoke test" }]
              },
              {
                type: "agentMessage",
                text: "Ready for archive regression."
              }
            ]
          }
        ]
      },
      {
        id: "thread-ask-2",
        cwd: askInLinePath,
        archived: false,
        name: "line one line two",
        preview: "line one line two",
        updatedAt: unixNow - 60 * 60 * 19,
        turns: []
      },
      {
        id: "thread-codex-1",
        cwd: codexRealtimePath,
        archived: false,
        name: "Create implementation plan from spec",
        preview: "Create implementation plan from spec",
        updatedAt: unixNow - 60 * 40,
        turns: []
      }
    ]
  });

  return {
    rootDir,
    userDataDir,
    fixturePath,
    askInLinePath,
    codexRealtimePath
  };
};

const readPersistedSettings = (userDataDir: string) =>
  JSON.parse(readFileSync(join(userDataDir, "app-settings.json"), "utf8")) as {
    density: string;
    reduceMotion: boolean;
  };

const getWorkspaceState = (page: Page): Promise<WorkspaceState> =>
  page.evaluate(
    async () =>
      (await (
        globalThis as unknown as {
          nativeApi: {
            getWorkspaceState: () => Promise<WorkspaceState>;
          };
        }
      ).nativeApi.getWorkspaceState()) as WorkspaceState
  );

const getTimelineState = (page: Page): Promise<TimelineState> =>
  page.evaluate(
    async () =>
      (await (
        globalThis as unknown as {
          nativeApi: {
            getTimelineState: () => Promise<TimelineState>;
          };
        }
      ).nativeApi.getTimelineState()) as TimelineState
  );

const launchFixtureApp = async (
  context: FixtureContext
): Promise<{ app: ElectronApplication; window: Page }> => {
  const app = await electron.launch({
    args: ["."],
    cwd: appRoot,
    env: {
      ...process.env,
      CODEX_REALTIME_USER_DATA_DIR: context.userDataDir,
      CODEX_REALTIME_E2E_FIXTURE_PATH: context.fixturePath,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true"
    }
  });
  const window = await app.firstWindow();

  await window.waitForLoadState("domcontentloaded");
  await window.getByRole("button", { name: "Open settings" }).waitFor({ timeout: 10_000 });
  return { app, window };
};

describe("desktop electron regressions", () => {
  const openApps: ElectronApplication[] = [];
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (openApps.length > 0) {
      const app = openApps.pop();

      if (app) {
        await app.close().catch(() => undefined);
      }
    }

    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  it("persists settings-page display preferences across relaunch", async () => {
    const context = createFixtureContext();
    tempDirs.push(context.rootDir);

    let launched = await launchFixtureApp(context);
    openApps.push(launched.app);

    await launched.window.getByRole("button", { name: "Open settings" }).click();
    await launched.window.locator(".settings-page").waitFor();

    expect(await launched.window.locator(".settings-page").isVisible()).toBe(true);
    expect(await launched.window.locator(".right-pane").isVisible()).toBe(false);

    await launched.window.getByRole("switch", { name: "Reduce motion" }).click();
    await launched.window.getByLabel("Density").selectOption("compact");
    await launched.window.waitForTimeout(300);

    expect(
      await launched.window.getByRole("switch", { name: "Reduce motion" }).getAttribute("aria-checked")
    ).toBe("true");
    expect(await launched.window.getByLabel("Density").inputValue()).toBe("compact");
    expect(readPersistedSettings(context.userDataDir)).toMatchObject({
      density: "compact",
      reduceMotion: true
    });

    await launched.app.close();
    openApps.pop();

    launched = await launchFixtureApp(context);
    openApps.push(launched.app);

    const shellClassName = (await launched.window.locator(".app-shell").getAttribute("class")) ?? "";
    expect(shellClassName).toContain("app-shell-density-compact");
    expect(shellClassName).toContain("app-shell-reduced-motion");

    await launched.window.getByRole("button", { name: "Open settings" }).click();
    await launched.window.locator(".settings-page").waitFor();
    expect(await launched.window.getByRole("switch", { name: "Reduce motion" }).getAttribute("aria-checked")).toBe("true");
    expect(await launched.window.getByLabel("Density").inputValue()).toBe("compact");
  });

  it("archives from the thread list and restores from settings", async () => {
    const context = createFixtureContext();
    tempDirs.push(context.rootDir);

    const { app, window } = await launchFixtureApp(context);
    openApps.push(app);

    const currentThread = window.locator('[data-thread-id="thread-ask-1"]');
    await currentThread.hover();
    await window.getByRole("button", { name: "Archive archive smoke test" }).click();
    await window.getByRole("button", { name: "Confirm archive archive smoke test" }).click();

    await window.locator('[data-thread-id="thread-ask-1"]').waitFor({ state: "detached" });

    await window.getByRole("button", { name: "Open settings" }).click();
    await window.locator(".settings-page").waitFor();

    const archivedSection = window.locator(".settings-card").filter({ hasText: "Archived chats" }).first();
    await archivedSection.getByRole("button", { name: "Restore" }).waitFor();
    expect(await archivedSection.innerText()).toContain("archive smoke test");

    await archivedSection.getByRole("button", { name: "Restore" }).click();

    await window.locator('[data-thread-id="thread-ask-1"]').waitFor();

    expect(await window.locator('[data-thread-id="thread-ask-1"]').count()).toBe(1);
  });

  it("collapses the voice bar and returns that space to the workspace frame", async () => {
    const context = createFixtureContext();
    tempDirs.push(context.rootDir);

    const { app, window } = await launchFixtureApp(context);
    openApps.push(app);

    const workspaceFrame = window.locator(".workspace-frame");
    const voiceBody = window.locator(".voice-bar-body");
    const beforeHeight = await workspaceFrame.evaluate((element) =>
      Math.round(element.getBoundingClientRect().height)
    );

    await window.getByRole("button", { name: "Hide voice bar" }).click();
    await window.waitForTimeout(250);

    const afterHeight = await workspaceFrame.evaluate((element) =>
      Math.round(element.getBoundingClientRect().height)
    );

    expect(afterHeight).toBeGreaterThan(beforeHeight);
    expect(
      await voiceBody.evaluate(
        (element) => element.ownerDocument.defaultView?.getComputedStyle(element).maxHeight ?? ""
      )
    ).toBe("0px");
    await window.getByRole("button", { name: "Show voice bar" }).waitFor();
  });

  it("removes a non-current project from the project menu", async () => {
    const context = createFixtureContext();
    tempDirs.push(context.rootDir);

    const { app, window } = await launchFixtureApp(context);
    openApps.push(app);

    await window.getByRole("button", { name: "More actions for CodexRealtime" }).click();
    await window.getByRole("button", { name: "Remove project" }).click();
    await window.waitForTimeout(150);

    expect(
      await window.locator(`button.project-select-button[title="${context.codexRealtimePath}"]`).count()
    ).toBe(0);
    expect(await window.getByText("AskInLine", { exact: true }).count()).toBeGreaterThan(0);
  });

  it("creates a new thread and sends from Enter in the composer", async () => {
    const context = createFixtureContext();
    tempDirs.push(context.rootDir);

    const { app, window } = await launchFixtureApp(context);
    openApps.push(app);

    const before = await getWorkspaceState(window);
    const beforeCurrentThreadId = before.currentThreadId;

    await window.locator(".rail-action-list").getByRole("button", { name: "New thread" }).click();
    await window.waitForTimeout(250);

    const afterCreate = await getWorkspaceState(window);
    expect(afterCreate.currentThreadId).not.toBe(beforeCurrentThreadId);
    expect(afterCreate.projects.find((project) => project.isCurrent)?.threads[0]?.title).toBe("New thread");

    const composer = window.locator(".timeline-input");
    await composer.fill("Ship the regression suite");
    await composer.press("Enter");

    await window.waitForTimeout(300);

    expect(await composer.inputValue()).toBe("");
    await window.locator(".timeline-thinking-chip").waitFor();
    expect(await window.locator(".timeline-thinking-chip").innerText()).toMatch(
      /Thinking|Working|Starting|Running/i
    );

    const timeline = await getTimelineState(window);
    expect(timeline.isRunning).toBe(true);
    expect(timeline.threadId).toBe(afterCreate.currentThreadId);

    const afterSend = await getWorkspaceState(window);
    const currentProject = afterSend.projects.find((project) => project.isCurrent);
    expect(currentProject?.threads[0]?.title).toBe("Ship the regression suite");
  });

  it("auto-names a fresh thread from Codex when enabled", async () => {
    const context = createFixtureContext();
    tempDirs.push(context.rootDir);

    const { app, window } = await launchFixtureApp(context);
    openApps.push(app);

    await window.getByRole("button", { name: "Open settings" }).click();
    await window.locator(".settings-page").waitFor();
    await window.getByRole("switch", { name: "Auto-name new chats" }).click();
    await window.getByRole("button", { name: "Back to thread" }).click();

    await window.locator(".rail-action-list").getByRole("button", { name: "New thread" }).click();
    await window.waitForTimeout(250);

    const composer = window.locator(".timeline-input");
    await composer.fill("Build concise automatic thread naming for new chats using Codex");
    await composer.press("Enter");
    await window.waitForTimeout(350);

    const afterSend = await getWorkspaceState(window);
    const currentProject = afterSend.projects.find((project) => project.isCurrent);
    expect(currentProject?.threads[0]?.title).toBe("Build concise automatic thread naming for new");
  });

  it("updates worker controls in the composer and resets them on a new thread", async () => {
    const context = createFixtureContext();
    tempDirs.push(context.rootDir);

    const { app, window } = await launchFixtureApp(context);
    openApps.push(app);

    const modelButton = window.getByRole("button", { name: "Worker model" });
    const reasoningButton = window.getByRole("button", { name: "Reasoning effort" });
    const planModeToggle = window.getByRole("switch", { name: "Plan mode" });
    const approvalButton = window.getByRole("button", { name: "Approval policy" });

    expect(await modelButton.textContent()).toContain("gpt-5.4");
    expect(await reasoningButton.textContent()).toContain("Extra high");
    expect(await planModeToggle.getAttribute("aria-checked")).toBe("false");
    expect(await modelButton.locator(".timeline-model-trigger-icon").count()).toBe(1);
    expect(await approvalButton.textContent()).toContain("Never");

    await modelButton.click();
    await window.getByRole("option", { name: "gpt-5.3-codex" }).click();
    await reasoningButton.click();
    await window.getByRole("option", { name: "Medium" }).click();
    await planModeToggle.click();
    await modelButton.click();
    await window.getByRole("switch", { name: "Fast mode" }).click();
    await approvalButton.click();
    await window.getByRole("option", { name: "On request" }).click();
    await window.waitForTimeout(250);

    expect(await modelButton.textContent()).toContain("gpt-5.3-codex");
    expect(await reasoningButton.textContent()).toContain("Medium");
    expect(await planModeToggle.getAttribute("aria-checked")).toBe("true");
    expect(await modelButton.locator(".timeline-model-trigger-icon").count()).toBe(0);
    expect(await approvalButton.textContent()).toContain("On request");

    await window.locator(".rail-action-list").getByRole("button", { name: "New thread" }).click();
    await window.waitForTimeout(350);

    expect(await modelButton.textContent()).toContain("gpt-5.4");
    expect(await reasoningButton.textContent()).toContain("Extra high");
    expect(await planModeToggle.getAttribute("aria-checked")).toBe("false");
    expect(await modelButton.locator(".timeline-model-trigger-icon").count()).toBe(1);
    expect(await approvalButton.textContent()).toContain("Never");
  });
});
