# PersistFlow OAuth 2.1 Design

## Purpose
Make the existing authenticated PersistFlow MCP connect directly from ChatGPT's custom plugin UI using OAuth, while preserving the current five MCP tools and R$0 incremental cost.

## Constraints
- Host everything inside the existing Hostinger Node app.
- Keep `/mcp` protected; never fall back to anonymous write access.
- Keep the existing high-entropy owner secret local; only its SHA-256 digest may be versioned/deployed.
- Preserve static Bearer support for diagnostics/local clients.
- OAuth tokens are opaque, random, short-lived, resource-bound, and persisted outside the deploy tree.
- Dynamic clients are public clients (`token_endpoint_auth_method=none`).

## OAuth topology
PersistFlow acts as both MCP Resource Server and OAuth Authorization Server.
It publishes RFC 9728 protected-resource metadata and RFC 8414 authorization-server metadata.
ChatGPT registers dynamically, authorizes with Authorization Code + PKCE S256, exchanges the code for access + rotating refresh tokens, then calls `/mcp` with the access token.
## Endpoints
- `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/mcp`
- `/.well-known/oauth-authorization-server`
- `/oauth/register` for RFC 7591 Dynamic Client Registration
- `/oauth/authorize` GET/POST for owner approval and PKCE authorization code issuance
- `/oauth/token` for `authorization_code` and `refresh_token` grants
- `/mcp` accepts either the existing static diagnostic Bearer token or a valid OAuth access token.

## Security invariants
- `/mcp` 401 responses include `WWW-Authenticate: Bearer resource_metadata="..."`.
- Authorization requests require exact registered redirect URI, `response_type=code`, PKCE `S256`, and `resource` equal to the canonical MCP URL.
- The owner approval form verifies the existing owner secret by SHA-256 digest; the secret is never stored server-side in cleartext.
- Authorization codes are one-time and expire after 5 minutes.
- Access tokens expire after 1 hour and are bound to the canonical MCP resource.
- Refresh tokens rotate on every use; reused/expired refresh tokens fail closed.
- Token/code/client state is persisted atomically under the existing PersistFlow durable data directory.
- Redirect URIs must be HTTPS except loopback localhost/127.0.0.1 development callbacks.

## Acceptance
ChatGPT must discover OAuth automatically from the existing `/mcp` URL, complete authorization, connect the plugin, list the five PersistFlow tools, and successfully execute a benign run inspection/start test through the connected plugin.