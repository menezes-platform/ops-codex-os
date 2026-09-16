# PersistFlow OAuth 2.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ChatGPT connect to the existing PersistFlow MCP using self-hosted OAuth 2.1 with PKCE, DCR, refresh tokens, and RFC 9728 discovery.

**Architecture:** Add a focused OAuth store/service under `persistd/src/persistflow/`, wire discovery/authorize/token/register routes into the existing HTTP server, and let the MCP bearer verifier accept resource-bound OAuth access tokens in addition to the existing static diagnostic token.

**Tech Stack:** Node.js 22, built-in `crypto/http/fs`, existing MCP SDK v2, `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-16-persistflow-oauth-design.md`

## Global Constraints
- Existing five MCP tools and REST API behavior remain unchanged.
- OAuth write access is never anonymous.
- PKCE supports only S256.
- OAuth state survives process restart/redeploy using the durable PersistFlow data directory.
- No paid dependency or external identity provider.

---

### Task 1: OAuth durable state and primitives
**Files:** create `persistd/src/persistflow/oauth-store.js`; test `persistd/oauth-store.test.js`.
**Produces:** `FileOAuthStore`, token hashing, client registration, one-time code consume, access validation, rotating refresh consume.
- [ ] Write failing tests for persistence, expiry, one-time authorization codes, resource binding, and refresh rotation.
- [ ] Run focused tests and confirm RED.
- [ ] Implement atomic JSON persistence with SHA-256 token/code hashes.
- [ ] Run focused tests and confirm GREEN.
- [ ] Commit.
### Task 2: Discovery and Dynamic Client Registration
**Files:** create `persistd/src/persistflow/oauth-server.js`; modify `persistd/src/persistflow/http-server.js`; test `persistd/oauth-http.test.js`.
**Consumes:** `FileOAuthStore`.
**Produces:** protected-resource metadata, authorization-server metadata, and `/oauth/register`.
- [ ] Write failing HTTP tests for both well-known metadata paths and DCR.
- [ ] Verify metadata advertises `/oauth/authorize`, `/oauth/token`, `/oauth/register`, PKCE S256, and the canonical `/mcp` resource.
- [ ] Implement exact redirect URI validation and public-client registration.
- [ ] Run focused tests and confirm GREEN.
- [ ] Commit.

### Task 3: Authorization Code + PKCE owner approval
**Files:** modify `oauth-server.js`; test `oauth-http.test.js`.
**Produces:** GET/POST `/oauth/authorize` and one-time authorization codes.
- [ ] Write RED tests for invalid client/redirect/resource/PKCE and owner-secret rejection.
- [ ] Add a minimal HTML owner authorization page.
- [ ] Verify the owner secret only by SHA-256 digest and issue a 5-minute one-time code.
- [ ] Verify successful approval redirects to the exact registered URI with `code` and original `state`.
- [ ] Commit.

### Task 4: Token exchange, refresh, and MCP bearer validation
**Files:** modify `oauth-server.js`, `mcp-handler.js`, `http-server.js`; test `oauth-http.test.js` and `mcp-http.test.js`.
**Produces:** `/oauth/token`, 1-hour access tokens, rotating refresh tokens, OAuth-aware `/mcp`.
- [ ] Write RED tests for PKCE exchange, wrong verifier, resource mismatch, expiration, refresh rotation, and 401 metadata header.
- [ ] Implement authorization-code and refresh-token grants.
- [ ] Add async OAuth bearer validation to the MCP handler while preserving static diagnostic bearer support.
- [ ] Run focused tests and full suites.
- [ ] Commit.
### Task 5: Production deploy and ChatGPT connection
**Files:** modify production docs only if needed; no secret files added.
- [ ] Run `npm test` at repo root and in `persistd/`, plus `git diff --check`.
- [ ] Commit/push `main` and wait for Hostinger deployment.
- [ ] Verify public metadata, DCR, authorization redirect, token exchange, refresh, and authenticated MCP with a local test client.
- [ ] In the already-open ChatGPT plugin dialog, keep server URL `/mcp`, choose OAuth, create/connect, complete the owner approval page, and return to ChatGPT.
- [ ] Confirm ChatGPT lists the five PersistFlow tools and perform one benign live tool call.

## Self-review
- Spec coverage: discovery, DCR, PKCE S256, resource indicators, owner approval, access expiry, refresh rotation, persistence, 401 metadata, and final ChatGPT connection are each mapped to a task.
- Placeholder scan: no TBD/TODO/unspecified implementation steps remain.
- Interface consistency: `FileOAuthStore` is consumed by the OAuth server; the OAuth server exposes bearer validation to the existing MCP handler; the canonical resource is the public `/mcp` URL throughout.