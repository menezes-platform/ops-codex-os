# Martha Fleet — Drive-first, zero durable job outputs on worker

**Policy:** Git remains canonical for source commits. The dedicated Google Drive object store is canonical for job outputs, reports, files, logs, result receipts and an index linking them by SHA-256. The Martha stores only agent runtime, private node HMAC material, disposable workspace/cache and files awaiting verified upload. This does **not** imply that arbitrary programs or unrelated projects are automatically redirected to Drive.

## Fail-closed preflight

The local CLI `persistd/src/fleet/silent-job-cli.js` obtains a short-lived Google Drive access token by POSTing a HMAC-signed request to PersistFlow's existing `/v1/fleet/nodes/<id>/drive-token` endpoint. The refresh token and OAuth client secret remain solely on the authority host, never on Martha or child processes. If the authority's Drive storage is absent or access is invalid, **no job starts** (`DRIVE_ARCHIVE_NOT_CONFIGURED` or token error).

A non-secret local `agent/worker-config.json` must contain:

```json
{"baseUrl":"https://darkslategrey-raccoon-448222.hostingersite.com","nodeId":"conthabil-martha"}
```

The worker reads its private node HMAC secret from `ConthabilFleet/node-secret.txt` only in the parent token-request process. The child job never inherits the node HMAC secret. The authority must have `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_REFRESH_TOKEN`, and `GABRIEL_DRIVE_ROOT_ID`, or equivalent documented protected files. Configure Drive OAuth once following `drive-fleet-operations.md`. A connected ChatGPT Google Drive plugin does **not** provide the server-side OAuth credentials to PersistFlow.

## Job input (trusted local manifest)

Manifests must be at `%LOCALAPPDATA%\ConthabilFleet\jobs\requests\<taskId>.json`. The `cwd` must point to the dedicated `%LOCALAPPDATA%\ConthabilFleet\jobs\workspaces\<taskId>` directory. The directory must already exist and be created by an authorized caller. Example:

```json
{"taskId":"one-unique-id","tool":"node","args":["-e","require('fs').writeFileSync('result.txt','example')"],"cwd":"C:\\Users\\ODETE\\AppData\\Local\\ConthabilFleet\\jobs\\workspaces\\one-unique-id"}
```

To run from an authenticated machine management connection, start the existing `wscript.exe //B //Nologo silent-job-launcher.vbs <manifest>` hidden launcher, not a visible CMD/PowerShell window. Child uses `windowsHide:true`, `shell:false`, bounded logs and timeout. Interactive/GUI tasks, arbitrary executables, PowerShell/CMD and the Windows Store Python launcher are denied. A trusted path to a real Python interpreter is required for Python jobs. A child that itself spawns GUI apps is not allowed by policy; this is not an OS sandbox against a malicious program.

## Durable commit and cleanup

After the job finishes (success, failure or timeout), every regular file under its dedicated workspace plus `stdout.log`, `stderr.log` and `receipt.json` are uploaded with `DriveObjectStore.put()`. Empty files are represented exactly by their SHA-256 and size in the Drive index. Every nonempty object must have a verified SHA, Drive object ID and companion Drive manifest ID. The final `job-index` is itself uploaded and confirmed durable.

Only **after** the final index and every artifact are confirmed does the worker delete its own named job workspace, log directory and request manifest. It never recursively cleans arbitrary folders, Git repositories, or other users' data. Upload failure leaves all job files intact and marks `DRIVE_ARCHIVE_PENDING` (nonzero exit). Re-run the same manifest to retry archive **without executing the job again**. No remote archive confirmation means no disk cleanup.

Retained files from older pre-Drive smoke tests are not auto-deleted. They must be archived and verified individually or explicitly reviewed before cleanup. The Fleet route remains drained until the separate Drive authentication, durable storage smoke and authorized dispatch path pass issue #50.

## Validation

- `node --test tests/fleet-drive-only-cli.test.js tests/fleet-drive-job-archive.test.js tests/fleet-worker-drive-access.test.js`
- `npm test` (repository root)
- On Martha: launch a disposable job manifest with Drive enabled; confirm remote file and index refs, then confirm local directories are gone.
- With Drive unavailable: confirm no job process starts; do not claim a Drive smoke has passed.