# Gabriel Fleet Runner — Windows (Pareamento Automático)

`GabrielFleetRunnerSetup.exe` é um instalador único que contém o código do runner. Requer **Node.js 22–24** instalado no computador. O agente funciona em segundo plano, invisível, com tarefa agendada no login.

## Como adicionar uma máquina nova

1. O proprietário cria um convite de uso único na autoridade PersistFlow. No PC autorizado onde possui o token de proprietário do PersistFlow, execute `powershell -File scripts\issue-fleet-pairing.ps1`. O código vence em **10 minutos**, nunca fica gravado em texto aberto no servidor e não pode ser reutilizado. Pode-se criar uma interface administrativa sobre esse mesmo endpoint.
2. Na máquina que será runner, abra `GabrielFleetRunnerSetup.exe`. Ele detecta Node, define `node-<hostname>`, gera uma chave HMAC aleatória exclusiva, coloca os arquivos em `%LOCALAPPDATA%\GabrielFleetRunner` e cria uma tarefa Windows sem janela visível. Quando solicitado, cole o código de pareamento.
3. O próprio instalador envia o cadastro à autoridade por HTTPS usando o convite; a Hostinger persiste identificação e HMAC num diretório fora do deploy, e adiciona o nó ao Fleet como **`drained:true`**. Não é necessário editar `fleet.json` nem duplicar variáveis no hPanel por novo computador.
4. Para conferir, execute `powershell -File "%LOCALAPPDATA%\GabrielFleetRunner\maintenance\Status-FleetRunner.ps1" -CheckOnline` — deve mostrar `FLEET_HEARTBEAT_ACCEPTED` após cadastro. O nó continua **sem despacho automático** enquanto faltarem homologações do Drive e execução.

Caso não tenha convite no momento, pressione Enter, conclua a instalação e pareie depois com `powershell -File "%LOCALAPPDATA%\GabrielFleetRunner\maintenance\Pair-FleetRunner.ps1"`. O convite não é uma credencial permanente: a chave do nó é preservada em arquivo de usuário com ACL restrita.

**Requisitos do servidor:** aplicar a versão do PersistFlow com `PairingRegistry` em produção e reiniciar. `POST /v1/fleet/pairing-invitations` exige autenticação administrativa do proprietário; `POST /v1/fleet/enroll` exige um convite forte (192 bits), não repetível e válido por 10 minutos. O servidor persiste os nós em `PERSISTFLOW_DATA_DIR/fleet-enrollment/pairing.json`; mantenha esse diretório em volume durável e com backup privado. Todos os nós inscritos permanecem drenados mesmo após reiniciar. Nunca publique token administrativo, segredo de nó ou convite no repositório ou chat.

**Drive-first:** GitHub é a autoridade do código e Google Drive é o destino definitivo de relatórios e artefatos. O runner permite espaço temporário de trabalho; nenhum job novo inicia sem token efêmero válido do Drive e nenhuma saída é apagada antes de confirmação SHA-256 + manifesto do Drive. A configuração OAuth da Hostinger é separada deste cadastro. Sem ela, o nó pode conectar heartbeat, mas não executar jobs.

## Gerenciar e reverter

`powershell -File "%LOCALAPPDATA%\GabrielFleetRunner\maintenance\Uninstall-FleetRunner.ps1"` desativa/remove a tarefa de heartbeat e mantém dados e segredo para reativação futura. Reinstalar o mesmo nó preserva sua identidade. Instalação com `-SkipTask` só copia arquivos para testes. Instalação com `-SkipPairing` mantém a tarefa mas não pede convite. A instalação abre uma janela temporária apenas para o próprio assistente; os jobs e heartbeats são invisíveis.

**Build reproduzível:** `powershell -ExecutionPolicy Bypass -File scripts\build-windows-fleet-runner.ps1`. Artefatos: `dist\fleet-runner-windows\GabrielFleetRunnerSetup.exe`, `dist\GabrielFleetRunner-Windows.zip` e SHA-256. Binário não assinado digitalmente; o SmartScreen poderá pedir confirmação. A instalação não requer serviços pagos nem permissões de administrador de máquina quando o agendador permitir tarefas do usuário.