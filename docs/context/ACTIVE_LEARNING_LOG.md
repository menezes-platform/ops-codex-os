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