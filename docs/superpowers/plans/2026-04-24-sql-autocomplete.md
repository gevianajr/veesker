# SQL Autocomplete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add automatic SQL autocomplete for table and view names from the active connection's current schema inside the CodeMirror editor.

**Architecture:** A CodeMirror `Compartment` wraps the `sql({ dialect: PLSQL })` language extension inside `SqlEditor.svelte`, allowing it to be reconfigured at runtime with real schema data. The workspace page fetches table and view names for the current schema during bootstrap via the existing `objectsList` RPC, builds a `Record<string, string[]>` map, and passes it as a prop down through `SqlDrawer` to `SqlEditor`. A `$effect` in `SqlEditor` reconfigures the Compartment whenever the prop changes.

**Tech Stack:** SvelteKit 5 (Svelte 5 runes), CodeMirror 6 (`@codemirror/state` Compartment, `@codemirror/lang-sql` SQLConfig `schema` option), existing `objectsList` Tauri invoke wrapper in `src/lib/workspace.ts`.

---

## File Map

| File | Change |
|---|---|
| `src/lib/workspace/SqlEditor.svelte` | Add `completionSchema` prop, `Compartment`, `$effect` to reconfigure |
| `src/lib/workspace/SqlEditor.test.ts` | Add test: mounts without crash when `completionSchema` prop is provided |
| `src/lib/workspace/SqlDrawer.svelte` | Add `completionSchema` prop, pass through to `<SqlEditor>` |
| `src/routes/workspace/[id]/+page.svelte` | Add `completionSchema` state, fetch in `bootstrap()`, pass to `<SqlDrawer>` |

---

## Background for the implementer

**Project structure:** Veesker is a Tauri 2 desktop app. The frontend is SvelteKit 5 with Svelte runes (`$state`, `$derived`, `$effect`) — no Svelte stores. The SQL editor is CodeMirror 6 wrapped in `SqlEditor.svelte`. The `SqlEditor` lives inside `SqlDrawer`, which lives inside the workspace page at `src/routes/workspace/[id]/+page.svelte`.

**Existing shortcuts in SqlEditor:** `Prec.highest(keymap.of([...]))` block is already there — do not remove or reorder it. The `basicSetup` extension already includes `autocompletion()`, so the popup infrastructure is already present.

**`objectsList` RPC:** Already available in `src/lib/workspace.ts`:
```typescript
export const objectsList = (owner: string, kind: ObjectKind) =>
  call<ObjectRef[]>("objects_list", { owner, kind });
// ObjectRef = { owner: string; name: string }
```

**Current schema detection:** In `+page.svelte`, `bootstrap()` already calls `schemaList()` and does:
```typescript
const current = schemas.find((s) => s.isCurrent);
```
Use `current.name` as the schema identifier for the fetch.

**CodeMirror Compartment:** A `Compartment` lets you swap out one extension for another at runtime via `view.dispatch({ effects: compartment.reconfigure(newExtension) })`. Each `SqlEditor` instance needs its own `Compartment` instance — declare it in the `<script>` block (not at module level), so each component instance gets its own.

---

## Task 1: Add `Compartment` and `completionSchema` prop to `SqlEditor.svelte`

**Files:**
- Modify: `src/lib/workspace/SqlEditor.svelte`
- Test: `src/lib/workspace/SqlEditor.test.ts`

- [ ] **Step 1.1: Write failing test**

Open `src/lib/workspace/SqlEditor.test.ts` and add this test inside the existing `describe("SqlEditor", ...)` block, after the last test:

```typescript
it("accepts completionSchema prop without crashing", async () => {
  const schema: Record<string, string[]> = { EMPLOYEES: [], DEPARTMENTS: [] };
  const { container } = render(SqlEditor, {
    props: {
      value: "SELECT 1 FROM DUAL",
      onChange: noop,
      onRunCursor: noop,
      onRunAll: noop,
      onSave: noop,
      onSaveAs: noop,
      onExplain: explainNoop,
      completionSchema: schema,
    },
  });
  await new Promise((r) => setTimeout(r, 0));
  expect(container.querySelector(".cm-editor")).not.toBeNull();
});
```

- [ ] **Step 1.2: Run test to confirm it fails**

```
bun run test src/lib/workspace/SqlEditor.test.ts
```

Expected: FAIL — TypeScript error because `completionSchema` prop does not exist yet.

- [ ] **Step 1.3: Add `Compartment` and `completionSchema` prop to `SqlEditor.svelte`**

In `src/lib/workspace/SqlEditor.svelte`, make these changes:

**1. Add `Compartment` to the import from `@codemirror/state`** (line 3, currently `import { EditorState, Prec } from "@codemirror/state"`):

```typescript
import { EditorState, Compartment, Prec } from "@codemirror/state";
```

**2. Add `completionSchema` to the `Props` type** (after `compileErrors`):

```typescript
type Props = {
  value: string;
  onChange: (sql: string) => void;
  onRunCursor: (selection: string | null, cursorPos: number, docText: string) => void;
  onRunAll: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onExplain: (sql: string) => void;
  compileErrors?: CompileError[] | null;
  completionSchema?: Record<string, string[]>;
};
let { value, onChange, onRunCursor, onRunAll, onSave, onSaveAs, onExplain, compileErrors = null, completionSchema }: Props = $props();
```

**3. Declare the Compartment instance** (add after the `let view: EditorView | null = null;` line):

```typescript
const sqlLangCompartment = new Compartment();
```

**4. In `onMount`, inside `EditorState.create({ extensions: [...] })`, replace the static `sql({ dialect: PLSQL })` line with the Compartment-wrapped version:**

Find this line (currently around line 100):
```typescript
sql({ dialect: PLSQL }),
```

Replace with:
```typescript
sqlLangCompartment.of(sql({ dialect: PLSQL })),
```

**5. Add a `$effect` to reconfigure when `completionSchema` changes** — add after the existing `$effect` that syncs `compileErrors` (at the end of the script block, before `</script>`):

```typescript
$effect(() => {
  if (!view || !completionSchema) return;
  view.dispatch({
    effects: sqlLangCompartment.reconfigure(
      sql({ dialect: PLSQL, schema: completionSchema })
    ),
  });
});
```

- [ ] **Step 1.4: Run tests to confirm they pass**

```
bun run test src/lib/workspace/SqlEditor.test.ts
```

Expected: all tests pass including the new one.

- [ ] **Step 1.5: Run the full test suite**

```
bun run test
```

Expected: 161 passed (or more), 0 failed.

- [ ] **Step 1.6: Commit**

```
git add src/lib/workspace/SqlEditor.svelte src/lib/workspace/SqlEditor.test.ts
git commit -m "feat(editor): add completionSchema prop and Compartment for runtime SQL autocomplete"
```

---

## Task 2: Pass `completionSchema` through `SqlDrawer.svelte`

**Files:**
- Modify: `src/lib/workspace/SqlDrawer.svelte`

This task has no new test — the prop passthrough has no testable logic. Correctness is verified when Task 3 wires it end-to-end.

- [ ] **Step 2.1: Add `completionSchema` to SqlDrawer's Props type**

In `src/lib/workspace/SqlDrawer.svelte`, find the Props block (currently lines 11–12):

```typescript
type Props = { onCancel: () => void; onExplainWithAI: (msg: string) => void; onAnalyze?: () => void };
let { onCancel, onExplainWithAI, onAnalyze }: Props = $props();
```

Replace with:

```typescript
type Props = {
  onCancel: () => void;
  onExplainWithAI: (msg: string) => void;
  onAnalyze?: () => void;
  completionSchema?: Record<string, string[]>;
};
let { onCancel, onExplainWithAI, onAnalyze, completionSchema }: Props = $props();
```

- [ ] **Step 2.2: Pass `completionSchema` to `<SqlEditor>`**

In the template, find the `<SqlEditor` block (around line 299). It currently ends with `onExplain={triggerExplain}`. Add the new prop:

```svelte
<SqlEditor
  bind:this={editorRef}
  value={tab.sql}
  compileErrors={activeTabResult?.compileErrors ?? null}
  onChange={(s) => sqlEditor.updateSql(tab.id, s)}
  onRunCursor={(selection, cursorPos, docText) => {
    if (selection !== null) {
      void sqlEditor.runSelection(selection);
    } else {
      void sqlEditor.runStatementAtCursor(docText, cursorPos);
    }
  }}
  onRunAll={() => void sqlEditor.runActiveAll()}
  onSave={() => void sqlEditor.saveActive()}
  onSaveAs={() => void sqlEditor.saveAsActive()}
  onExplain={triggerExplain}
  {completionSchema}
/>
```

- [ ] **Step 2.3: Run the full test suite**

```
bun run test
```

Expected: all tests still pass.

- [ ] **Step 2.4: Commit**

```
git add src/lib/workspace/SqlDrawer.svelte
git commit -m "feat(drawer): pass completionSchema prop through to SqlEditor"
```

---

## Task 3: Fetch tables+views in `+page.svelte` and wire up

**Files:**
- Modify: `src/routes/workspace/[id]/+page.svelte`

No unit test — this touches the Tauri invoke layer which requires a real Oracle connection. Manual smoke test instructions are at the end of this task.

- [ ] **Step 3.1: Add `completionSchema` state variable**

In `src/routes/workspace/[id]/+page.svelte`, find the block of `$state` declarations near the top of the script (around lines 41–60, where `meta`, `schemas`, `selected`, etc. are declared). Add after `let refreshing = $state(false);`:

```typescript
let completionSchema = $state<Record<string, string[]>>({});
```

- [ ] **Step 3.2: Fetch tables and views in `bootstrap()` after schema detection**

In `bootstrap()`, find this block (around lines 306–313):

```typescript
const schemaRes = await schemaList();
if (!schemaRes.ok) {
  fatal = schemaRes.error.message;
  return;
}
schemas = schemaRes.data.map((s) => newSchemaNode(s.name, s.isCurrent));
const current = schemas.find((s) => s.isCurrent);
if (current) expandIfNeeded(current);
```

Replace with:

```typescript
const schemaRes = await schemaList();
if (!schemaRes.ok) {
  fatal = schemaRes.error.message;
  return;
}
schemas = schemaRes.data.map((s) => newSchemaNode(s.name, s.isCurrent));
const current = schemas.find((s) => s.isCurrent);
if (current) expandIfNeeded(current);

if (current) {
  const [tablesRes, viewsRes] = await Promise.allSettled([
    objectsList(current.name, "TABLE"),
    objectsList(current.name, "VIEW"),
  ]);
  const schema: Record<string, string[]> = {};
  if (tablesRes.status === "fulfilled" && tablesRes.value.ok)
    for (const t of tablesRes.value.data) schema[t.name] = [];
  if (viewsRes.status === "fulfilled" && viewsRes.value.ok)
    for (const v of viewsRes.value.data) schema[v.name] = [];
  completionSchema = schema;
}
```

- [ ] **Step 3.3: Pass `completionSchema` to `<SqlDrawer>`**

Find the `<SqlDrawer` usage in the template (around line 570):

```svelte
<SqlDrawer
  onCancel={() => void sqlEditor.cancelActive()}
  onExplainWithAI={(msg) => {
    chatPendingMessage = msg;
    showChat = true;
    Promise.resolve().then(() => { chatPendingMessage = ""; });
  }}
  onAnalyze={handleAnalyze}
/>
```

Replace with:

```svelte
<SqlDrawer
  onCancel={() => void sqlEditor.cancelActive()}
  onExplainWithAI={(msg) => {
    chatPendingMessage = msg;
    showChat = true;
    Promise.resolve().then(() => { chatPendingMessage = ""; });
  }}
  onAnalyze={handleAnalyze}
  {completionSchema}
/>
```

- [ ] **Step 3.4: Run the full test suite**

```
bun run test
```

Expected: all tests pass.

- [ ] **Step 3.5: Manual smoke test**

Compile the sidecar and start the app:

```
cd sidecar
bun build src/index.ts --compile --minify --outfile ../src-tauri/binaries/veesker-sidecar-x86_64-pc-windows-msvc.exe
cd ..
bun run tauri dev
```

1. Open a workspace with an active Oracle connection
2. Open the SQL Drawer (Ctrl+J if closed)
3. Type `SELECT * FROM ` — the autocomplete popup should appear with table and view names from the current schema
4. Arrow down to select a table name, press Tab or Enter — name is inserted
5. Type `FROM emp` — popup should filter to names starting with "EMP"
6. Open a second SQL tab — autocomplete should work there too (same schema data)

- [ ] **Step 3.6: Commit**

```
git add src/routes/workspace/[id]/+page.svelte
git commit -m "feat(workspace): fetch current schema tables+views for SQL autocomplete on bootstrap"
```

---

## Self-check for the implementer

After all three tasks are committed, verify:

- [ ] `bun run test` — all tests green
- [ ] `bun run lint` — no Biome errors
- [ ] Autocomplete popup appears after typing `FROM ` in the editor
- [ ] Popup does NOT appear mid-word in a string literal or comment
- [ ] Opening a second SQL tab shows the same completions
- [ ] Connecting to a schema with 0 tables doesn't crash (empty `completionSchema = {}`)
