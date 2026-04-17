# PWA Secrets — VAPID Keys

Web Push authentication uses a VAPID ECDSA P-256 keypair. This doc describes how to generate the keys once and where to place them.

## Generate once

Run from the project root on any machine with Node installed:

```bash
node -e "const c=require('crypto');const k=c.generateKeyPairSync('ec',{namedCurve:'P-256'});const pub=k.publicKey.export({type:'jwk'});const priv=k.privateKey.export({type:'jwk'});console.log('VAPID_PUBLIC_X =',pub.x);console.log('VAPID_PUBLIC_Y =',pub.y);console.log('VAPID_PRIVATE_D =',priv.d);"
```

Record the three base64url-encoded values: `x`, `y` (public key coordinates), and `d` (private key scalar).

## Compute the applicationServerKey for the frontend

The browser's `pushManager.subscribe({ applicationServerKey })` wants the uncompressed EC point `0x04 || x || y`, base64url-encoded. Compute it once:

```bash
node -e "const b=(s)=>Buffer.from(s,'base64url');const x=b(process.env.X);const y=b(process.env.Y);process.stdout.write(Buffer.concat([Buffer.from([4]),x,y]).toString('base64url')+'\n')" X=<VAPID_PUBLIC_X> Y=<VAPID_PUBLIC_Y>
```

Call this output `VAPID_APP_SERVER_KEY`.

## Worker secrets (API)

The API Worker reads three secrets + one plain var. From `packages/api`:

```bash
npx wrangler secret put VAPID_PUBLIC_X
npx wrangler secret put VAPID_PUBLIC_Y
npx wrangler secret put VAPID_PRIVATE_D
```

Paste each base64url value when prompted.

Also add to `packages/api/wrangler.toml` under `[vars]`:

```toml
VAPID_SUBJECT = "mailto:ops@ohcs.gov.gh"
```

## Frontend env (both Pages projects)

Each frontend needs `VITE_VAPID_PUBLIC_KEY` set to the `VAPID_APP_SERVER_KEY` computed above.

Add to `packages/staff/.env` and `packages/web/.env`:

```
VITE_VAPID_PUBLIC_KEY=<VAPID_APP_SERVER_KEY>
```

Also set the same variable in the Cloudflare Pages dashboard for each project:

- **staff-attendance** → Settings → Environment variables → Production → `VITE_VAPID_PUBLIC_KEY`
- **ohcs-smartgate** → Settings → Environment variables → Production → `VITE_VAPID_PUBLIC_KEY`

## Rotation

To rotate the VAPID keypair:

1. Generate a new keypair (steps above).
2. Update the three Worker secrets (`wrangler secret put`).
3. Update `VITE_VAPID_PUBLIC_KEY` in both Pages projects and redeploy.
4. Existing push subscriptions remain valid (they're bound to their endpoint, not the VAPID key) but subsequent subscription attempts will use the new key.
