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

## 2026-09-19 — Codex thin-controller / quota burn

Context: a thread root de orquestração do TikTok LIVE Dungeon chegou a 98% da janela de 5h porque cada `wait_agent` reabria dezenas/centenas de milhares de tokens de contexto, mesmo com a maior parte cacheada.

Falhas observadas e correções duráveis:

- O detector inicial de `runId` falhou em argumentos de tool call com JSON escapado. Correção: varredura recursiva dos payloads e normalização de aspas escapadas.
- Uma cauda fixa de 2 MiB do JSONL podia perder telemetria quando havia registros gigantes posteriores. Correção: leitura adaptativa 2→4→8… MiB, até achar uso + rate-limit, com teto de 32 MiB.
- O último `token_count` pode conter uso de tokens e omitir `rate_limits`. Correção: combinar o último registro de uso com o último registro anterior que ainda tenha rate-limit válido.
- Um filtro de processo baseado apenas em `CommandLine` matou o próprio PowerShell, porque o texto do comando continha o nome do supervisor. Correção: exigir `Name == node.exe` e assinatura do supervisor.
- O wrapper usado para gravar scripts que continham backticks de PowerShell gerou erro de parsing antes da escrita. Correção: evitar template literals aninhados e usar `Environment.NewLine`.
- `codex archive <thread>` recusou a sessão ainda carregada no app. Correção: não tocar em SQLite/rollout manualmente; manter a sessão como predecessor inerte e usar o protocolo suportado quando a superfície do app-server estiver disponível.
- O `hooks.json` local continha seis referências a `~/.agents/hooks/run.py`, arquivo inexistente. Correção: remover somente entradas comprovadamente quebradas e restaurar bridges diretos do Token Optimizer.

Guardrail permanente:
- Pais gerenciados não podem usar `wait_agent`; `PreToolUse` nega a chamada.
- `SubagentStop` externaliza o retorno completo em evento durável e envia ao pai apenas um ponteiro pequeno.
- Rollover preventivo usa Git + Persistflow/eventos, nunca replay do transcript predecessor.
- Supervisor só lança sucessor de runs duráveis e, em EMERGENCY, espera o reset da cota antes de iniciar nova sessão.

Complemento de validação:
- O lockfile declarava `@modelcontextprotocol/client` como devDependency, mas `package.json` não; `npm ci` deixou três testes MCP sem o cliente. Correção: alinhar o manifesto à versão já pinada no lock, sem introduzir versão nova.
- O teste de startup do Hostinger falhou uma vez dentro da suíte por não responder no orçamento de ~1s, mas passou duas vezes isolado (~350–450 ms). Correção operacional: repetir o teste isolado antes de atribuir esse timing flake ao código alterado.
