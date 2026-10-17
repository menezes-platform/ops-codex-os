# Compatibility Shim Registry

This registry tracks only temporary migration shims. It is not an authority for platform state or interface ownership; producer schemas remain beside their producer modules and the Spec Kit remains architecturally authoritative.

## Current registry

No migration shim has been introduced by P00-P02. Incumbent PersistFlow/MCP, worker, provider/cache, and Gabriel Ops routes remain unchanged while producer-owned v1 contracts are added. Existing legacy implementations are tracked as migration debt in phase checkpoints, not recorded as new shims.

Every future shim must be registered before its code is merged with:

- `id`;
- `owner`;
- `purpose`;
- `allowed callers`;
- `introduced phase`;
- objective `removal condition`;
- `latest removal phase`.

An unregistered shim is a failed architecture gate. A shim whose removal condition passes must be deleted in that phase.
