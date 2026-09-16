# PersistFlow on Hostinger

PersistFlow v1 runs as a plain Node.js web app and keeps the ChatGPT conversation as the cognitive controller. Hostinger is only the durable HTTP/control-plane host.

## Runtime

- Node.js 22-24
- entrypoint: `server.js`
- start command: `npm start`
- no build step is required
- listen port: `process.env.PORT`

## Durable authority

Production startup uses `FileAuthorityStore`.

By default the data directory is:

```text
$HOME/.persistflow-data
```

Set `PERSISTFLOW_DATA_DIR` to override it. The path must remain outside the deployed build tree.

Do not store authority under `hbuilds/current`, `hbuilds/versions`, `nodejs`, or `public_html`: Hostinger replaces deployment-managed files on redeploy.
## Verification

After deployment:

1. `GET /` must return the PersistFlow identity JSON.
2. `GET /healthz` must return `authority: "file"` and `durable: true`.
3. Create a disposable run through `POST /v1/runs`.
4. Restart the Node app from hPanel and verify the run still exists.
5. Redeploy the same verified commit and verify the run still exists.

If steps 4 or 5 fail, do not treat the Hostinger filesystem as canonical authority. Keep the service adapter-backed and select another already-owned durable backend only after explicit verification.

## Cost policy

PersistFlow v1 must add no recurring spend. Do not enable paid inference, automatic credits, automatic plan upgrades, or paid storage fallbacks. Existing Hostinger capacity is allowed; upgrading the plan is not automatic.
