# Veesker CE — Feature Inventory (verificável) vs Concorrentes

**Created:** 2026-05-09
**Repo analisado:** `C:\Users\geefa\Documents\veesker-project\ce` (Veesker Community Edition, OSS)
**Comparação alvo:** Toad for Oracle, PL/SQL Developer (Allround Automations), SQL Developer (Oracle), DBeaver, SQLcl
**Escopo:** Inventário técnico-fiel. Cada item com referência `arquivo:linha` (ou commit/módulo) verificável. Sem marketing — só código.
**Status legend:** ✅ implementado / 🟡 parcial / ❌ não implementado / 🔮 roadmap

> Este doc é defensável artigo-por-artigo. Se um item está marcado ✅ você consegue abrir o arquivo + linha citado e confirmar. Honestidade > favoritismo.

---

## ⚠️ ERRATA — 2026-05-09 (manual code validation)

This errata supersedes the Section 4 status fields for Items #0–#3 and Item #4 Phase A/B/C.

**Section 4 — Security Items: incorrect at time of writing.** Manual code validation on
2026-05-09 confirms all of the following are **fully implemented in CE main**:

| Item | Section 4 claim (incorrect) | Reality (verified 2026-05-09) |
|---|---|---|
| Item #0 — env-required | Listed as needing implementation | ✅ Implemented — `sidecar/src/oracle.ts:372` (`ConnectionSafety.env`) |
| Item #1 — PSDPM + PROD AI asymmetry | Listed as needing implementation | ✅ Implemented — `oracle.ts:1191-1204` `enforcePsdpmForOrigin()` |
| Item #2 — warnUnsafeDml env-calibrated | Listed as needing implementation | ✅ Implemented — `oracle.ts:1217-1310`, full DEV/STAGING/PROD tiers |
| Item #3 — command_history AES-256-GCM + PII | Listed as needing implementation | ✅ Implemented — `src-tauri/src/crypto.rs`, `src-tauri/src/pii.rs` |
| Item #4 Phase A/B/C | Partial / unclear status | ✅ All three phases shipped in CE + CL main |

**Vector Search Studio** was incorrectly shown in this inventory as Cloud-only. It is present
in CE (`src/lib/workspace/VectorScatter.svelte` · `sidecar/src/embedding.ts`). README corrected.

The Section 4 item list reflected an older tracking state, not the code at HEAD. The inventory
introduction note ("each file:line citation should be verified") applies — it caught this.
All other sections (#1–#3, #5–§18, bonus discoveries) remain accurate.

---

## 1. CONNECTION & DRIVER

| Item | Status | Onde | Detalhe |
|---|---|---|---|
| node-oracledb Thin mode default (no Instant Client) | ✅ | `sidecar/src/oracle.ts:24, 155` | `oracledb.autoCommit = false` no carregamento; `_driverMode: "thin"` por padrão. Thick exige `tryEnableThickMode()` ativa. |
| Auto-fallback Thick para Oracle 9i-11g | ✅ | `sidecar/src/oracle.ts:185-251` | Discovery multi-OS: Windows escaneia `C:\instantclient_*`, `C:\app\<user>\product`, `C:\Program Files\Oracle`; macOS/Linux `/opt/oracle`, `/usr/local/oracle`, `/usr/lib/oracle`. Verifica `oci.dll`/`libclntsh.{so,dylib}` antes de tentar `initOracleClient`. Cobre também `VEESKER_FORCE_THIN` e `VEESKER_INSTANT_CLIENT_DIR`. |
| Oracle Wallet (mTLS) com auto-detect TNS alias | ✅ | `sidecar/src/oracle.ts:78-87, 404-417, 450-458` | `extractServiceName()` parseia o tnsnames.ora; `ConnectionTestParams` aceita `configDir`/`walletLocation`/`walletPassword`. |
| Connection pool | ❌ | `sidecar/src/state.ts:15-29` | **Modelo de conexão única** — `currentSession: oracledb.Connection \| null` global. `setSession()` fecha a anterior antes de abrir nova. |
| Connection switcher / multi-PDB | 🟡 | `sidecar/src/state.ts:15-29` | Sequencial — frontend pode trocar workspace, mas só uma conexão ao mesmo tempo no sidecar. Item #5 (em worktree CL) introduz multi-conn por workspace, ainda não em CE. |
| Test connection com diagnostic query | ✅ | `sidecar/src/oracle.ts:436-478, 627-638` | `connectionTest()` roda `SELECT BANNER_FULL FROM V$VERSION WHERE ROWNUM=1` + `SELECT SYS_CONTEXT('USERENV','CURRENT_SCHEMA') FROM DUAL`. |
| Bundle size approx | 🟡 | `src-tauri/binaries/` | Sidecar binário Win 114 MB, macOS 64 MB, Linux 64 MB. Bundle final (.exe / .dmg) inclui WebView nativo + Tauri shell + sidecar; estimativa ~120-180 MB packaged. **Sem benchmark publicado.** |

---

## 2. CREDENCIAIS

| Item | Status | Onde | Detalhe |
|---|---|---|---|
| OS keychain integration (Win/macOS/Linux) | ✅ | `src-tauri/src/persistence/secrets.rs:1-146` + `Cargo.toml:35` | crate `keyring v3` com features `apple-native`, `windows-native`, `sync-secret-service`. Account naming `connection:{id}:wallet`, `apikey:{service}`. |
| Sidecar tem acesso direto ao keychain? | ❌ | (arquitetura) | Não. Sidecar (Bun) é **read-only quanto a secrets**. Rust shell busca via `keyring` e passa em-memória pra sidecar via RPC param. Reduz superfície de ataque. |
| Anthropic API key via keychain | ✅ | `src-tauri/src/persistence/secrets.rs:45-65` | `set_api_key(service, key)` armazena sob `apikey:{service}`. |
| Wallet password via keychain | ✅ | `src-tauri/src/persistence/secrets.rs:33-43` | `set_wallet_password(id, password)` sob `connection:{id}:wallet`. Persistente entre sessões. |
| Algum secret tocado a disco | ✅ NUNCA | (auditoria) | Senhas só passam em-memória entre Rust e sidecar. Wallet ZIP é extraído pra cache dir (`app.path().app_cache_dir()`) pra ler arquivos do wallet — mas a senha em si nunca toca disco em texto claro. Audit JSONL e command_history são encrypted-at-rest (Sec 5). |

---

## 3. SEGURANÇA SQL EXECUTION

| Item | Status | Onde | Detalhe |
|---|---|---|---|
| `autoCommit = false` forçado | ✅ | `sidecar/src/oracle.ts:24` + `:531-548` (assertAutoCommitFalse) | Set módulo-level no import. Belt-and-suspenders: assertion roda em todo checkout de conexão; throw `AUTOCOMMIT_VIOLATION (-32028)` se driver flipou. Toda `conn.execute()` ainda passa explícito `autoCommit: false` (linhas 1099, 1105-1106). |
| Read-only mode (`enforceSafetyForStatement`) | ✅ | `sidecar/src/oracle.ts:1217` + `sidecar/src/sql-kind.ts:68-72` | **Parse-based** (não regex puro). `classifySql()` classifica por keyword inicial após strip de comentários/q-strings. Read-only só permite `select` ou `with`; rejeita `EXPLAIN PLAN` inline (linha 70). DDL/DML/TCL/session block. |
| DML safety modal — comandos que disparam | 🟡 (lista mais estreita do que parece) | `sidecar/src/oracle.ts:1217-1290` + `sql-kind.ts:102-141` | **Lista exata:** `DELETE` sem `WHERE`, `UPDATE` sem `WHERE`, `TRUNCATE`, `MERGE`. Detecção: `isUnsafeBulkDml()` (regex stripa comentário, normaliza espaço, rejeita `WHERE 1=1`/`WHERE TRUE`/`EXISTS(SELECT FROM DUAL)`). `DROP`, `GRANT`, `REVOKE`, `ALTER USER`, `SHUTDOWN` **NÃO disparam modal** — passam direto. ⚠️ Bonus discovery (ver §19). |
| Calibragem por env (DEV/STAGING/PROD) | ✅ | `sidecar/src/oracle.ts:1233-1280` | DEV/local: single-confirm via flag `acknowledgeUnsafe`. STAGING: double-confirm com `acknowledgeTable` (extrai nome de tabela do SQL e exige match). PROD: TRUNCATE bloqueado permanente; MERGE/unsafe DML exige unlock window 15 min via `unlockUnsafeDml` RPC (linha 1282-1298). |
| Concurrency guard (queries simultâneas) | ✅ | `sidecar/src/oracle.ts:876-877, 1443-1456` | `_running: RunningQuery` global no sidecar. Bun é single-threaded; segunda chamada `queryExecute()` enquanto outra roda → falha limpa (não enfileira). |
| Cancel query in-flight | ✅ server-side | `sidecar/src/oracle.ts:1443-1456` | `queryCancel(requestId)` chama `conn.break()` (Oracle OCI break, real cancel). Driver levanta `ORA-01013`/`NJS-018` → captura em :1110-1111 e re-emite `QUERY_CANCELLED (-32029)`. **Cancela de verdade, não só disconnect.** |

---

## 4. ITEMS DE SEGURANÇA IMPLEMENTADOS (#0 ao #4)

Mapa do roadmap de hardening em CE (ordem de merge):

### Item #0 — env-required
- **O quê:** toda conexão precisa de tag `env` (`dev`/`staging`/`prod`/`local`); enforcement no sidecar e no RPC boundary.
- **Arquivos:** `sidecar/src/index.ts:83`, `sidecar/src/oracle.ts:372,400,411,414` (`ConnectionSafety.env`).
- **Estado:** ✅ totalmente implementado em CE.
- **Limitação:** classificação é confiada ao usuário (heurística de hostname existe, mas o user pode marcar errado).

### Item #1 — env follow-up + DevTools bypass + PROD asymmetry
- **O quê:** PSDPM (programmatic statement defense) + AI calls em `env=prod` exigem `acknowledgeProdAi`.
- **Arquivos:** `sidecar/src/oracle.ts:1191-1204` (`enforcePsdpmForOrigin()`), `sidecar/src/ai.ts:27,197-200,388`, `sidecar/src/ai.test.ts:167-312`.
- **Estado:** ✅ totalmente implementado.
- **Limitação:** PSDPM é validação de origem do statement; não bloqueia humano com `unsafeDml` window aberta de fazer coisa errada.

### Item #2 — warnUnsafeDml env-calibrated
- **O quê:** DEV single-confirm; STAGING double-confirm com type-table; PROD bloqueio + 15min unlock window.
- **Arquivos:** `sidecar/src/oracle.ts:521-522` (`UnsafeDmlWindow` + `WINDOW_TTL_MS = 900_000`), `:1217-1280`, `:1282-1298`.
- **Estado:** ✅ totalmente implementado.
- **Limitação:** lista de comandos cobertos é estreita (DELETE/UPDATE without WHERE + TRUNCATE + MERGE). DROP/GRANT/REVOKE não disparam.

### Item #3 — command_history encryption + PII mask + fail-closed keychain
- **O quê:** AES-256-GCM por linha; PII masker antes de cifrar; chave perdida no keychain → history desabilitado pra sessão (sem fallback pra zero key).
- **Arquivos:** `src-tauri/src/crypto.rs:15-254`, `:60-80`, `src-tauri/src/persistence/command_history.rs:51-92`, `src-tauri/src/pii.rs:19-36`.
- **Estado:** ✅ totalmente implementado em CE.
- **Limitação:** linhas legacy plaintext continuam decodificáveis (backward compat).

### Item #4 Phase A — sidecar TxState authoritative
- **O quê:** `DBMS_TRANSACTION.LOCAL_TRANSACTION_ID` polling pra fonte da verdade de TX.
- **Arquivos:** `sidecar/src/state.ts:31-87`, `sidecar/src/oracle.ts:1029-1037`, `:1913-1940`.
- **Estado:** ✅ implementado em CE.
- **Limitação:** "best-effort"; race no momento exato do commit/rollback resolve no próximo poll.

### Item #4 Phase B — frontend state correto via RPC
- **O quê:** frontend reconcilia tx state local com sidecar via `connectionTxState()`.
- **Arquivos:** `src/lib/stores/sql-editor.svelte.ts` (reconcile pós-exec), `sidecar/src/index.ts:27,116`.
- **Estado:** ✅ implementado.
- **Limitação:** UI é otimista entre exec e reconcile (counter local incrementa antes do RPC).

### Item #4 Phase C — Pending TX Modal
- **O quê:** modal antes de fechar conexão / app, com decisão por-conexão (commit/rollback/keep_open) e PROD-specific 30min-8h hold.
- **Arquivos:** `src/lib/workspace/PendingTxModal.svelte:8-40`, `src/lib/workspace/tx-modal-controller.ts`, `src/lib/workspace/PendingTxModal.test.ts` (9 cenários).
- **Estado:** ✅ **shipped em CE** (não é Cloud-only). PROD expõe "Manter aberto" 30min-8h; STAGING/PROD desabilitam "COMMIT ALL" (força decisão por-row); sem ESC dismiss.
- **Limitação:** sem focus trap / Esc / auto-foco (issue a11y project-wide aberta — bloqueia merge final do Item #5).

### Item #4 Phase D — close hooks
- **Estado:** ❌ **não implementado**. Specced em CL; precisa de Items #6 (multi-window) + #7 (FOR UPDATE) como pré-requisito antes do dispatch. 5 hooks: window/route/tab/tray/session_lost.

---

## 5. AUDIT TRAIL

| Item | Status | Onde | Detalhe |
|---|---|---|---|
| Path do arquivo | ✅ | `src-tauri/src/commands.rs:710,716` | `<app_data_dir>/audit/YYYY-MM-DD.jsonl` (UTC, um por dia). |
| Formato | ✅ | `src-tauri/src/commands.rs:717-746` + `src-tauri/src/crypto.rs` | JSONL com envelope AES-256-GCM por linha; prefixo `02:<base64(nonce(12) \|\| ciphertext \|\| tag(16))>`. Linhas legacy plaintext lidas com fallback. |
| Campos | ✅ | `src-tauri/src/commands.rs:717-735` | `ts` (RFC3339 ms), `connectionId`, `host`, `username`, `sql`, `success`, `rowCount`, `elapsedMs`, `errorCode`, `errorMessage`, `source` (user/ai/system), `env`, `origin` (user_typed/ai_tool/embed), `originDetail`. |
| Quem escreve | ✅ Rust shell | `src-tauri/src/commands.rs:704-757` | Server-side authoritative — independente de quem chamou (frontend/sidecar). `write_audit_entry()` invocado de `history_save()` e `query_execute()`. |
| HMAC chain | ❌ | — | **CL-only.** CE tem só encryption-at-rest. |
| PII masking aplicado | 🟡 | `src-tauri/src/pii.rs:19-36` + `src-tauri/src/persistence/command_history.rs:51-92` | **Aplicado em command_history; NÃO aplicado em audit JSONL** — audit preserva SQL raw (dentro do envelope criptografado) por design forense. ⚠️ Bonus discovery (§19). Padrões: CPF, CNPJ, email, cartão, telefone, RG. |
| Encryption-at-rest | ✅ | `src-tauri/src/crypto.rs:120-175` | AES-256-GCM por linha. Chave per-process armazenada no keychain (`veesker:audit-cipher-key`). Nonce 12B aleatório por linha; AEAD tag 16B. Read paths detectam prefixo `02:` e descriptografam transparente. |

---

## 6. CSP & FRONTEND SECURITY

| Item | Status | Onde | Detalhe |
|---|---|---|---|
| CSP definida | ✅ | `src-tauri/tauri.conf.json:23` | Strict CSP. |
| `connect-src` | ✅ | `src-tauri/tauri.conf.json:23` | `ipc:`, `http://ipc.localhost` (dev fallback), `https://api.veesker.cloud`. **Nenhum CDN genérico.** |
| `script-src` inline blocks | ✅ | mesma config | `'self'` only. **Sem `'unsafe-inline'` em scripts.** |
| `eval()` blocked | ✅ | mesma config | Nenhum `'unsafe-eval'`. |
| WebView | ✅ nativo | Tauri 2 default | WKWebView (macOS), WebView2 (Windows), WebKitGTK (Linux). **Sem Chromium bundled** — diferencial vs Electron-based competitors. |
| `style-src` | 🟡 | mesma config | inclui `'unsafe-inline'` (necessário pra estilos gerados pelo Svelte). Sem CSS externo de fonte não confiável. |

---

## 7. SQL INJECTION DEFENSES

| Item | Status | Onde | Detalhe |
|---|---|---|---|
| `quoteIdent()` | ✅ | `sidecar/src/oracle.ts:148-153` | Regex `/^[A-Za-z0-9_$#]{1,128}$/`. Valida → wrappa em `"..."`. **Throw em pattern fail.** ~50 call sites em oracle.ts (linhas 1869, 2034-2041, 2176-2201, 2239-2241, 2472, 2481-2482, 2491-2492, 2575). |
| Bind parameters | ✅ | `sidecar/src/oracle.ts:803-804, 1107, 2263` | Toda metadata query usa binds nomeados (`:owner`, `:name`, `:v`, `:rowid`). User SQL é executado verbatim com bind array vazio (responsabilidade do user usar `:bind` no SQL dele). |
| EXPLAIN PLAN STATEMENT_ID | ✅ literal intencional | `sidecar/src/oracle.ts:2301-2316` | UUID gerado server-side (`V${crypto.randomUUID()...}`), não user-supplied. Validado contra DDL/DML antes (regex linha 2312). |
| Anti-SSRF embedding URLs | ✅ | `sidecar/src/embedding.ts:15-54` | Blocklist hardcoded: `169.254.169.254` (AWS/Azure/GCP metadata), `metadata.google.internal`, `metadata.internal`, `instance-data`, `localhost`, `127.0.0.1`, `0.0.0.0`, `::1`. RFC1918 blocked: 10/8, 172.16/12, 192.168/16, IPv6 fe80::/10. Protocolo http/https only. **Deny-list, sem allowlist.** |

---

## 8. AI ASSISTANT BOUNDARIES

| Item | Status | Onde | Detalhe |
|---|---|---|---|
| AI executa SELECT diretamente? | ❌ | `sidecar/src/ai.ts:5,319` + `src/lib/workspace/SecurityDisclaimerModal.svelte:37` | **Não.** AI só sugere SQL e usa 4 tools read-only com aprovação por-tool por-turn. |
| Tools disponíveis | ✅ 4 only | `sidecar/src/ai.ts:39-88` | `describe_object`, `run_query` (max 50 rows), `get_ddl`, `list_objects`. |
| Read-only enforcement | ✅ parse-based | `sidecar/src/ai.ts:99-187` | Camada 1: `stripStringsAndComments()` (lines 99-160) — token-aware: `--`, `/* */`, q-strings `q'[...]'`, identificadores quoted `"..."`. Camada 2: regex `DANGEROUS_KEYWORDS` (linhas 169-171) `\b(...)\b/i`. Check final em :180-186 — exige `^(SELECT\|WITH)\b`, rejeita dangerous, rejeita `FOR UPDATE`. **Não é AST puro, mas sim string-tokenizer + regex** — honesto sobre limitações. |
| Lista exata de comandos rejeitados | ✅ | `sidecar/src/ai.ts:169-171` | `INSERT, UPDATE, DELETE, MERGE, CREATE, DROP, ALTER, TRUNCATE, RENAME, GRANT, REVOKE, EXECUTE, EXEC, CALL, BEGIN, DECLARE, COMMIT, ROLLBACK, UPSERT, LOCK, SET, UTL_HTTP, UTL_TCP, UTL_SMTP, UTL_FILE, UTL_INADDR, DBMS_LOCK, DBMS_HTTP, DBMS_LDAP, DBMS_SCHEDULER, DBMS_AQ, DBMS_PIPE, DBMS_FLASHBACK, DBMS_OUTPUT`. `REPLACE` intencionalmente fora (string function, não statement). Bug history: audit 2026-04-30 fixou bug_001 (block comment colapsando token boundary) + bug_002 (REPLACE function vs statement). |
| Disclosure modal antes de AI usar conexão | ✅ | `src/lib/workspace/SecurityDisclaimerModal.svelte:37` | Texto explícito: AI envia schema/columns/SQL/result samples pra `api.anthropic.com`. Checkbox obrigatório. |
| PROD-tagged ack adicional | ✅ sidecar-level | `sidecar/src/ai.ts:384-394` (sidecar gate) + `:27-31` | Se `safety.env === "prod"` e `!params.acknowledgeProdAi` → throw `-32604`. **Hard-locked** — PSDPM mode não bypassa. UI exige checkbox por-sessão. |
| Approval gate per-tool per-turn | ✅ | `sidecar/src/ai.ts:207-257` + `sidecar/src/ai-approval-state.ts:21-45` | `requestApproval()` emite frame `ai.approval.request` ao frontend. Cache `turnApproved: Set<string>` (linha 424) — uma vez aprovado pra X nesta turn, próximas calls de X passam. Reset por message. Timeout 5 min auto-deny. |
| Prompt injection mitigation | ✅ backtick neutralization | `sidecar/src/ai.ts:315` | `const safeSql = ctx.activeSql.slice(0, 800).replace(/\`{3,}/g, "~~~");` — 3+ backticks viram tildes pra não escapar fence Markdown. Limit 800 chars na contexto SQL. **Limited:** user messages no histórico chat passam verbatim. |
| Providers wired | ✅ Anthropic only (+ CLI fallback) | `sidecar/src/ai.ts:5,411,427,455,523` | `@anthropic-ai/sdk` com modelo `claude-haiku-4-5-20251001`. Fallback: se sem API key, spawna `claude` CLI local com `-p -`. **Sem OpenAI/Ollama/outros pra chat.** Embedding tem 4 (Sec 12). |

---

## 9. ARCHITECTURE & RESOURCE FOOTPRINT

| Item | Status | Onde | Detalhe |
|---|---|---|---|
| Tauri | ✅ v2 | `src-tauri/Cargo.toml:26` | — |
| Bun | 🟡 ≥1.1 | `CLAUDE.md` | **Sem `engines` em package.json.** CLAUDE.md exige ≥1.1. Sidecar compila com `--target=bun-<plat>-<arch>` pra cada plataforma. |
| Svelte | ✅ 5.55.5 | `package.json:68` | Runes-only (`$state`/`$derived`/`$effect`). |
| Top crates Rust | ✅ | `src-tauri/Cargo.toml` | `tauri v2`, `tokio v1`, `rusqlite v0.32`, `keyring v3`, `git2 v0.20`, `aes-gcm v0.10`, `tauri-plugin-shell v2`, `portable-pty v0.9`, `tauri-plugin-updater v2`, `reqwest v0.13`. |
| Sidecar IPC | ✅ JSON-RPC 2.0 stdin/stdout | `src-tauri/src/sidecar.rs:199-235` | Responses demuxed via UUID por request. **Sem timeout host-side** (queries longas não bloqueadas por 120s). Cancel via `query.cancel` RPC. Sidecar morto → pending senders limpos → callers recebem `-32002`. |
| Memória idle | ❌ unmeasured | — | **Sem benchmark publicado.** Toad Win pesa ~150 MB idle, SQL Developer ~400+ MB com Java. Veesker provável range 80-200 MB (WebView nativo + Bun + Rust), mas medir antes de declarar. |
| Cold start | ❌ unmeasured | — | **Sem trace.** Sprint A ProductionDetector roda na inicialização; M0/M1/M2/M3 (Item #5 F0a) adicionam overhead em primeira abertura pós-upgrade. |
| Process isolation | ✅ | `src-tauri/src/sidecar.rs` | Sidecar crash → UI sobrevive. Pending RPC callers recebem `-32002 process likely terminated`. Rust shell pode respawn (não está auto-spawn ainda — user precisa restartar app). |

---

## 10. SQL EDITOR & PRODUCTIVITY

| Item | Status | Onde | Detalhe |
|---|---|---|---|
| Editor | ✅ CodeMirror 6 | `src/lib/workspace/SqlEditor.svelte:11-12,128` + `package.json` | `@codemirror/{state,view,lang-sql,autocomplete,lint,commands}` v6. Dialect `PLSQL`. |
| Multi-statement splitter PL/SQL-aware | ✅ | `sidecar/src/sql-splitter.ts:19-112` (mirror em `src/lib/sql-splitter.ts`) | State machine — comments, string delimiters, blocos PL/SQL. `;` pra SQL, `/` pra PL/SQL. Regex `PLSQL_BLOCK_RE` matches `CREATE FUNCTION/PROCEDURE/TRIGGER/PACKAGE` + anonymous `BEGIN/DECLARE`. |
| Per-statement results | ✅ | `src/lib/stores/sql-editor.svelte.ts:22-35` (`TabResult`) + `src/lib/workspace/ExecutionLog.svelte` | Cada `TabResult` captura `statementIndex`, `sqlPreview`, `status`, `result`, `error`, `elapsedMs`, `dbmsOutput`, `compileErrors`, `explainNodes`. Log mostra "N statement(s)" colapsável com status icon. |
| Run modes (cursor / selection / all) | ✅ 3 modes | `src/lib/workspace/SqlEditor.svelte:74-124` | Mod+Enter → run cursor/selection; Mod+Shift+Enter ou F5 → run all; F6 → EXPLAIN PLAN. |
| Virtual scrolling em result grid | ✅ custom | `src/lib/workspace/ResultGrid.svelte:160-182` | `ROW_HEIGHT = 24`, `OVERSCAN = 10`. ResizeObserver tracks container; `visibleSlice` derivado de `scrollTop`. Padding divs fakeam altura total. **Sem lib externa** (`svelte-virtual-list`/tanstack) — implementação caseira. |
| Multi-tab SQL editor | ✅ store + UI | `src/lib/stores/sql-editor.svelte.ts:44-62` | `SqlTab` model completo. Tab bar exibe múltiplos. **Limitação Item #6:** multi-conn em multi-tab não é suportado (cada tab compartilha conexão ativa). Item #6 é pra abrir múltiplas SQL windows com conexões independentes. |
| Compile errors inline gutter | 🟡 | `src/lib/workspace/SqlEditor.svelte:159-176` + `src/lib/workspace/CompileErrors.svelte` | CodeMirror `lintGutter()` extension dá squiggle inline. Painel `CompileErrors` abaixo do editor lista erros com `onGoto(line)`. **Não é gutter marker tradicional tipo IntelliJ** — combo de squiggle + painel. |
| EXPLAIN PLAN visual | ✅ tree + cost + AI explain | `src/lib/workspace/ExplainPlan.svelte` | Hierarchical tree color-coded: TABLE ACCESS verde `#8bc4a8`, INDEX azul `#7aa8c4`, JOIN âmbar `#c3a66e`. Cada node: `Cost`, `Cardinality`, `Operation`, `ObjectName`. Botão "Explain with AI" formata e envia pra Sheep. |

---

## 11. PL/SQL DEBUGGER

| Item | Status | Onde | Detalhe |
|---|---|---|---|
| Implementado | ✅ completo | `src/lib/stores/debug.svelte.ts` + `src/lib/workspace/Debug*.svelte` | — |
| Breakpoints | ✅ toggle | `:58-65, 174-195` | `breakpoints[]` persistido. Toggle por `objectName + line`. UI: Ctrl+B + gutter click. |
| Step Into / Over / Out / Continue / Run | ✅ todos | `src/lib/workspace/DebugToolbar.svelte:62-68` | F7 (into), F10 (over), Shift+F7 (out), F5 (continue), F8 (run). RPCs: `debugStepIntoRpc`, `debugStepOverRpc`, `debugStepOutRpc`, `debugContinueRpc`, `debugRunRpc`. Buttons disabled exceto em `paused`. |
| Watch variables panel | ✅ | `src/lib/workspace/DebugLocals.svelte` | Locals + live vars em grid. |
| Call stack | ✅ | `src/lib/workspace/DebugCallStack.svelte` | `owner.objectName:line` hierarchical. |
| DBMS_OUTPUT capture | ✅ | `src/lib/stores/debug.svelte.ts:86` | `dbmsOutput: string[]` drained pós-pause/completion via sidecar RPC. UI dedicated tab. |
| SYS_REFCURSOR auto-extract | ✅ | `src/lib/stores/debug.svelte.ts:87` | `refCursors: DebugRunCursor[]`. Quando bloco anônimo retorna cursor OUT bind, sidecar extrai rows e exibe inline no result grid. |

> **Match ou supera Toad/SQL Developer pra debug PL/SQL.** Único concorrente que rivaliza no Windows é PL/SQL Developer (Allround); SQL Developer (Oracle) tem debug mas UX é desfavorecida.

---

## 12. VECTOR SEARCH (Oracle 23ai)

| Item | Status | Onde | Detalhe |
|---|---|---|---|
| VECTOR data type display | ✅ | `src/lib/workspace/ObjectDetails.svelte:528-530` | Badge "⬡ VECTOR" inline em columns tab. |
| HNSW / IVF index management | ✅ | `:841-1200`, dropdown `newIdxType` em `:965` | Modal de criação: HNSW vs IVF, name, metric (COSINE/EUCLIDEAN/DOT), accuracy. Listing + drop. **Sem UI tuning de NEIGHBOR PARTITIONS** — só metric/accuracy params. |
| Embedding providers | ✅ 4 | `sidecar/src/embedding.ts:56-137` | Ollama (local default `http://localhost:11434`), OpenAI (`text-embedding-3-small`), Voyage (`voyage-3-lite`), Custom HTTP (URL custom validada anti-SSRF). |
| 2D scatter PCA-projected | ✅ custom canvas | `src/lib/workspace/VectorScatter.svelte:20-100` | Power-iteration PCA: 2 componentes, 60 iterações, deterministic seed. Coloring high→low (greenish→orange-red). **Não usa D3, não three.js — canvas/SVG custom.** |
| Similarity search UI | 🟡 submit-based | `src/lib/workspace/ObjectDetails.svelte:1000-1020` | Text input + "Search" button (não live debounced). Options: distance metric, result limit, include-vectors toggle. |
| Anti-SSRF custom URLs | ✅ | `sidecar/src/embedding.ts:15-54` | `validateEmbedUrl()` chamado em `embedOllama()` (se baseUrl set) e `embedCustom()`. Cross-ref §7. |

---

## 13. VRAS (REST API ORDS)

| Item | Status | Onde | Detalhe |
|---|---|---|---|
| Ships in CE? | ✅ | `README.md:34` | "ORDS / REST API Studio \| ✅ \| ✅" — CE e Cloud iguais. ⚠️ Bonus: às vezes presumimos CL-only por ser feature pesada. |
| Auto-CRUD ORDS endpoints | ✅ | `src/lib/workspace/RestApiBuilder.svelte:44-47` + `sidecar/src/ords.ts:344-359` | Aceita table/view + ops (GET/POST/PUT/DELETE/GET_BY_ID). `ordsApply()` regenera SQL server-side, valida identifiers. |
| Custom SQL endpoint editor | ✅ | `:51` | `sourceSql` textarea pra SELECT/DML parametrizado. |
| Procedure endpoints + auto-introspect | ✅ | `:44` + `procDescribe` em `sidecar/src/oracle.ts` | Endpoint type "procedure", introspecta IN/OUT params. |
| OAuth 2.0 client management | ✅ | `sidecar/src/ords.ts:318-332` | `ordsRolesList`, `ordsClientsList`, `ordsClientsCreate`, `ordsClientsRevoke` — CRUD em metadata ORDS. |
| Inline HTTP test panel | ✅ | `src/lib/workspace/RestTestPanel.svelte:1-55` | Method dropdown, path, headers (add/remove), body, send via `ordsTestHttp()`, exibe response + status. |
| Export module as SQL | ✅ | `sidecar/src/ords.ts:261-315` | `ordsModuleExportSql()` gera DDL completo: DEFINE_MODULE / DEFINE_TEMPLATE / DEFINE_HANDLER / DEFINE_PRIVILEGE. |
| Bootstrap detection ORDS | ✅ | `:25-128` | `ordsDetect()` checa pacote ORDS, acesso, version, schema enabled, admin role, base URL. |
| AI-assisted endpoint creation | ✅ | `src/lib/workspace/RestApiBuilder.svelte:71-95+` | Sheep AI overlay com NL input → `aiSuggestEndpoint()` retorna struct que auto-fill form. |

> **VRAS é diferencial forte em CE** — concorrentes (Toad, PL/SQL Developer) não têm REST API Studio integrado.

---

## 14. UPDATES & DISTRIBUTION

| Item | Status | Onde | Detalhe |
|---|---|---|---|
| Auto-update | ✅ Tauri updater + GitHub Releases | `src-tauri/tauri.conf.json:44-52` + `tauri-plugin-updater` | Endpoint `https://github.com/veesker-cloud/veesker-community-edition/releases/latest/download/latest.json`. Install mode `passive` no Windows. Check delay 2s pós-boot. |
| Ed25519-signed releases | ✅ | `tauri.conf.json:48` | Pubkey embedded (base64 minisign). Private key em `~/.veesker/update-key` (nunca committed). Doc completo em `docs/AUTO_UPDATE.md:32-50`. |
| Code signing Windows | 🟡 pending | `docs/CODE_SIGNING.md` | Plano: Azure Trusted Signing via Service Principal (`AZURE_TENANT_ID/CLIENT_ID/CLIENT_SECRET`). **Status: aguardando aprovação Identity Validation Microsoft** (3-7 dias post-submit). |
| Code signing macOS | 🟡 ad-hoc | `tauri.conf.json:33` | `signingIdentity: "-"` — assinatura ad-hoc (Gatekeeper warning em outros Macs). **Sem Apple Developer ID, sem notarização ainda.** |
| Telemetry | ✅ ZERO | `COMMERCIAL_USE.md:46` | Honor system. Verificado: sem Sentry/Plausible/Amplitude/custom beacon em `package.json` ou sidecar code. |
| License server / kill-switch | ✅ ZERO | (auditoria) | App funciona fully offline. Commercial subscriptions são honor-based per `COMMERCIAL_USE.md:44-46`. |

> **Diferencial enorme vs Toad/PL-SQL Developer**: zero telemetria, zero callback, zero kill-switch. Funciona air-gapped.

---

## 15. SCHEMA BROWSER

| Item | Status | Onde | Detalhe |
|---|---|---|---|
| Object kinds | ✅ 9 | `src/lib/workspace.ts:15-18` | TABLE, VIEW, SEQUENCE, PROCEDURE, FUNCTION, PACKAGE, TRIGGER, TYPE, REST_MODULE. **Faltam: materialized views, synonyms, dblinks** (DataFlow os reconhece como cores, mas SchemaTree não lista). |
| Vector indicator badge per table | ✅ | `src/lib/workspace/SchemaTree.svelte:16,262-263` | Glyph `⬡` next to TABLE name se `vectorTables: Set<string>` contém. RPC `vectorTablesInSchema()`. |
| Smart filter por kind | ✅ | `:34, 62-67` | `hiddenKinds` toggle. KIND_LABELS + KIND_SHORT maps. |
| Object kind counts | ✅ | `:15` | `kindCounts: Partial<Record<string, number>>`. RPC `schemaKindCounts()`. |
| System schema toggle | ✅ | `:35, 38-46, 87-92` | Hardcoded `SYSTEM_SCHEMAS` set (28 schemas: SYS, SYSTEM, ORDSYS, MDSYS, etc.). |

---

## 16. TABLE INSPECTOR

| Item | Status | Onde | Detalhe |
|---|---|---|---|
| Columns tab | ✅ completo | `src/lib/workspace/ObjectDetails.svelte:500-546` | Nome, type (color hint por type family), nullable, default, comments, PK badge. |
| Indexes tab | 🟡 minimal | `:548-583` | Index name, UNIQUE flag, columns (CSV). **Sem expression index detection** — só column refs. |
| Related tab (FKs/dependents/constraints/grants) | ✅ comprehensive | `:585-700+` | Triggers (type/event/status/FOR EACH), outgoing FKs (cols/ref/delete rule), incoming FKs (dependents), constraints (unique/check), grants. |
| DataFlow graph | ✅ scans PL/SQL bodies | `src/lib/workspace/DataFlow.svelte:20-96` + RPC `objectDataflow` | SVG bezier paths. FK ↑/↓, upstream "uses", downstream "ref", triggers. **Scans PL/SQL bodies via `DBMS_UTILITY.EXPAND_SQL_TEXT()`** pra extrair refs embedded. |
| Quick actions | ✅ todos | `:390-418` | Preview Data (abre SQL drawer com `SELECT *` + PK paginação), Count (live `SELECT COUNT(*)`), View DDL (callback `onViewDdl`). |

---

## 17. KNOWN LIMITATIONS (CE vs Cloud Edition)

Da `README.md:19-55`, `COMMERCIAL_USE.md`, `SECURITY.md:68-72`, `docs/decisao-separacao-repos.md`:

**O que CE NÃO tem que Cloud tem:**
- AI schema-aware (Cloud envia esquema do DB pra context window)
- AI query execution as recommendation (Cloud pode rodar safe queries auto)
- Query optimization + perf suggestions via AI
- AI-generated charts via NL
- Debugger analysis & AI hints
- Vector Search Studio (UI avançada vs CE básico)
- Team features + shared queries (multi-user workspace sync)
- Usage dashboard + billing integration
- VeeskerDB Sandbox (encrypted production data slices)
- VeeskerDB Cloud sync
- HMAC-chain audit (CE só tem encryption-at-rest)

**Limitações documentadas em `SECURITY.md:68-72`:**
- SQLite query history não criptografado em algumas paths legacy (CE plaintext em compat; Cloud sempre encrypted)
- Audit JSONL sem cryptographic chain integrity
- AI read-only enforcement é keyword-based, não AST-based

**Workarounds manuais em CE:**
- BYOK (Bring Your Own Anthropic Key) pra AI features
- Export/backup audit logs manual (sem Cloud shipping)
- Connection creds via OS keychain local (sem Cloud sync)
- Sem auto-backup de workspace settings (export JSON manual)

---

## 18. ITEMS DO ROADMAP NÃO IMPLEMENTADOS

Status agregado dos items do hardening + features pendentes:

| Item | Estado em CE main | Notas |
|---|---|---|
| #4 Phase D — close hooks (5 hooks: window/route/tab/tray/session_lost) + recovery startup | 🔮 specced em CL, NÃO em CE | Pré-requisitos: Items #6 + #7 |
| #5 — workspace per cliente / multi-conn (F0a + F0b + F1-F4) | 🔮 F0a code-done em worktree CL, NÃO portado pra CE | Spec `docs/superpowers/specs/2026-05-08-item-5-workspace-multi-conn.md` (CL) |
| #6 — multi SQL windows (PL/SQL Developer-style) | 🔮 specced (CL) | Spec `2026-05-08-item-6-multiple-sql-windows.md` (CL) — pré-req pra Phase D |
| #7 — SELECT FOR UPDATE edit-in-grid | 🔮 specced (CL) | Spec `2026-05-08-item-7-for-update-edit-in-grid.md` (CL) — diferencial de mercado per memória |
| #8 — export awareness em PROD | 📋 backlog | Inferido de roadmap memória |
| #9 — dry-run obrigatório certas DML | 📋 backlog | — |
| #10 — janela de horário PROD (business hours block) | 📋 backlog | — |
| #11 — TBD | 📋 backlog | — |

CE repo tem só `docs/superpowers/specs/2026-05-07-command-mode-design.md`. Demais specs vivem em CL.

---

## 19. RESUMO ESTRATÉGICO

### 5 diferenciadores únicos verificados no código

1. **PROD-tagged AI gate sidecar-level** (`sidecar/src/ai.ts:384-394`) — bloqueio é no sidecar (-32604), não só UI. Zero concorrente faz isso (Toad/SQL Developer/DBeaver não tem conceito de env tag, e plugins de AI deles não têm gate por env).

2. **Native PL/SQL debugger completo em Tauri/CodeMirror** (`src/lib/stores/debug.svelte.ts` + `src/lib/workspace/Debug*.svelte`) — Step Into/Over/Out, watch, callstack, DBMS_OUTPUT inline, REF CURSOR auto-extract. PL/SQL Developer tem; SQL Developer tem com UX inferior; Toad tem; DBeaver não tem PL/SQL debugger; SQLcl não tem. **Veesker é uma das ~3 ferramentas com debugger PL/SQL maduro.**

3. **AES-256-GCM encryption-at-rest com fail-closed keychain** (`src-tauri/src/crypto.rs:60-80`) — chave perdida no keychain → history desabilitado pra sessão (sem fallback pra zero key). Per-line nonce. Zero concorrente OSS oferece isso default.

4. **Oracle 23ai vector studio integrado** (`src/lib/workspace/VectorScatter.svelte:20-100` + `sidecar/src/embedding.ts:56-137`) — HNSW/IVF UI, 4 embedding providers, PCA scatter custom. Concorrentes: SQL Developer não tem; Toad não tem; PL/SQL Developer não tem; DBeaver tem visualizadores básicos mas sem embedding pipeline.

5. **Server-side query cancel via OCI break** (`sidecar/src/oracle.ts:1443-1456`) — `conn.break()` real, não disconnect. Driver levanta ORA-01013 e captura limpo. Match com Toad/PL-SQL Developer; superior a DBeaver (que disconnects sessão inteira).

### 5 limitações reais perdendo pra Toad/PL-SQL Developer hoje

1. **Single connection model.** Sidecar mantém uma conexão Oracle por vez (`sidecar/src/state.ts:15-29`). Toad e PL/SQL Developer suportam múltiplas conexões e múltiplas SQL windows com conexão independente cada. Item #5 + #6 endereçam, ainda não em CE.

2. **Lista de DMLs warned é mais estreita** — `DROP`, `GRANT`, `REVOKE`, `ALTER USER`, `SHUTDOWN` não disparam confirmação (`sql-kind.ts:102-141`). Toad tem confirmação configurável muito mais ampla. Isso não é bug nem omissão acidental — é decisão consciente — mas é uma vantagem de Toad que devemos comunicar.

3. **Compile errors em painel separado, não inline gutter tradicional.** CodeMirror lintGutter dá squiggle, mas não o IntelliJ-style hover-with-fix. Toad e PL/SQL Developer têm gutter com erro inline + jump.

4. **Schema browser sem materialized views, synonyms, dblinks.** `src/lib/workspace.ts:15-18` lista 9 kinds; faltam três importantes em ambientes Oracle reais. Toad/SQL Developer/PL-SQL Developer todos listam.

5. **Sem benchmark publicado de memória idle e cold start.** Concorrentes (especialmente PL/SQL Developer com ~25 MB idle) batem Veesker no marketing por padrão. Sem medir o footprint real, perdemos por default.

### Bonus discoveries (inconsistências flagadas durante análise)

> User pediu igual ao caso do índice LOWER(name). Aqui estão:

1. **PII masking aplicado em command_history mas NÃO em audit JSONL** (`src-tauri/src/persistence/command_history.rs:51-92` vs `src-tauri/src/commands.rs:704-757`). Isso é intencional (audit preserva SQL raw pra forense), mas **não está documentado em SECURITY.md**. Deveria ter um `### Why audit preserves raw SQL` section, senão um auditor externo pode flagar como vulnerabilidade aparente.

2. **`DROP` não dispara DML safety modal** (`sidecar/src/sql-kind.ts:102-141`). Item #2 cobre DELETE/UPDATE without WHERE + TRUNCATE + MERGE, mas DROP TABLE / DROP USER / DROP TABLESPACE passam direto. Geralmente DBA-level operations, mas em ambientes onde `env=prod` não é confiável (Item #0 limitação), isso é uma lacuna real.

3. **Multi-tab editor já está no store + UI mostra tab bar**, mas Item #6 está specced como "multi SQL windows". Distinção pode ser confusa: hoje user pode abrir múltiplos tabs (`SqlTab[]` em `src/lib/stores/sql-editor.svelte.ts:44-62`), só que todos compartilham a conexão ativa. Item #6 é multi-window com conexões independentes. **Essa diferença merece ser explicitada na próxima vez que o spec do #6 for revisado.**

4. **VRAS está em CE** (`README.md:34` confirma "ORDS / REST API Studio ✅ ✅") — easy de assumir Cloud-only por ser feature pesada. Comunicação em landing page deveria deixar claro.

5. **Auto-update endpoint hardcoded em `tauri.conf.json:44-52` aponta pra `veesker-community-edition` releases.** Funciona pra CE; mas se um user instalou CL build local-compilado e o config CSV vazou pra ambiente CE, o updater puxa CE binário em cima de CL. **Migration scenario worth documenting.**

6. **Audit `02:` prefix é detectável publicly** — qualquer linha começando com `02:` é envelope criptografado. Atacante com leitura ao arquivo sabe imediatamente o formato. Não é vulnerabilidade (o ciphertext é seguro), mas é information disclosure. Format envelope marker poderia ser raw bytes em vez de string ASCII parseable.

7. **Bun version não pinned em `package.json`** (sem `engines`). CLAUDE.md diz "≥1.1" mas user pode rodar com Bun 0.x sem warning. CI deveria gate em `bun --version`.

---

## Apêndice — Versões e referências auditadas

| Source | Versão / linha auditada |
|---|---|
| Tauri | 2 (`src-tauri/Cargo.toml:26`) |
| Svelte | 5.55.5 (`package.json:68`) |
| oracledb (sidecar) | inferido por `sidecar/src/oracle.ts:24` (autoCommit prop ainda existe — modern v6+) |
| CodeMirror | 6.x via `@codemirror/{state,view,...}` |
| keyring (Rust) | 3 com features apple/win/linux native |
| aes-gcm (Rust) | 0.10 |
| README.md | linhas 19-55 (CE vs Cloud feature matrix) |
| SECURITY.md | linhas 68-72 (CE limitations honesty section) |
| Audit author | Claude Opus 4.7 (este doc), 5 agents Sonnet (varredura paralela) |

---

> **Defensibilidade:** cada `arquivo:linha` listado pode ser aberto em editor pra confirmar. Se durante revisão surgir item onde a citação não aponta pra código real, é bug do inventário — corrigir e re-publicar. Não inflar pra preencher coluna; honest-by-default.
