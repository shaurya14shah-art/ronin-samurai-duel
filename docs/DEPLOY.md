# Deploying RŌNIN

One Node process serves everything: the built client (static files), the duel server
(WebSocket, same origin) and the account/record API. Accounts and records are JSON files in
`server/data/`, so run **one** instance with a persistent disk, behind HTTPS.

## Run the production build locally

```bash
npm start          # builds shared, client and server, then serves on :8080
```

`npm run serve` serves an existing build. Open http://localhost:8080. Verified: the page,
`npm run test:net` with `RONIN_SERVER=ws://localhost:8080`, and the two-browser duel with
`RONIN_URL=http://localhost:8080/ node tools/two-player.mjs <dir> --lag 100`.

## Container

```bash
docker build -t ronin .
docker run -p 8080:8080 -v ronin-data:/app/server/data ronin
```

(The Dockerfile has not been built on the development machine, which has no Docker. The
commands it runs are the ones verified above.)

## Fly.io (one example host)

1. Install `flyctl` and sign in (`fly auth login`).
2. Set `app` in `fly.toml` to a name of your own.
3. `fly launch --no-deploy --copy-config`, then `fly volumes create ronin_data --size 1`.
4. `fly deploy`. The game is at `https://<app>.fly.dev`; the client connects with `wss://` to
   the same origin.

Any host that runs a Docker image with a persistent volume and terminates TLS works the same.

## Settings (environment)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | 2567 (dev) / 8080 (prod) | listen port |
| `NODE_ENV` | — | `production` turns off the room monitor at `/colyseus` |
| `RONIN_ACCOUNTS` | `data/accounts.json` | accounts file (`""` keeps them in memory) |
| `RONIN_RECORDS` | `data/records.json` | win/loss records |
| `RONIN_CLIENT_DIST` | `../client/dist` | built client to serve |
| `RONIN_ORIGIN` | `*` | CORS origin for `/auth` and `/duels` (set to your site in production) |
| `VITE_RONIN_SERVER` | — | build-time: point a separately hosted client at a server |

## Security notes

- Passwords: scrypt with a per-account salt. Sessions: random 256-bit tokens, stored hashed,
  30 days. Five wrong passwords lock a name for a minute; 20 auth requests a minute per address.
- Always serve over HTTPS: passwords and tokens are sent in requests.
- There is no password reset or email: a forgotten password means a new account.
