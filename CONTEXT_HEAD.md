# Context HEAD — Menezes

**Versão:** 0.1 · **Status:** SOURCE_ONLY / contrato de pré-consulta dos agentes, não hook nativo do ChatGPT.

## Propósito
Antes de responder ou executar trabalho substantivo sobre projetos, servidores, repositórios, arquivos, decisões, tarefas e contextos anteriores do usuário, fazer recuperação seletiva nas fontes conectadas. Este HEAD é uma camada mínima de roteamento **sobre a infraestrutura existente**, não um novo RAG, banco de dados, índice ou orquestrador. Deve funcionar com **Windows desligado**.

## Acionamento
- Acionar no início de solicitações técnicas próprias, status/migrações, continuidade de trabalho, referências a conversas passadas, planejamento com restrições anteriores, arquivos nomeados ou infraestrutura pessoal.
- Não acionar para conversa casual ou conhecimento público genérico; para fatos públicos atuais, consultar web quando necessário.
- Carregar apenas o menor contexto que altera a resposta. Nunca fazer varredura indiscriminada ou expor corpora privados.

## Roteamento e autoridade

| Necessidade | Fonte preferencial | Regra |
| --- | --- | --- |
| Estado de código e produto | **Git** (repo, branch, PR, issue, CI, SHA) + runtime quando pertinente | Source não é prova de deployment |
| Preferências e contexto duráveis | **Memory** privada, menor arquivo relevante | Confirmar privacidade antes de gravar |
| Episódios e hipóteses de recuperação | **Engram** por busca limitada | Candidato episódico, não autoridade de produção |
| Trabalho em andamento | **PersistFlow** com RUN_ID, geração, checkpoint e próxima ação | Autoridade de continuidade |
| SPECs, anexos, handoffs e corpus | **Drive** sgtmenezes, revisão identificada | Preservar status de proposta, aprovação e evidência |
| Recuperação indexada | **Context Gateway** autenticado no namespace autorizado | BM25 + FAISS são derivados; consultar fonte primária para decisão |

## HEAD preflight obrigatório ao agente

1. Determinar o **scope do project** com identidade exata de repo/workspace ou escopo multiprojeto permitido explicitamente. Não inventar tenant/namespace; nenhum recall genérico de índice privado.
2. Recuperar Git/CI/runtime do trabalho atual e as PRs/branches não padrão relevantes. Confrontar o que aconteceu depois do último handoff.
3. Consultar Memory, Engram, Drive e PersistFlow **somente quando a categoria materialmente influencia a resposta**; consultar Context Gateway quando conectado, autenticado e no escopo.
4. Classificar provas: OBSERVED_REMOTE, OBSERVED_LOCAL, REPORTED_LOCAL, HISTORICAL, NOT_VERIFIED. Resolver divergências por data, fonte e autoridade; não misturar código implementado com integração live.
5. Responder ou agir com base no estado observado. Em indisponibilidade, marcar `source unavailable` / `retrieval_unavailable`; retornar à consulta direta na mesma autoridade, sem preencher lacunas por suposição.
6. Depois de mudança durável, executar o gate seletivo: Memory (pessoal), Git do projeto (estado), Agent OS (regras globais), Engram (episódios), Drive (handoffs) e PersistFlow (continuidade).

## Isolamento, orçamento, contingência
- O `context_recall` descrito na PR #66 do PersistFlow/Hostinger é do namespace da **Operação 50/50**, não um índice global; bloquear ampliação para Miranda, Punctum ou outros projetos. Retornar `namespace_denied` sem conteúdo quando houver divergência.
- Conexão sem autenticação, índice indisponível ou contexto antigo nunca autoriza acesso a outros namespaces. Falha de RAG não é falha de Git/Drive.
- O estado atual dos snapshots FTS5/BM25 offline e do candidato BM25 + FAISS não prova publicação automática em produção.
- Zero novos gastos: **R$ 0** incremental, sem jobs pagos antes da prova de bloqueio de excedente.
- Nenhum token, segredo, dado íntimo ou conteúdo privado é persistido neste HEAD público. O PC Windows não é dependência essencial.

## Limitação do produto
**ChatGPT nativo não garante invocar este HEAD automaticamente** apenas porque o arquivo e a skill existem no GitHub. Agentes que carregarem as regras conseguem aplicar o preflight, e o ChatGPT pode consultar suas ferramentas conectadas quando o contexto for relevante. Um gatilho universal entre novas conversas exige uma integração autenticada de runtime que realmente invoque a ferramenta de recuperação; isso ainda requer teste E2E, não alegação de completude.
