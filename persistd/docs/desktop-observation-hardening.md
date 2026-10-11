# DESKTOP-OBSERVATION-001 — hardening continuation, 2026-10-11

Plan: reconcile PR35/33 and PR29/20, generation/checkpoint and hosted runtime; independently review security and reproduce findings before fixes; run focused regressions then one integration pass; update the existing PRs; publish only after storage/writer/backup/rollback gates are proven. Preserve the existing runtime and recovery configuration until those gates pass.

Reconciled starting commits: Authority 51b3c95e63b4ac3cf9ffb1c5281481d159345a31; Host c81324aa3d43e665ea0e702205309202bc9fd81d. Bases remain 50c609c63d889f01a0b93bdeb7c077f6a68c273a and 2ae56e18d5691eacfdc59343f06df64561686b9a. All four PRs open, observation PRs and PR33 draft. PersistFlow run gabriel-desktop-observation-20261011 remains generation 1. Drive handoff readback SHA256 93d11dc02a227d8bad61708aa5b58ce69b4097647f12fa433c05fe90095dfd93.

## Recovery boundary verified by provider API

Latest completed build remains 01a1094e-4561-7179-a9e5-e00378da3390, ZIP persistflow-rfc9207-20260929.zip, no commit. Auto-deploy remains enabled for the separate inaccessible menezesx2k26/persistflow-gabriel-mcp-hostinger/main. No settings were changed.

Official files API `/api/hosting/v1/accounts/u775492464/domains/darkslategrey-raccoon-448222.hostingersite.com/files` returned only `.htaccess` (575 bytes). Reading that file established PassengerAppRoot `/home/u775492464/domains/darkslategrey-raccoon-448222.hostingersite.com/hbuilds/current/nodejs`, Node24 and startup `src/hostinger-entry.js`. Thus public_html is a routing root, not the runtime/source artifact. The API is explicitly document-root scoped; no traversal or alternate-service SSH is attempted.

Effective private data path, runtime process count, writer exclusivity, restart durability and old artifact bytes/digest still require authenticated administration for this hosting. API configuration/build listings do not establish those facts. No backup of production has been claimed. No restart/deploy/merge/agent configuration mutation has occurred.

Sources: [files API](https://docs.hostinger.com/api-reference/endpoints/hosting/files/list-website-files-and-directories), [file content](https://docs.hostinger.com/api-reference/endpoints/hosting/files/get-website-file-content), [hosting SSH](https://docs.hostinger.com/websites/ftp-ssh), [backups](https://docs.hostinger.com/websites/backups). A provider backup must be downloaded and tested in isolation; its existence alone cannot prove cross-file consistency or rollback compatibility.

## Reproduced regressions under correction

- A claimed report was accepted after heartbeat eligibility expired. Recheck eligibility before releasing content.
- A status response could identify a hostname other than the configured node. Enforce exact host binding.
- Fake 45-byte PNG passed header checks. Validate chunks/CRC, ordering, supported canonical 8-bit non-interlaced formats, exact bounded decompression and scanline filters using existing Node zlib primitives.
- Extra fields in image sourceBounds bypassed the typed result boundary. Reject them.
- Independent review reproduced relabeling a generation-1 claim as generation 2 after promotion. Require stored generation to equal report generation.
- A new claim accepted a capture predating the request. Enforce request-time freshness with explicit two-second clock tolerance, plus future-time rejection.
- Windows optional argument types could fall back to capture defaults or throw an untyped exception. Reject provided invalid types before dispatch.

Independent review also reproduced a directory replacement race in canonical DesktopFilesService.List against synthetic directories: 8 outside-scope listings in a bounded run. Corrected by pinning every ancestor top-down with Windows handles that deny delete sharing, rejecting reparse points and validating final paths. Metadata now comes from validated child handles. A deterministic OS regression proved attribute-only handles insufficient; READ_DATA/LIST_DIRECTORY plus attributes is required. The final regression blocks both Desktop and parent rename during a lease and permits rename after disposal. Hidden/system/encrypted stat data is rejected.

Focused regressions demonstrated failures before correction. Final full verification: PersistFlow 298 tests, 297 pass and one opt-in skip; separate real-session MCP 4/4, Windows 64/64, root 23/23, executor security 8/8, Computer Control 75/75, Spec Kit and git diff checks pass. No existing assertions were weakened. Real local MCP capture 2026-10-11T03:17:41.384267+00:00, evidence 97cb24d6e05f4f0b82cccdd39306daa9, PNG 1600x900, 432238 bytes, actual Desktop listing and UIA succeeded. Metadata only retained. This is not hosted-MCP evidence.

Independent review found the generation and directory-race issues and confirmed image weaknesses. Its final turn was interrupted by a tool security restriction, so a completed independent approval of the corrected diff is NOT claimed. Human/final independent review remains a release gate; no restriction was bypassed or extra paid AI used.

Production remains BLOCKED: private hosting administration, effective data path, single writer, consistent backup, isolated restore and immutable old artifact/rollback not proven. The local tests are not a substitute for provider recovery evidence. The old deployment was not changed and no Windows installed configuration was modified. Engram search yielded no callable Engram capability.
