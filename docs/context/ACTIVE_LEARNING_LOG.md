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
