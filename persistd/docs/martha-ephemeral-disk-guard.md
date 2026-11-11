# Martha — runners efêmeros com reserva de disco (2026-10-28)

## Objetivo e autoridade

Reaproveitar o CLI Drive-first em persistd/src/fleet/silent-job-cli.js, sem alterar o daemon ativo, a autenticação existente ou o drained:true do nó conthabil-martha. Git é a fonte para código; Google Drive Object Store é canônico apenas após confirmação de cada blob/manifest e do job-index. PersistFlow governa runs/checkpoints.

## Proteções nesta branch

- Job com workspace e diretório de logs individuais sob ConthabilFleet/jobs. Launcher existente roda oculto sem PowerShell visível.
- Preflight antes de criar logs ou iniciar trabalho: reserva 30 GiB livres no volume de trabalho (padrão), e recusa workspace já acima da cota.
- Cota padrão de workspace 64 MiB, máximo parametrizável 128 MiB. Verificação periódica de 250 ms e interrupção do processo principal se exceder. A falha gera receipt e arquivos são mantidos para upload.
- Variáveis TEMP, TMP, TMPDIR, XDG_CACHE_HOME e NPM_CONFIG_CACHE do filho apontam para .tmp interno ao workspace.
- Nova verificação do workspace após término do processo, mesmo se finalizar entre amostras.
- Mantidos limites existentes de stdout+stderr, tempo e validação de até 256 MiB na etapa de arquivamento.
- Nenhum dado local é removido sem confirmação de todos os objetos e do índice remoto. Upload pendente preserva workspace, logs e receipt para recuperação idempotente.

Limitação: monitoramento não é quota física, ACL, isolamento de processo ou sandbox. Código não confiável pode escrever fora do workspace ou criar processos filhos. Só executar comandos previamente autorizados e confiáveis até ser implementado isolamento real com Windows Job Objects/ACLs/AppContainer/VM. Não declarar garantia absoluta. G: é Google Drive virtual, não scratch seguro; H: tem ~13,9 GiB livres e não foi selecionado.

## Homologação

- RED→GREEN: quatro testes de regressão falharam antes do código e passaram depois.
- Testes focados Fleet/Drive: 29/29 PASS.
- Suite completa npm test: 69/69 PASS após instalação de dependências somente na worktree no D: do PICHAU.
- No host MARTHA a tentativa de preflight productionStore retornou DRIVE_TOKEN_HTTP_503 em 2026-10-28. Nenhum job foi iniciado, nenhum arquivo prévio removido e o nó continua drained:true. Não existe prova E2E de upload real desta versão.
- A conexão do Google Drive na interface ChatGPT não transfere OAuth para o serviço PersistFlow/Hostinger.

## Gatilhos para disponibilizar em produção

1. Corrigir DRIVE_TOKEN_HTTP_503 na autoridade sem copiar refresh token para runner.
2. Comprovar put/get, SHA-256, arquivo blob + manifest e job-index duráveis.
3. Executar job sintético descartável com launcher oculto; confirmar stdout/stderr/receipt/índice no Drive.
4. Testar Drive offline com retenção local e retry sem reexecução; limpeza apenas do job após upload.
5. Instalar o mesmo SHA na Martha com rollback e registrar evidência.
6. Revisar e aprovar undrain na issue #50 após limites de concorrência e reserva de disco.
