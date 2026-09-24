# Active Learning Log

## 2026-09-19 — SSH gitdeploy bootstrap

Context: bootstrap de uma deploy key SSH dedicada para `menezesx2k26-byte/ops-gabriel-ops` no host Windows principal.

Falhas observadas e correções duráveis:

- PowerShell aninhado expandiu variáveis antes da hora e quebrou quoting. Correção: evitar `powershell -Command` dentro de um processo que já usa PowerShell.
- `ssh-keygen` do Windows retornou 255 ao receber passphrase vazia pelo wrapper. Correção: preferir o binário do Git for Windows nesse fluxo.
- Tentativa interativa de `ssh-keygen` recebeu EOF no wrapper remoto. Correção: não depender de stdin interativo para geração de chaves.
- Inicialização de shell encadeado falhou com `System.Net.ServicePointManager`. Correção: reduzir shells aninhados e usar o shell alvo diretamente.
- Caminho quoted `C:\Program Files\...` foi partido pelo wrapper `cmd`. Correção: usar o caminho 8.3 `C:\Progra~1\Git\usr\bin\ssh-keygen.exe`.
- `rg` não está no PATH deste host. Correção: usar `Get-ChildItem | Select-String` como fallback nativo.
- `ssh -T` do OpenSSH do Windows não é autoridade para Git neste host. O teste autoritativo é o fluxo real do Git: `git ls-remote` para leitura e `git push --dry-run` para escrita.

Resultado validado: chave ED25519 registrada como deploy key de escrita, leitura SSH funcionando e dry-run de criação de branch remoto retornando exit code 0.

## 2026-09-19 — functions.exec isolate scope

Context: ao aplicar a nova regra obrigatória de ingestão da memória, uma execução JavaScript tentou reutilizar a variável `ga` criada em uma chamada anterior de `functions.exec`.

Falha observada:
- `ReferenceError: ga is not defined`.

Causa:
- Cada chamada de `functions.exec` roda em um isolate novo; variáveis locais não persistem entre invocações.

Correção durável:
- Quando uma mutação depende de dados buscados por outra ferramenta, buscar os dados e executar as escritas dependentes dentro da mesma chamada de `functions.exec`, ou reconsultar explicitamente o estado necessário.
- Não assumir persistência de variáveis entre chamadas de Code Mode.

Resultado validado: a segunda tentativa buscou SHAs/conteúdo e aplicou as três atualizações no mesmo fluxo com sucesso.


## 2026-09-19 — PersistFlow Sandbox status audit authority

Context: auditoria remota do estado do `ops-persistflow-sandbox` na EC2.

Falhas observadas:
- Repeti o antipadrão já conhecido de PowerShell aninhado; o shell externo expandiu variáveis e quebrou a consulta.
- Rodei `npm run verify` sem fixar o diretório do repo; o comando executou no perfil do usuário.
- Considerei inicialmente o checkout local verde antes de validar a autoridade remota; o `origin` local era o fork pessoal e o PR canônico estava em `menezes-platform/ops-persistflow-sandbox`.
- `gh run list --workflow deploy-hostinger.yml` retornou 404 porque o workflow não existe no default branch.
- Criei um arquivo de learning paralelo antes de descobrir `docs/context/ACTIVE_LEARNING_LOG.md`, contrariando o princípio reuse-first.
- O primeiro push do log foi rejeitado porque `origin/main` avançou durante a auditoria.

Correções duráveis:
- Se `start_process` já usa PowerShell, não prefixar com outro `powershell -Command`.
- Fixar repo em toda operação: `git -C <repo>`, `npm --prefix <repo>` ou working directory explícito.
- Antes de usar resultados locais como evidência de release, verificar `git remote -v`, SHA do PR canônico e organização/repositório autoritativos.
- Para workflows presentes apenas em feature branches, consultar runs por branch/run ID em vez de resolver pelo filename no default branch.
- Antes de criar qualquer novo log/memória operacional, procurar estruturas existentes no repo.
- Antes de push em branch compartilhada, fazer fetch e rebase/inspecionar divergência; nunca force-push para reconciliar documentação.

Resultado: auditoria separou corretamente saúde local do fork de saúde do CI canônico e identificou o blocker real `EACCES /owned-work`.

## 2026-09-21 — Tailnet control-path outage during TTK G73

Context: continuation of `tiktok-live-dungeon-dod-20260914` generation G73 needed machine-local control of TTK-VM for serialized performance gates while GitHub Actions runners intentionally remained stopped.

Failures observed:
- Remote Desktop Commander MCP returned `UNAVAILABLE / Connection failed`.
- AKI_TikTok briefly exposed read-only repo state, then its task/control surface disappeared from the available tool set after connection loss.
- The ChatGPT runtime itself had no `tailscale` binary, no persisted Tailnet state/auth, and direct probes to `100.86.8.125` were not a valid Tailnet path.
- Opera Browser Connector was present but reported `Browser not connected`, so it could not inherit the user's host Tailnet.
- The existing Codespace burst-worker design was confirmed to persist authenticated Tailscale state at `/workspaces/.burst-worker-state`, but this chat had no executable terminal surface into that Codespace.

Corrections durable:
- For TTK timing-sensitive gates, do not restart repository self-hosted runners merely to regain control; that contaminates the quiescent-host condition the gate is intended to measure.
- Prefer, in order: existing Dev-Orquestra Local Executor / structured desktop surface, an already-authenticated AKI/LSM Tailnet surface, or the authenticated Codespace burst-worker. Do not invent a new tunnel before checking those lanes.
- Treat a chat/runtime that lacks Tailscale auth state as outside the Tailnet even if it knows MagicDNS names or 100.x addresses.
- If all authenticated Tailnet execution surfaces are absent, preserve the current candidate and stop before starting the next timing soak; resume only when one authenticated control path returns.

Result: no project mutation was performed and Task14 was deliberately not started, preserving serial soak validity.


## 2026-09-21 — Desktop recovery bridge invariant

Context: continuation G78 of `tiktok-live-dungeon-dod-20260914` needed to restore machine access while the timing-sensitive Task13 host remained intentionally quiescent.

Failure observed:
- The controller attempted to create a fresh generic Tailscale API/OAuth connection when recovering machine access.
- This was the wrong control path for this fleet: Desktop recovery is anchored on the existing MeshCentral bridge.

Durable correction:
- For this environment, Desktop recovery always starts through the existing MeshCentral console/fleet bridge; do not replace it with a new Tailscale API/OAuth connection.
- Preserve the existing MeshCentral/Tailnet topology and use already-authenticated recovery surfaces behind it.
- Do not restart the repository self-hosted runner merely to restore controller access during timing-sensitive gates.
- If an external browser cannot reach the tailnet-only MeshCentral endpoint, treat that as lack of Tailnet reachability in that browser, not as proof that MeshCentral itself is down.

Result: the incorrect Tailscale connection path was abandoned; the TTK candidate remained untouched and the quiescent-host condition was preserved.

- 2026-09-24 � Remote file writes do not create missing parent directories. Before writing a new module tree, create the directory explicitly; otherwise ENOENT aborts the first write. Observed while starting Drive/Fleet Task 1.

- 2026-09-24 � Keep persistent-service installation as a versioned artifact during implementation; do not combine installer-file creation with activation attempts in one remote tool call. Static installer tests are sufficient until an explicit rollout step.
