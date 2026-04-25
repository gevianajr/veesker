# VRAS — Roteiro de Testes Manuais

**Data:** 2026-04-25
**Branch:** `main` (commit final: `e44d0c7`)
**Total de commits VRAS:** 23

## Pré-requisitos

1. Oracle 23ai com ORDS instalado
   - Container Docker, Oracle Cloud, ou install local
   - ORDS Standalone server rodando (porta padrão 8443)
   - URL acessível ex: `https://localhost:8443/ords` (ou `http://`)
2. Schema com privilégio `ORDS_ADMINISTRATOR_ROLE` ou DBA
3. Pelo menos 1 tabela e 1 procedure no schema pra testar
4. App compilado: `bun run tauri dev`

---

## Status do Code Review

⚠️ **3 BLOCKERS corrigidos** (commit `e44d0c7`):
- Tradução BuilderConfig → SQL generator
- Bootstrap modal auto-trigger
- Right-click context menu pra TABLE/VIEW

⏳ **1 BLOCKER pendente de validação no banco real:**
- **OAuth client_secret retrieval** — após `OAUTH.CREATE_CLIENT`, lemos `client_secret` de `USER_ORDS_CLIENTS`. Se o valor retornado for hash em vez do plaintext, o "secret-once" modal mostrará lixo. Validar no Teste 8.2 abaixo.

🟡 **SHOULD-FIX deferred (não-blockers):**
- `ords_apply` não loga em `audit_logs`
- `ordsClientsCreate` não é atômico (3 BEGIN..END separados)
- `danger_accept_invalid_certs(true)` sempre on (sem flag dev/prod)
- Erros -32011/-32012 mostrados como alerta genérico

---

## ROTEIRO

### 1. Bootstrap & Detecção (Phase 1)

#### 1.1 Conectar em schema sem ORDS habilitado
**Setup:** Conectar com user que NÃO está em `USER_ORDS_SCHEMAS`.
**Esperado:**
- App abre normalmente
- Modal "VRAS — Configuração ORDS" aparece automaticamente
- Mensagem: *"Schema XPTO não está habilitado"*
- Botão **"Habilitar agora"** visível
- Bloco SQL preview: `BEGIN ORDS.ENABLE_SCHEMA(p_enabled => TRUE); COMMIT; END;`

#### 1.2 Habilitar schema via 1 clique
**Ação:** Clicar **"Habilitar agora"**
**Esperado:**
- Botão muda pra "Habilitando…"
- Modal fecha após sucesso
- Schema agora aparece em `USER_ORDS_SCHEMAS` (verificar via SQL: `SELECT * FROM user_ords_schemas;`)
- Schema Tree refresca; nó "REST Modules (0)" aparece

#### 1.3 Conectar sem ORDS instalado
**Setup:** Conectar em banco onde ORDS package não existe.
**Esperado:**
- Modal aparece: *"ORDS não está instalado"*
- Comando documentado: `@$ORACLE_HOME/ords/install.sql`
- Link para docs Oracle

#### 1.4 ordsBaseUrl manual
**Setup:** Conectar em ambiente onde `ords_metadata.ords_properties.security.host.url` não está acessível.
**Esperado:**
- Modal mostra: *"URL base do ORDS"*
- Input livre, salvar persiste em localStorage (chave: `veesker.ords.baseUrl.<connectionId>`)
- Reabrir conexão → URL ainda aplicada

---

### 2. Schema Tree Integration (Phase 2)

#### 2.1 Listar módulos existentes
**Setup:** Schema com pelo menos 1 module ORDS já criado.
**Esperado:**
- Schema Tree mostra novo kind **"REST Modules"** com count
- Cor laranja-rosé `#f5a08a` (mesma família do Veesker)
- Expandir mostra todos os módulos do schema
- Clicar num módulo abre painel de detalhes à direita

#### 2.2 Painel de detalhes do módulo
**Setup:** Clicar num módulo qualquer.
**Esperado:**
- Header: 📦 nome, base path, status, items per page
- Lista de **Templates** com URI patterns
- Cada template mostra **Handlers** (GET/POST/PUT/DELETE) com chips coloridos por método
- Botão `[view source ▾]` expande PL/SQL/SQL inline
- Lista de **Privileges** (se houver)
- Botões: **Test**, **Docs ↗**, **Export as SQL**, **Add new endpoint**

#### 2.3 Export como SQL
**Ação:** Clicar **"Export as SQL"**.
**Esperado:**
- Novo SQL tab abre com nome **"Export: <module-name>"**
- Conteúdo: bloco PL/SQL completo com header de comentário
- Estrutura: `BEGIN ORDS.DEFINE_MODULE(...); ORDS.DEFINE_TEMPLATE(...); ORDS.DEFINE_HANDLER(...); ... COMMIT; END;`
- Validação: rodar esse SQL em outro schema deveria recriar o módulo
- ⚠️ NÃO inclui OAuth clients (esperado — secrets não recuperáveis)

---

### 3. Auto-CRUD (Phase 3)

#### 3.1 Criar API auto-CRUD
**Setup:** Schema Tree → REST Modules → botão **"Criar API"** (ou "Add new endpoint" no detalhe).
**Esperado:**
- Modal "Criar Endpoint REST" abre
- Tipo padrão: **Auto-CRUD** selecionado
- Dropdown carrega tabelas e views do schema atual
- Selecionar uma tabela → moduleName e basePath autopreenchem (slug)
- Checkboxes GET/POST/PUT/DELETE/GET_BY_ID todos marcados por default
- Seção "Preview da URL" mostra URLs derivadas

#### 3.2 Right-click "Expor como API REST" em TABLE
**Ação:** Right-click numa TABLE no Schema Tree.
**Esperado:**
- Menu contextual aparece com **"Expor como API REST…"**
- Clicar abre o builder pré-preenchido (Auto-CRUD + tabela selecionada)

#### 3.3 Auth: Role
**Setup:** Builder em modo Auto-CRUD com tabela selecionada.
**Ação:** Selecionar Auth = "Role do banco" → escolher uma role.
**Esperado:**
- Dropdown de roles carrega de `ALL_ORDS_ROLES`
- Preview SQL inclui `ORDS.DEFINE_PRIVILEGE` com a role escolhida

#### 3.4 Visualizar SQL → Apply
**Ação:** Clicar **"Visualizar SQL →"** → revisar bloco → **"Aplicar"**.
**Esperado:**
- Modal RestApiPreview mostra:
  - Conexão alvo
  - SQL gerado com ORDS.ENABLE_OBJECT
  - Aviso "⚠ Vai chamar N rotinas ORDS.* e fazer COMMIT"
- Apply executa e fecha modal
- Schema Tree refresca; novo módulo aparece em REST Modules
- Auto-abre detail panel do novo módulo

#### 3.5 Visualizar SQL → Copy to SQL tab
**Ação:** No mesmo preview, clicar **"Copiar para SQL tab"**.
**Esperado:**
- Novo SQL tab "VRAS Generated" abre com o bloco
- Modais fecham
- Usuário pode rodar manualmente

---

### 4. Custom SQL Endpoint (Phase 3)

#### 4.1 Criar custom SQL com bind variables
**Setup:** Builder → Tipo "Custom SQL".
**Ação:**
- SQL: `SELECT * FROM employees WHERE department_id = :dept_id`
- Rota: `/by-dept/:dept_id`
- Método: GET
**Esperado:**
- Hint mostra: "Bind variables no SQL: dept_id"
- Hint: "Path params na rota: dept_id"
- Preview SQL contém `ORDS.DEFINE_HANDLER` com `ORDS.source_type_collection`
- Apply funciona

#### 4.2 Custom SQL POST com plsql block
**Setup:** Builder → Custom SQL.
**Ação:** Método = POST, source com `BEGIN INSERT INTO ... END;`
**Esperado:** Source type vira `ORDS.source_type_plsql`

---

### 5. Procedure Endpoint (Phase 3)

#### 5.1 Right-click "Expor como endpoint REST" em PROCEDURE
**Ação:** Right-click numa PROCEDURE com IN/OUT params no Schema Tree.
**Esperado:**
- Menu contextual: **"Expor como endpoint REST…"**
- Builder abre pré-preenchido com tipo "Procedure"

#### 5.2 Apply procedure endpoint
**Setup:** Procedure simples, ex: `EMP_PKG.create_emp(p_name IN VARCHAR2, p_salary IN NUMBER, p_id_out OUT NUMBER)`.
**Ação:** Configurar rota/método → Visualizar SQL.
**Esperado:**
- Preview contém handler PL/SQL gerado:
  - DECLARE com `v_p_id_out NUMBER;`
  - Chamada `EMP_PKG.create_emp(...)` com binds
  - HTP.print emitindo JSON `{"p_id_out": ...}`
  - `:status_code := 200`
- ⚠️ Validar: para procedures com tipos complexos (RECORD, COLLECTION) o V1 não suporta — deve mostrar warning ou falhar elegantemente

---

### 6. Sheep AI no Builder (Phase 4)

#### 6.1 Pre-requisito: API key configurada
**Setup:** SheepChat → Settings → cole Anthropic API key.

#### 6.2 Sugestão por linguagem natural
**Setup:** Abrir builder → clicar **"✨ Sheep"**.
**Ação:** Digitar: *"Cria um endpoint que lista funcionários ativos do departamento informado, ordenado por salário"*
**Esperado:**
- Loading "Pensando…"
- Resposta com:
  - `reasoning` em 1-2 frases
  - `type` provavelmente "custom-sql"
  - `sourceSql` com WHERE/ORDER BY apropriado
  - `routePattern` algo como `/active-by-dept/:dept`
  - `method`: GET
- Botão **"Aplicar ao form"** preenche todos os campos
- Form fica no modo correspondente

#### 6.3 Sheep sem API key
**Esperado:** Erro claro pedindo configurar a key (não crash).

---

### 7. Test Panel (Phase 4)

#### 7.1 Testar endpoint público (NONE auth)
**Setup:** Módulo deployado sem auth.
**Ação:** Module Details → **"Test"** → preencher path → Send.
**Esperado:**
- Painel lateral abre à direita (380px)
- URL preview live (lowercased schema + module + path)
- Status code colorido (verde 2xx, vermelho 4xx/5xx)
- Response JSON pretty-printed
- Tempo (ms) e tamanho (KB) exibidos

#### 7.2 Testar endpoint com OAuth (Bearer)
**Setup:** Módulo com privilege OAuth + você tem client_id/secret válidos.
**Ação:**
1. Test panel → **"▸ Obter Bearer token (OAuth)"** expande
2. Digitar client_id e client_secret
3. Clicar **"Solicitar token e injetar header"**
**Esperado:**
- Sidecar faz `POST <baseUrl>/<schema>/oauth/token` com Basic auth
- Recebe `access_token`
- Header `Authorization: Bearer <token>` é injetado automaticamente
- Section recolhe; campo client_secret limpa
- Send subsequente passa autenticação

#### 7.3 Allowlist de URL
**Ação:** Tentar mudar a URL manualmente para um host externo (ex: `https://google.com`).
**Esperado:**
- Send falha com mensagem: "URL not allowed by allowlist (must start with: ...)"

#### 7.4 Self-signed cert
**Esperado:** O cliente reqwest aceita certs inválidos (`danger_accept_invalid_certs(true)`). ⚠️ Issue conhecida: deveria ser apenas dev mode.

#### 7.5 Abrir Swagger nativo
**Ação:** Module Details → **"Docs ↗"**.
**Esperado:**
- Browser externo abre em `<baseUrl>/<schema>/open-api-catalog<modulePath>`
- Swagger UI nativo do ORDS renderiza
- ⚠️ Se URL base não configurada, alerta pedindo configurar

---

### 8. OAuth Clients Panel (Phase 4)

#### 8.1 Listar clients existentes
**Ação:** Tab bar do workspace → botão **🔐 OAuth**.
**Esperado:**
- Modal abre listando clients de `USER_ORDS_CLIENTS`
- Tabela: Nome, Descrição, Criado em, Revogar
- Botão **"+ Novo Client"**

#### 8.2 Criar novo client (⚠️ TESTE CRÍTICO)
**Ação:**
- "+ Novo Client" → preencher nome `test-mobile-app`, descrição, selecionar 1+ roles
- "Criar Client"
**Esperado:**
- Modal de "Salve agora" aparece com:
  - Client ID legível
  - Client Secret legível ⚠️ **VALIDAR**: se aparecer hash em vez de plaintext, é o issue #4 do code review
- Botões 📋 copiam pro clipboard
- "Já salvei" fecha
- Lista atualiza com o novo client

**Se secret aparecer como hash:** documentar e abrir issue. Fix será capturar via OUT bind no `OAUTH.CREATE_CLIENT` ou usar `OAUTH.GET_CLIENT_SECRET`.

#### 8.3 Revogar client
**Ação:** Botão "Revogar" numa linha → confirmar.
**Esperado:**
- Confirm dialog
- Sucesso → client some da lista
- Verificar via SQL: `SELECT * FROM user_ords_clients;` (não deve mais aparecer)

---

### 9. Performance & Edge Cases

#### 9.1 Schema com muitos módulos
**Setup:** Schema com 50+ módulos.
**Esperado:** Listagem rápida (<1s), scroll fluido na árvore.

#### 9.2 Procedure com tipo complexo
**Setup:** Procedure que tem param `RECORD` ou `COLLECTION` ou `%ROWTYPE`.
**Esperado:** ⚠️ V1 não suporta — deveria mostrar warning. Atualmente provavelmente passa params vazios. **TESTAR e abrir issue se gerar SQL inválido.**

#### 9.3 SYS_REFCURSOR como OUT
**Setup:** Procedure com `p_cursor OUT SYS_REFCURSOR`.
**Esperado:** Spec diz que é suportado via APEX_JSON. ⚠️ V1 atual provavelmente NÃO trata — ver `generateProcedureEndpoint` no ords.ts. **TESTAR e abrir issue se necessário.**

#### 9.4 Apply em conexão sem privilégio
**Setup:** Logar com user que NÃO tem `ORDS_ADMINISTRATOR_ROLE`.
**Esperado:**
- Bootstrap modal alerta sobre privilégio faltante
- Apply mostra erro Oracle apropriado (não crash)

---

### 10. Smoke test final

Sequência ponta-a-ponta validando o fluxo completo:

1. ✅ Abrir conexão em schema novo → bootstrap modal aparece
2. ✅ Habilitar schema com 1 clique
3. ✅ REST Modules (0) aparece no Schema Tree
4. ✅ Right-click numa tabela → "Expor como API REST" → builder pré-preenchido
5. ✅ Auth = "Role" → escolher role → Visualizar SQL
6. ✅ Apply → módulo aparece em REST Modules
7. ✅ Clicar no módulo → detalhes mostram templates/handlers
8. ✅ Test → endpoint responde 200 com dados
9. ✅ "Docs ↗" → Swagger UI abre no browser
10. ✅ Export as SQL → bloco recreatable num SQL tab
11. ✅ Sheep ✨ no builder → sugestão para outro endpoint
12. ✅ Criar procedure endpoint → params introspectados → apply
13. ✅ OAuth client create → secret mostrado 1x → token via test panel → 200
14. ✅ Revogar client → some da lista

---

## Issues conhecidas a validar

| # | Severidade | Descrição | Como testar |
|---|---|---|---|
| 1 | ⏳ Pendente | client_secret pode vir como hash | Teste 8.2 |
| 2 | 🟡 | ords.apply não vai pro audit_logs | Verificar `audit/<date>.jsonl` |
| 3 | 🟡 | OAuth client create não atômico | Falhar grant role propositalmente |
| 4 | 🟡 | accept_invalid_certs sempre on | Deveria ser dev-only |
| 5 | 🟡 | Procedure com RECORD/COLLECTION | Teste 9.2 |
| 6 | 🟡 | SYS_REFCURSOR OUT mapping | Teste 9.3 |

## Comandos úteis durante teste

```sql
-- Ver módulos no schema
SELECT * FROM user_ords_modules;

-- Ver clients OAuth
SELECT name, client_id, client_secret, created_on FROM user_ords_clients;

-- Ver privileges
SELECT * FROM user_ords_privileges;
SELECT * FROM user_ords_privileges_roles;

-- Ver schema enable status
SELECT * FROM user_ords_schemas;

-- Limpar tudo (CUIDADO em prod):
BEGIN
  ORDS.DELETE_MODULE(p_module_name => 'test-mobile-api');
  COMMIT;
END;
```

```bash
# Logs do app (dev mode)
bun run tauri dev

# Console do browser (DevTools): Ctrl+Shift+I
```

## Após os testes

1. Marcar tasks resolvidas
2. Abrir issues separadas pra cada item ⏳/🟡 que se confirmar
3. Decidir prioridade: ir pra Windows installer (Fase C) OU corrigir os SHOULD-FIX antes
