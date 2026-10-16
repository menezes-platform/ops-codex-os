# Google Drive v3 object transport (experimental source)

**Status:** source + deterministic fake-HTTP tests only. No authenticated write/read against the owner's Drive, no production authority migration.

## Purpose

`modules/context-store/src/google-drive-object-transport.js` implements a direct Google Drive v3 REST transport for the existing `createDrivePersonalStore({transport})` contract. Unlike the existing Map/filesystem fakes, requests target Google's documented files.list, files.create multipart, and files.get alt=media endpoints. No Engram component or paid service is required by this adapter.

The host must supply a trusted, refreshable `getAccessToken` callback and an existing, private `folderId` **opened/created with that OAuth client**. The ChatGPT Google Drive connector's authorization cannot be silently borrowed for this Node process. The application must explicitly establish its own least-privilege Drive authorization; choose a folder that the app can access with a suitable Drive OAuth scope. Do not commit OAuth credentials; inject via host's protected secret handling and never pass them through model prompts. No automatic OAuth flow or token persistence is supplied by this module.

Example of composition (not a live credential bootstrap):

```js
const {createGoogleDriveObjectTransport} =
  require('./modules/context-store/src/google-drive-object-transport');
const {createDrivePersonalStore} =
  require('./modules/context-store/src/drive-personal-store');
const transport=createGoogleDriveObjectTransport({
  folderId: verifiedPrivateFolderId,
  getAccessToken: trustedOAuthClient.getAccessToken.bind(trustedOAuthClient)
});
const personalStore=createDrivePersonalStore({transport});
```

A single configured private Drive folder holds flat binary blobs named `ragv1-<sha256(logical-key)>`, not private text. The logical key is stored in the OAuth-client-private `appProperties.rag_key`; it remains metadata and is not encrypted. The scope is restricted to `personal/current/events/<64hex>.json` and `personal/current/receipts/<64hex>.json`. Project scopes cannot use this instance. The adapter enforces a 16 MiB object limit, bounded folder scans, validates metadata, confirms uploads with a fresh read, and never includes sensitive content or tokens in thrown errors.

**Known provider limitation:** Drive does not enforce unique filenames or atomic compare-and-swap on create. A competing writer may create a duplicate key. This adapter fails closed on duplicates instead of selecting a random version, but it is **not a multiwriter CAS solution**. Before production, complete race fault-injection and a reliable single-writer/locking publication design, plus Drive authorization, least-privilege permission review, full change-cursor implementation, backups, restore, freshness, index rebuild and rollback. Upload readback does not by itself prove later durability or privacy.

**Privacy:** Google Drive's storage encryption is not the same as app-managed client-side encryption. Do not upload real private episodes until the encryption, owner consent, sharing configuration and disaster-recovery gates are independently reviewed. Test fixtures in the suite are synthetic. No Drive file was created by the source-only tests. Engram remains operationally unchanged pending the separate authority gate.

Official protocol references (checked 2026-10-15):
- https://developers.google.com/workspace/drive/api/reference/rest/v3/files/create
- https://developers.google.com/workspace/drive/api/guides/manage-uploads
- https://developers.google.com/workspace/drive/api/guides/properties
