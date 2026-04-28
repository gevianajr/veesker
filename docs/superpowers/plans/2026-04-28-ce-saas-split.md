# CE / SaaS Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the CE/SaaS split by removing DB tool access from CE AI and adding the provider abstraction infrastructure for Phase 4 Cloud wiring.

**Architecture:** Two phases — Phase 2 cuts AI tools from the sidecar (CE becomes text-only AI), Phase 3 adds frontend provider abstraction (`features.ts` + `AIService` + `BYOKProvider` + `CloudProvider` stub) and refactors `SheepChat` to use `AIService` instead of calling the sidecar directly.

**Tech Stack:** Bun + TypeScript (sidecar), SvelteKit 5 + Svelte runes (frontend), Vitest (frontend tests), Bun test (sidecar tests), `@anthropic-ai/sdk`

---

## File Map

### Phase 2 — AI Surgical Cut (sidecar only)

| File | Action | What changes |
|---|---|---|
| `sidecar/src/ai.ts` | Modify | `aiChat(params, tools: boolean = false)` + `buildSystem(ctx, tools)` strips schema/object context when `tools=false` |
| `sidecar/src/index.ts` | Modify | `"ai.chat"` handler passes `false` as second arg |
| `sidecar/src/ai.test.ts` | Create | Tests for tools gating and context stripping |

### Phase 3 — Provider Abstraction (frontend only)

| File | Action | What changes |
|---|---|---|
| `src/lib/services/features.ts` | Create | Capability flags; all Cloud flags `false` by default |
| `src/lib/services/features.test.ts` | Create | Verify CE defaults |
| `src/lib/ai/AIProvider.ts` | Create | TypeScript interface for AI providers |
| `src/lib/ai/providers/BYOKProvider.ts` | Create | Current CE behavior extracted from `SheepChat` |
| `src/lib/ai/providers/CloudProvider.ts` | Create | Stub that throws structured "Cloud coming soon" error |
| `src/lib/ai/AIService.ts` | Create | Selects provider; handles BYOK fallback on infra errors |
| `src/lib/ai/AIService.test.ts` | Create | Provider selection + fallback rules |
| `src/lib/workspace/SheepChat.svelte` | Modify | Replace direct `aiChat()` call with `AIService.chat()` |
| `src/lib/workspace/LoginModal.svelte` | Create | "Coming soon" stub modal |

---

## PHASE 2 — AI Surgical Cut

---

### Task 1: Add `tools` parameter to sidecar `aiChat` and strip CE context

**Files:**
- Modify: `sidecar/src/ai.ts`

- [ ] **Step 1: Update `buildSystem` to accept `tools` flag**

Replace the existing `buildSystem` function (lines 142–164) with:

```typescript
function buildSystem(ctx: AiContext, tools: boolean): string {
  const ctxLines: string[] = [];
  // Schema/object context only when tools are enabled (Cloud mode)
  if (tools) {
    if (ctx.currentSchema) ctxLines.push(`Current schema: ${ctx.currentSchema}`);
    if (ctx.selectedOwner && ctx.selectedName) {
      ctxLines.push(`Selected object: ${ctx.selectedKind ?? "OBJECT"} ${ctx.selectedOwner}.${ctx.selectedName}`);
    }
  }
  // Active SQL always included — user is asking about what's on screen
  if (ctx.activeSql?.trim()) {
    const safeSql = ctx.activeSql.slice(0, 800).replace(/`{3,}/g, "~~~");
    ctxLines.push(`Active SQL in editor:\n\`\`\`sql\n${safeSql}\n\`\`\``);
  }

  return `You are Veesker's Oracle database assistant — a knowledgeable, concise expert with the persona of a cyberpunk sheep mascot. You help developers understand Oracle schemas, debug queries, write PL/SQL, optimise performance, and give design insights.
${tools ? "\nYou have live access to the connected Oracle database via tools. Use them proactively — describe tables before suggesting queries, run a quick SELECT to verify assumptions, fetch DDL when discussing objects." : "\nYou work as a text-only assistant. You do not have access to the database. Explain and generate SQL based on what the user describes and the active SQL shown below."}

Rules:
- Always respond in English, regardless of the language used in the user's message
- Keep responses concise and actionable
- Use \`\`\`sql code blocks for all SQL
- Never suggest or execute DML/DDL via run_query — only SELECT/WITH
- Prefer using tools to verify before asserting
${ctxLines.length > 0 ? "\n[Current IDE context]\n" + ctxLines.join("\n") : ""}`;
}
```

- [ ] **Step 2: Update `aiChat` signature and pass `tools` flag through**

Replace the `aiChat` function signature and its internal usage of `TOOLS` and `buildSystem`. Find the function starting at line 219 and update:

```typescript
export async function aiChat(params: AiChatParams, tools: boolean = false): Promise<AiChatResult> {
  const key = params.apiKey || process.env.ANTHROPIC_API_KEY;
  const activeTools = tools ? TOOLS : [];

  if (!key) {
    if (await claudeCliAvailable()) return aiChatViaCli(params);
    throw {
      code: -32603,
      message:
        "Anthropic API key not configured and no local `claude` CLI found. " +
        "Add an ANTHROPIC_API_KEY in Settings or install the Claude CLI.",
    };
  }

  const client = new Anthropic({ apiKey: key });

  const messages: Anthropic.MessageParam[] = params.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const toolsUsed: string[] = [];
  const system = buildSystem(params.context, tools);

  let response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    system,
    tools: activeTools,
    messages,
  });

  while (response.stop_reason === "tool_use") {
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUseBlocks) {
      toolsUsed.push(tu.name);
      let result: string;
      try {
        result = await executeTool(tu.name, tu.input as Record<string, string>);
      } catch (e) {
        result = `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
      toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: result });
    }

    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user", content: toolResults });

    response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      system,
      tools: activeTools,
      messages,
    });
  }

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  return { content: text, toolsUsed };
}
```

- [ ] **Step 3: Export `buildSystem` and `getTools` for testability**

Add these two exports just before `buildSystem` and after the `TOOLS` constant:

```typescript
export function getTools(enabled: boolean): Anthropic.Tool[] {
  return enabled ? TOOLS : [];
}

export { buildSystem };
```

- [ ] **Step 4: Verify TypeScript compiles**

```
cd C:/Users/geefa/Documents/veesker
bun run check
```

Expected: 0 errors. If `buildSystem` is now exported alongside its existing usage, no import changes are needed yet.

---

### Task 2: Wire `tools: false` in sidecar handler and write tests

**Files:**
- Modify: `sidecar/src/index.ts`
- Create: `sidecar/src/ai.test.ts`

- [ ] **Step 1: Write failing tests**

Create `sidecar/src/ai.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { getTools, buildSystem } from "./ai";

describe("getTools", () => {
  test("returns empty array when tools disabled (CE mode)", () => {
    expect(getTools(false)).toEqual([]);
  });

  test("returns 4 tools when tools enabled (Cloud mode)", () => {
    const tools = getTools(true);
    expect(tools).toHaveLength(4);
    const names = tools.map((t) => t.name);
    expect(names).toContain("describe_object");
    expect(names).toContain("run_query");
    expect(names).toContain("get_ddl");
    expect(names).toContain("list_objects");
  });
});

describe("buildSystem", () => {
  const fullCtx = {
    currentSchema: "HR",
    selectedOwner: "HR",
    selectedName: "EMPLOYEES",
    selectedKind: "TABLE",
    activeSql: "SELECT * FROM EMPLOYEES",
  };

  test("CE mode: includes activeSql but NOT schema or object context", () => {
    const sys = buildSystem(fullCtx, false);
    expect(sys).toContain("SELECT * FROM EMPLOYEES");
    expect(sys).not.toContain("Current schema:");
    expect(sys).not.toContain("Selected object:");
  });

  test("Cloud mode: includes all context fields", () => {
    const sys = buildSystem(fullCtx, true);
    expect(sys).toContain("Current schema: HR");
    expect(sys).toContain("Selected object: TABLE HR.EMPLOYEES");
    expect(sys).toContain("SELECT * FROM EMPLOYEES");
  });

  test("CE mode: no activeSql → no context section injected", () => {
    const sys = buildSystem({ currentSchema: "HR" }, false);
    expect(sys).not.toContain("[Current IDE context]");
  });

  test("CE mode: system prompt mentions text-only assistant", () => {
    const sys = buildSystem({}, false);
    expect(sys).toContain("text-only assistant");
    expect(sys).not.toContain("live access to the connected Oracle database");
  });

  test("Cloud mode: system prompt mentions live database access", () => {
    const sys = buildSystem({}, true);
    expect(sys).toContain("live access to the connected Oracle database");
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```
cd C:/Users/geefa/Documents/veesker/sidecar
bun test src/ai.test.ts
```

Expected: FAIL — `buildSystem` and `getTools` not exported yet (or wrong behavior).

- [ ] **Step 3: Update `index.ts` handler to pass `tools: false`**

In `sidecar/src/index.ts`, find line 92:
```typescript
"ai.chat": (params) => aiChat(params as any),
```

Replace with:
```typescript
"ai.chat": (params) => aiChat(params as any, false),
```

- [ ] **Step 4: Run tests — expect pass**

```
cd C:/Users/geefa/Documents/veesker/sidecar
bun test src/ai.test.ts
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Run full sidecar test suite**

```
cd C:/Users/geefa/Documents/veesker/sidecar
bun test
```

Expected: all existing tests still pass (no regressions). The `sql-splitter.test.ts` import errors are pre-existing and non-blocking — ignore them.

- [ ] **Step 6: Verify TypeScript**

```
cd C:/Users/geefa/Documents/veesker
bun run check
```

Expected: 0 errors.

- [ ] **Step 7: Commit Phase 2**

```
cd C:/Users/geefa/Documents/veesker
git add sidecar/src/ai.ts sidecar/src/index.ts sidecar/src/ai.test.ts
git commit -m "feat(ce): AI Surgical Cut — CE mode passes tools=false, strips schema context"
```

---

## PHASE 3 — Provider Abstraction

---

### Task 3: Create `features.ts` capability flags

**Files:**
- Create: `src/lib/services/features.ts`
- Create: `src/lib/services/features.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/lib/services/features.test.ts`:

```typescript
import { describe, test, expect } from "vitest";
import { FEATURES } from "./features";

describe("FEATURES defaults (CE mode)", () => {
  test("all cloud AI flags are false", () => {
    expect(FEATURES.cloudAI).toBe(false);
    expect(FEATURES.aiCharts).toBe(false);
    expect(FEATURES.aiDebugger).toBe(false);
    expect(FEATURES.managedEmbeddings).toBe(false);
    expect(FEATURES.teamFeatures).toBe(false);
    expect(FEATURES.cloudAudit).toBe(false);
  });

  test("VRAS AI Suggest is true (CE BYOK)", () => {
    expect(FEATURES.aiVrasGenerate).toBe(true);
  });

  test("user is not logged in by default", () => {
    expect(FEATURES.isLoggedIn).toBe(false);
    expect(FEATURES.userTier).toBe("ce");
  });
});
```

- [ ] **Step 2: Run test — expect fail**

```
cd C:/Users/geefa/Documents/veesker
bun run test -- src/lib/services/features.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/lib/services/features.ts`**

```typescript
// Copyright 2022-2026 Geraldo Ferreira Viana Júnior
// Licensed under the Apache License, Version 2.0
// https://github.com/Veesker-Cloud/veesker

export type UserTier = "ce" | "cloud";

export const FEATURES = {
  cloudAI: false,            // Sheep with DB tools + schema-aware context
  aiCharts: false,           // Charts generated via natural language (Phase 4)
  aiDebugger: false,         // Debugger runtime analysis (Phase 4)
  aiVrasGenerate: true,      // VRAS AI Suggest — CE BYOK, always on
  managedEmbeddings: false,  // Vector embeddings without Ollama/key (Phase 4)
  teamFeatures: false,       // Shared queries, RBAC (Phase 4)
  cloudAudit: false,         // Long-term audit sync (Phase 4)
  isLoggedIn: false,
  userTier: "ce" as UserTier,
};

export function applyFeatureFlags(flags: Partial<typeof FEATURES>): void {
  Object.assign(FEATURES, flags);
}

export function resetFeatures(): void {
  FEATURES.cloudAI = false;
  FEATURES.aiCharts = false;
  FEATURES.aiDebugger = false;
  FEATURES.managedEmbeddings = false;
  FEATURES.teamFeatures = false;
  FEATURES.cloudAudit = false;
  FEATURES.isLoggedIn = false;
  FEATURES.userTier = "ce";
  // aiVrasGenerate stays true — it's CE
}
```

- [ ] **Step 4: Run test — expect pass**

```
bun run test -- src/lib/services/features.test.ts
```

Expected: 3 tests PASS.

---

### Task 4: Create `AIProvider` interface and `BYOKProvider`

**Files:**
- Create: `src/lib/ai/AIProvider.ts`
- Create: `src/lib/ai/providers/BYOKProvider.ts`
- Create: `src/lib/ai/providers/BYOKProvider.test.ts`

- [ ] **Step 1: Create `src/lib/ai/AIProvider.ts`**

```typescript
// Copyright 2022-2026 Geraldo Ferreira Viana Júnior
// Licensed under the Apache License, Version 2.0
// https://github.com/Veesker-Cloud/veesker

import type { AiContext, AiMessage, AiChatResult } from "$lib/workspace";

export type ChatParams = {
  apiKey: string;
  messages: AiMessage[];
  context: AiContext;
};

export type ChatResult = AiChatResult;

export interface AIProvider {
  chat(params: ChatParams): Promise<{ ok: true; data: ChatResult } | { ok: false; error: unknown }>;
}
```

- [ ] **Step 2: Write failing test for BYOKProvider**

Create `src/lib/ai/providers/BYOKProvider.test.ts`:

```typescript
import { describe, test, expect, vi } from "vitest";
import { BYOKProvider } from "./BYOKProvider";

vi.mock("$lib/workspace", () => ({
  aiChat: vi.fn(),
}));

import { aiChat } from "$lib/workspace";

describe("BYOKProvider", () => {
  const provider = new BYOKProvider();

  test("delegates to aiChat with correct params", async () => {
    vi.mocked(aiChat).mockResolvedValue({ ok: true, data: { content: "hello", toolsUsed: [] } });

    const result = await provider.chat({
      apiKey: "sk-test",
      messages: [{ role: "user", content: "explain this" }],
      context: { activeSql: "SELECT 1 FROM DUAL" },
    });

    expect(aiChat).toHaveBeenCalledWith(
      "sk-test",
      [{ role: "user", content: "explain this" }],
      { activeSql: "SELECT 1 FROM DUAL" },
    );
    expect(result).toEqual({ ok: true, data: { content: "hello", toolsUsed: [] } });
  });

  test("returns error result when aiChat fails", async () => {
    vi.mocked(aiChat).mockResolvedValue({ ok: false, error: { message: "no key" } });

    const result = await provider.chat({
      apiKey: "",
      messages: [{ role: "user", content: "hi" }],
      context: {},
    });

    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 3: Run test — expect fail**

```
bun run test -- src/lib/ai/providers/BYOKProvider.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Create `src/lib/ai/providers/BYOKProvider.ts`**

```typescript
// Copyright 2022-2026 Geraldo Ferreira Viana Júnior
// Licensed under the Apache License, Version 2.0
// https://github.com/Veesker-Cloud/veesker

import { aiChat } from "$lib/workspace";
import type { AIProvider, ChatParams, ChatResult } from "../AIProvider";

export class BYOKProvider implements AIProvider {
  async chat(params: ChatParams): Promise<{ ok: true; data: ChatResult } | { ok: false; error: unknown }> {
    return aiChat(params.apiKey, params.messages, params.context);
  }
}
```

- [ ] **Step 5: Run test — expect pass**

```
bun run test -- src/lib/ai/providers/BYOKProvider.test.ts
```

Expected: 2 tests PASS.

---

### Task 5: Create `CloudProvider` stub

**Files:**
- Create: `src/lib/ai/providers/CloudProvider.ts`

- [ ] **Step 1: Create `src/lib/ai/providers/CloudProvider.ts`**

No test needed — stub behavior is verified through AIService tests.

```typescript
// Copyright 2022-2026 Geraldo Ferreira Viana Júnior
// Licensed under the Apache License, Version 2.0
// https://github.com/Veesker-Cloud/veesker

import type { AIProvider, ChatParams, ChatResult } from "../AIProvider";

export class CloudProvider implements AIProvider {
  async chat(_params: ChatParams): Promise<{ ok: true; data: ChatResult } | { ok: false; error: unknown }> {
    return {
      ok: false,
      error: {
        code: "CLOUD_NOT_IMPLEMENTED",
        message: "Veesker Cloud is coming soon. Sign up at veesker.cloud to get notified.",
      },
    };
  }
}
```

---

### Task 6: Create `AIService` with provider selection and fallback

**Files:**
- Create: `src/lib/ai/AIService.ts`
- Create: `src/lib/ai/AIService.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/ai/AIService.test.ts`:

```typescript
import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("$lib/services/features", () => ({
  FEATURES: { cloudAI: false },
}));

vi.mock("../ai/providers/BYOKProvider", () => ({
  BYOKProvider: vi.fn().mockImplementation(() => ({
    chat: vi.fn().mockResolvedValue({ ok: true, data: { content: "byok response", toolsUsed: [] } }),
  })),
}));

vi.mock("../ai/providers/CloudProvider", () => ({
  CloudProvider: vi.fn().mockImplementation(() => ({
    chat: vi.fn().mockResolvedValue({ ok: false, error: { code: "CLOUD_NOT_IMPLEMENTED", message: "coming soon" } }),
  })),
}));

import { FEATURES } from "$lib/services/features";
import { AIService } from "./AIService";

const baseParams = {
  apiKey: "sk-test",
  messages: [{ role: "user" as const, content: "hello" }],
  context: { activeSql: "SELECT 1 FROM DUAL" },
};

describe("AIService", () => {
  beforeEach(() => {
    (FEATURES as any).cloudAI = false;
  });

  test("uses BYOKProvider when cloudAI=false", async () => {
    const result = await AIService.chat(baseParams);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.content).toBe("byok response");
  });

  test("uses CloudProvider when cloudAI=true", async () => {
    (FEATURES as any).cloudAI = true;
    const result = await AIService.chat(baseParams);
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as any).code).toBe("CLOUD_NOT_IMPLEMENTED");
  });

  test("falls back to BYOK on CLOUD_UNAVAILABLE when apiKey present", async () => {
    (FEATURES as any).cloudAI = true;
    const { CloudProvider } = await import("./providers/CloudProvider");
    vi.mocked(CloudProvider).mockImplementation(() => ({
      chat: vi.fn().mockResolvedValue({ ok: false, error: { code: "CLOUD_UNAVAILABLE", message: "down" } }),
    }));

    const result = await AIService.chat(baseParams);
    // Should fall back to BYOK
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.content).toBe("byok response");
  });

  test("does NOT fall back on 401 Unauthorized", async () => {
    (FEATURES as any).cloudAI = true;
    const { CloudProvider } = await import("./providers/CloudProvider");
    vi.mocked(CloudProvider).mockImplementation(() => ({
      chat: vi.fn().mockResolvedValue({ ok: false, error: { code: "UNAUTHORIZED", message: "expired" } }),
    }));

    const result = await AIService.chat(baseParams);
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as any).code).toBe("UNAUTHORIZED");
  });

  test("does NOT fall back on 402 Payment Required", async () => {
    (FEATURES as any).cloudAI = true;
    const { CloudProvider } = await import("./providers/CloudProvider");
    vi.mocked(CloudProvider).mockImplementation(() => ({
      chat: vi.fn().mockResolvedValue({ ok: false, error: { code: "PAYMENT_REQUIRED", message: "no credits" } }),
    }));

    const result = await AIService.chat(baseParams);
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — expect fail**

```
bun run test -- src/lib/ai/AIService.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/lib/ai/AIService.ts`**

```typescript
// Copyright 2022-2026 Geraldo Ferreira Viana Júnior
// Licensed under the Apache License, Version 2.0
// https://github.com/Veesker-Cloud/veesker

import { FEATURES } from "$lib/services/features";
import { BYOKProvider } from "./providers/BYOKProvider";
import { CloudProvider } from "./providers/CloudProvider";
import type { ChatParams, ChatResult } from "./AIProvider";

const FALLBACK_CODES = new Set(["CLOUD_UNAVAILABLE", "NETWORK_ERROR", "SERVICE_UNAVAILABLE"]);
const NO_FALLBACK_CODES = new Set(["UNAUTHORIZED", "PAYMENT_REQUIRED", "CLOUD_NOT_IMPLEMENTED"]);

export const AIService = {
  async chat(params: ChatParams): Promise<{ ok: true; data: ChatResult } | { ok: false; error: unknown }> {
    if (!FEATURES.cloudAI) {
      return new BYOKProvider().chat(params);
    }

    const cloudResult = await new CloudProvider().chat(params);

    if (!cloudResult.ok) {
      const code = (cloudResult.error as any)?.code as string | undefined;
      if (code && FALLBACK_CODES.has(code) && params.apiKey) {
        return new BYOKProvider().chat(params);
      }
    }

    return cloudResult;
  },
};
```

- [ ] **Step 4: Run tests — expect pass**

```
bun run test -- src/lib/ai/AIService.test.ts
```

Expected: 5 tests PASS.

- [ ] **Step 5: Run full frontend test suite**

```
cd C:/Users/geefa/Documents/veesker
bun run test
```

Expected: all tests pass (including features.test.ts and BYOKProvider.test.ts).

---

### Task 7: Refactor `SheepChat.svelte` to use `AIService`

**Files:**
- Modify: `src/lib/workspace/SheepChat.svelte`

- [ ] **Step 1: Update the import block**

In `SheepChat.svelte`, find line 8:
```typescript
import { aiChat, aiKeySave, aiKeyGet, type AiMessage, type AiContext, chartConfigureRpc, chartResetRpc, type ChartConfig, type PreviewData } from "$lib/workspace";
```

Replace with:
```typescript
import { aiKeySave, aiKeyGet, type AiMessage, type AiContext, chartConfigureRpc, chartResetRpc, type ChartConfig, type PreviewData } from "$lib/workspace";
import { AIService } from "$lib/ai/AIService";
```

- [ ] **Step 2: Replace `aiChat` call in `send()`**

Find line ~324 inside `async function send()`:
```typescript
const res = await aiChat(apiKey, messages.map(({ role, content }) => ({ role, content })), context);
```

Replace with:
```typescript
const res = await AIService.chat({
  apiKey,
  messages: messages.map(({ role, content }) => ({ role, content })),
  context,
});
```

- [ ] **Step 3: Handle fallback banner in `send()`**

The existing error display uses:
```typescript
if (res.ok) {
  messages = [...messages, { role: "assistant" as const, content: res.data.content }];
} else {
  error = (res.error as any)?.message ?? "Unknown error";
}
```

Replace with:
```typescript
if (res.ok) {
  const fell = (res.data as any).__byokFallback;
  if (fell) {
    error = "Cloud AI unavailable — responded via BYOK.";
  }
  messages = [...messages, { role: "assistant" as const, content: res.data.content }];
} else {
  const code = (res.error as any)?.code;
  if (code === "CLOUD_NOT_IMPLEMENTED") {
    error = "Veesker Cloud is coming soon. Using BYOK in the meantime.";
  } else {
    error = (res.error as any)?.message ?? "Unknown error";
  }
}
```

Note: The `__byokFallback` field is not yet set by `AIService` — this is a UX placeholder for Phase 4. For now, the `CLOUD_NOT_IMPLEMENTED` branch displays a friendly message instead of an error.

- [ ] **Step 4: Verify TypeScript**

```
bun run check
```

Expected: 0 errors. If `aiChat` is still imported elsewhere in the codebase, those usages are unaffected — only `SheepChat` is changed.

- [ ] **Step 5: Run full test suite**

```
bun run test
```

Expected: all tests pass.

---

### Task 8: Add `LoginModal` stub and commit Phase 3

**Files:**
- Create: `src/lib/workspace/LoginModal.svelte`

- [ ] **Step 1: Create `src/lib/workspace/LoginModal.svelte`**

```svelte
<!--
  Copyright 2022-2026 Geraldo Ferreira Viana Júnior
  Licensed under the Apache License, Version 2.0
  https://github.com/Veesker-Cloud/veesker
-->

<script lang="ts">
  type Props = {
    onClose: () => void;
  };
  let { onClose }: Props = $props();

  function openPricing() {
    window.open("https://veesker.cloud/pricing", "_blank", "noopener,noreferrer");
  }
</script>

<div class="modal-backdrop" role="presentation" onclick={onClose}>
  <div class="modal" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()}>
    <button class="close-btn" aria-label="Close" onclick={onClose}>✕</button>
    <div class="cloud-icon">☁</div>
    <h2>Veesker Cloud</h2>
    <p class="lead">Schema-aware AI that knows your database — no API key required.</p>
    <ul class="feature-list">
      <li>AI with live DB access (run_query, describe_object, get_ddl)</li>
      <li>Query optimization + performance analysis</li>
      <li>Charts via natural language</li>
      <li>Managed embeddings for vector search</li>
    </ul>
    <p class="coming-soon">Coming soon — sign up to get notified at launch.</p>
    <div class="actions">
      <button class="btn primary" onclick={openPricing}>See plans →</button>
      <button class="btn" onclick={onClose}>Continue with CE</button>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.6);
    display: flex; align-items: center; justify-content: center;
    z-index: 1000;
  }
  .modal {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 32px;
    max-width: 420px;
    width: 90%;
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .close-btn {
    position: absolute; top: 14px; right: 14px;
    background: none; border: none;
    color: var(--text-muted); cursor: pointer; font-size: 16px;
  }
  .cloud-icon { font-size: 36px; text-align: center; }
  h2 { margin: 0; font-size: 22px; text-align: center; }
  .lead { margin: 0; color: var(--text-muted); font-size: 14px; text-align: center; }
  .feature-list {
    padding-left: 18px; margin: 0;
    color: var(--text-muted); font-size: 13px; line-height: 1.8;
  }
  .coming-soon {
    margin: 0; font-size: 12px;
    color: var(--text-muted); text-align: center;
    font-style: italic;
  }
  .actions { display: flex; gap: 10px; }
  .btn {
    flex: 1; padding: 10px 0; border-radius: 8px;
    font-size: 14px; font-weight: 600; cursor: pointer;
    border: 1px solid var(--border); background: var(--bg-surface-alt);
    color: var(--text-primary);
  }
  .btn.primary {
    background: var(--accent-text); color: #fff; border-color: var(--accent-text);
  }
</style>
```

- [ ] **Step 2: Run full test suite**

```
cd C:/Users/geefa/Documents/veesker
bun run test
```

Expected: all tests pass.

- [ ] **Step 3: Run linter**

```
bun run lint
```

Fix any Biome warnings before committing.

- [ ] **Step 4: TypeScript check**

```
bun run check
```

Expected: 0 errors.

- [ ] **Step 5: Manual verification checklist**

- [ ] CE with BYOK key configured → Sheep responds with text-only (no schema context)
- [ ] Ask Sheep "list my tables" → AI says it has no database access
- [ ] CE without BYOK key → error with Cloud CTA message
- [ ] VRAS "AI Suggest" button → still works (unchanged)
- [ ] Chart "Analyze" wizard → still works (unchanged — no AI inference in this flow)
- [ ] `bun run check` → 0 TypeScript errors

- [ ] **Step 6: Commit Phase 3**

```
cd C:/Users/geefa/Documents/veesker
git add \
  src/lib/services/features.ts \
  src/lib/services/features.test.ts \
  src/lib/ai/AIProvider.ts \
  src/lib/ai/providers/BYOKProvider.ts \
  src/lib/ai/providers/BYOKProvider.test.ts \
  src/lib/ai/providers/CloudProvider.ts \
  src/lib/ai/AIService.ts \
  src/lib/ai/AIService.test.ts \
  src/lib/workspace/SheepChat.svelte \
  src/lib/workspace/LoginModal.svelte
git commit -m "feat(ce): Provider Abstraction — AIService, BYOKProvider, CloudProvider stub, features flags"
```

---

## Out of Scope (Phase 4)

- Real auth flow (JWT login, keyring storage)
- `CloudProvider.ts` real implementation (calls `api.veesker.cloud`)
- `app.veesker.cloud` management portal
- Charts AI (natural language → AI generates chart config)
- Debugger AI (runtime analysis)
- Managed embeddings (vector without Ollama/key)
- Team features, billing, cloud audit sync
