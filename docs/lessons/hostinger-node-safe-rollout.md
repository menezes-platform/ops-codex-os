# Safe rollout of a private projection in an existing Node service

Confirmed patterns from the Operação50/50 integration,2026-11-03.

- An active connector is not proof of account access. Verify the intended website, account and executable settings through authenticated reads. Do not diagnose an authentication failure as an exhausted CI quota.
- An archive filename in build history is not a recoverable backup. Confirm the archive still exists. Preserve a private, hash-verified source/config copy and a reconstructible rollback package before cutover. Compare exact bytes; explain verified CRLF differences rather than discarding arbitrary whitespace.
- The document root is not the Node build root. Preserve OAuth and authority data outside deployment-managed directories. A bounded maintenance helper must authenticate before reads, accept no request-controlled paths or commands, remove its entry, return safe metadata only and keep private copies private. Record original file modes for restoration.
- Validate existing path ancestors, including symlinks, before writing private projections. A harmless-looking alias can resolve into public_html. Bootstrap must respect a validated rollback pointer rather than silently reinstalling the newest retained seed on every restart.
- Test capabilities rather than assuming shared-hosting filesystem features. A lock plus verified temporary file and atomic rename can avoid a hardlink dependency. Preserve the existing generation on failure. An opaque409 does not prove which filesystem capability failed.
- Match the log consumer's contract. Hostinger's runtime-log API parses JSON entries with timestamp, level and message; a valid JSON receipt without that envelope can be omitted. Test the assembled entry and its actual consumed log shape.
- Test first installation with only a staged seed, as well as restart with a preinstalled pointer. An entry test that preinstalls the projection can miss a broken seed path. Derive the seed from the existing authority directory rather than assuming the process home is the deployment's durable account home.
- Do not assume dot filenames or an uploaded .htaccess deny rule protect an archive. A protected empty file is insufficient evidence: use a non-sensitive, nonempty archive. Publish verified0600 files by same-device atomic rename, test HTTP denial, and confirm the build API can read them. Validate or repair permissions even on an idempotent noop. Keep personal content and indexes outside all web deployment archives.
- A startup retrieval receipt proves startup retrieval. It does not prove a positive authenticated request to a new HTTP/MCP route, refresh a client's cached tool catalog, or establish a scheduler/takeover. Keep these acceptance gates separate and report the remaining gap.

Reusable wiring is optional contextProvider in PersistFlow. Project-specific namespace, index, queries and evidence remain in the project's private repository. No paid fallback is necessary for this pattern.


## Redefinição da aprovação do proprietário

Verificar a fonte efetiva de autorização em runtime. Arquivo de ambiente alterado e pedido de reinício aceito não comprovam adoção pelo listener. Quando a API mascara valores e substitui o conjunto inteiro, não reenviar máscaras nem presumir que uma cópia de disco prova todos os valores ativos.

PersistFlow já separa ownerTokenDigest da credencial Bearer de serviço. Preferir esse contrato para redefinir somente a aprovação OAuth: verificador privado fora do build, ausência com compatibilidade explícita e arquivo presente inválido/symlink com falha fechada. Manter o segredo bruto em armazenamento privado0700/0600 separado das exportações de estado. Nunca incluir o segredo em pacotes web, Git, documentos, logs ou mensagens.

Testar aprovação nova/antiga, revogação dos grants e preservação da credencial de serviço. Validar build ativo, fingerprint OAuth do proprietário resolvido e comportamento do cliente. O fingerprint demonstra sincronização de startup; a autenticação positiva do proprietário continua sendo um aceite separado. Não restaurar snapshots OAuth antigos automaticamente. A operação de redefinição de aprovação não equivale à rotação do Bearer de serviço.


A raiz mostrada pelo Gerenciador de Arquivos pode ser a área do site, mesmo que o servidor use um home de conta mais amplo. Confirmar o alcance observado antes de indicar um caminho de credencial. Se uma entrega privada estiver autorizada, uma cópia temporária pode ficar em diretório0700/arquivo0600 irmão de public_html, fora de builds e exportações, após conferir que a chave corresponde ao verificador ativo. Verificar ausência de acesso público, preservar o original, nunca retornar o valor por ferramenta e retirar a cópia após confirmação de guarda pelo proprietário.
