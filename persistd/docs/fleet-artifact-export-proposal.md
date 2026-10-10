# Proposed scoped evidence export — not implemented or enabled

Purpose: retrieve explicitly approved offline engineering reports and DEX evidence for the YouCine 1.17.5 laboratory on desktop-primary. This proposal provides no new command, capability, API endpoint, transfer runtime or activation. A separate human authorization must approve the exact source package/hash, export profile, file hashes, destination, retention and size budget before implementation or use.

## Minimal reuse and boundary

Reuse the existing Fleet owner/node authentication, run/generation/operation correlation and durable checkpoints. Reuse `storage/object-store.js` hashFile/parseObjectRef/metadata validation and its content-addressed object/manifest model, behind a scoped adapter. The existing Drive adapter is a candidate only after readback SHA-256 and destination consent are verified; its metadata/MD5 checks alone do not prove transferred bytes match SHA-256. Do not add a second run authority or a generic file server.

The operator authorizes a fixed profile, not shell text or an arbitrary path. The worker maps artifact IDs to private reviewed paths. Initial export profiles may permit UTF-8 `.json`, `.txt` and `.md` reports; `.dex` requires explicit additional content approval. APKs, archives, caches, browser profiles, `.env`, DPAPI files, cookies, keys and token stores are denied. No YouCine endpoints, VIP subscription flows, credentials, payment requests or service interactions are used: source inspection is offline only.

## File and byte constraints

- One exact private export root per profile, outside repositories, credential stores and mutable tool caches. Configuration lists exact relative paths/types (for example `reports/analysis.json`, `reports/findings.md`, separately approved `dex/classes.dex`); no caller-supplied filesystem path or recursive glob.
- Resolve every component and reject traversal, absolute/UNC/device paths, symlinks, Windows reparse points, junctions and hard links. Stage reviewed files into a protected immutable snapshot before hashing/upload. Compare file identity/size before and after reading the same open file handle; reject any mutation. Windows requires explicit file-ID/reparse checks rather than assuming O_NOFOLLOW covers it.
- Suggested configurable starting caps: reports 8 MiB each, separately authorized DEX 64 MiB each, 128 MiB total, at most 16 files. Receiver enforces actual streamed byte counts independently of Content-Length. Values are proposals, not configured limits. Disk/scratch checks retain max(50 GiB,10%) on the worker, and must independently verify Authority storage capacity.
- Reject oversized/type-mismatched files before authorization, and stop an upload as soon as its actual cap is exceeded. No automatic archive expansion, archive upload, dynamic discovery of more files or paid fallback.

## Provenance and authorization

An immutable manifest contains schema version, nodeId, runId, generation, operationId, reviewed export-profile ID/version/hash, source APK SHA-256 and asserted application version, extraction tool name/version/hash, fixed commandId, timestamps, exact approved artifact IDs/relative paths, MIME/type, size and SHA-256, and the approving authorization ID. Preserve tool/source evidence; a user-supplied version label is not independent proof of the APK version.

The owner approves the manifest hashes and destination. The Authority issues a short-lived, single-use-per-artifact upload authorization bound to the desktop node, operation/generation, manifest hash, artifact SHA-256/size/type and destination. Authorization/consumption lives in the existing durable run record. Authenticated node HMAC signs a canonical metadata envelope (including byte hash, declared size and authorization nonce); receiver then hashes the raw streamed bytes. Do not reuse the existing string-body HMAC format naively for binary DEX. HTTPS, no redirects, bounded transfer/supervision time, node matching and authenticated status-bound acknowledgments remain required.

Only the same approved artifact/hash may be retried after a lost acknowledgment; repeat authorization consumption reconciles the already verified object instead of granting arbitrary new uploads. An expired or altered manifest, wrong node/generation, unknown artifact ID, unapproved hash/type or conflicting retry fails closed. An opaque upload authorization is a credential and must never be written into the manifest, logs or exported files.

## Secret exclusion

Reports use an allowlisted schema excluding authorization headers, URLs with credentials/query tokens, cookies, session IDs, access/refresh tokens and private key material. Run local known-secret and token-pattern checks before approval; receiver repeats checks. Unknown sensitive material cannot be excluded by regex alone. Suspected files are rejected for manual review, not silently uploaded or described as proven secret-free.

DEX evidence needs a reviewed offline string-table/content inspection and explicit approval of the exact file hash. Never redact DEX bytes after computing the approved hash: create a separately reviewed sanitized derivative with its own hash/provenance, or exclude the file. Source application embedded credentials are still sensitive. No real provider/owner/node credentials may enter fixtures or evidence.

## Receive, integrity and durable completion

1. Receive only an authorized artifact into a private bounded staging file outside the deploy/public tree; stream SHA-256 and enforce byte/type budgets.
2. Require measured length and SHA-256 to equal the approved manifest. Flush the file; atomically promote it into a private content-addressed location such as `sha256/<hash-prefix>/<hash>`, with directory sync where supported. Existing content must be revalidated; a filename/hash label is not integrity proof.
3. Save the sanitized manifest separately by its own hash and record object/manifest refs in the existing run checkpoint. File/object readback recomputes SHA-256 before any completed ACK. A Drive-backed adapter must provide equivalent readback verification; otherwise its gate remains closed.
4. A signed acknowledgment binds operation, manifest hash, object hash and measured length, and is emitted only after integrity verification and checkpoint persistence. Lost ACK/restart rechecks the same object. Partial/uncertain transfers remain incomplete; never mark upload complete from HTTP transport success alone.
5. Retention/deletion is a separately approved lifecycle; rollback preserves verified objects/manifests, unfinished authorization records and receipts. No current queues, receipts or backups are deleted.

Future tests must cover traversal/reparse/hard-link rejection, changing files, size/type/magic mismatch, known and unknown suspected secrets, node/generation/nonce replay conflicts, tampered upload/ACK, lost ACK, interrupted staging/promotion/checkpoint, restart and SHA-256 readback through the chosen durable adapter. Authorization, consent, destination durability and those tests are release gates. None of this transfer operation is enabled by PR #33.
