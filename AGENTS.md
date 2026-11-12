# AGENTS.md — OpenVibe.Surf

## Project overview

OpenVibe.Surf (`https://openvibe.surf`) is one room with three surfs:

- **Ride** — CS-style surf maps played inside OpenVibe.Games embeds; the catalogue is proxied from Games.
- **Watch** — lean-back channel surfing over OpenVibe.Live: live streams, clips and AI moments merged into
  one feed, plus in-memory watch-together parties over SSE.
- **Web** — *Surf with Vibe*: a standing brief sent to OpenVibe.Actor so an agent browses for the person
  and returns a cited report.

- **Entry:** `server/index.js`; app `server/app.js`; port `5110`, service id `surf`; pages in
  `server/views/index.js`, `server/render/layout.js`; API in `server/http/`; Watch/Ride/Web clients in
  `server/watch/`, `server/ride/`, `server/web/`; auth in `server/auth/`.
- **No database, no Valkey, no Events.** The only state is the 30 s Watch feed cache, the 60 s Ride
  cache, the SDK's JWKS cache and the in-memory watch parties. **A restart ends every watch party.**
- **Pages:** server-rendered through the OpenVibe Frame (`openvibe-shared/shell`), readable without
  JavaScript; `public/js/surf.js` adds the TV (native HLS, else `/vendor/hls.light.min.js` only when
  needed), the Web form and the home timer. Own CSS in `public/css`; no bundler.

## Who calls it, what it calls

Public reads (`/api/v1/watch/feed`, `/api/v1/ride/maps`, `/api/v1/ride/maps/:id`) need no token.
Signed-in writes use the person's httpOnly `surf_at` Network cookie.

- **OpenVibe.Live** — the Watch feed source (live streams, clips, moments, DVR playlist), with each
  source given 2 s; a failed source is named in `sources` and makes the page `partial`, never fatal.
- **OpenVibe.Games** — the Ride map catalogue and the embed origin
  (`https://openvibe.games/surf/embed?map=<id>&embed=1`); until Games' surf routes exist, Games answers
  404 and Surf serves an empty catalogue plus `games: "not_ready"`.
- **OpenVibe.Actor** — `POST /api/v1/tasks` with the person's own Bearer token, an `Idempotency-Key` and
  the standing brief; the task belongs to the person's allowance and task list. Actor's 4xx keeps its
  status and words; no answer is `502 actor.unavailable`.
- **OpenVibe.Network** — OAuth `surf` client (PKCE S256, state, server-side code exchange), JWKS and
  sign-in.
- **OpenVibe.Chat** — only a validated room link the host pasted; Surf has no chat.

## Frontend loading model

Every page is server-rendered with the shared Frame; `sf-` ids/classes are stable for scripts and tests.
A page for a signed-in person is `private, no-store`; a public page is `public, max-age=60` with
`Vary: Cookie`. Interactive extras live in `public/js/surf.js` (TV, form, timer) and are progressive
enhancement only. The SSE route `GET /watch/p/<id>/events` needs `proxy_buffering off`, no gzip and a
1-hour read timeout in nginx.

## Auth and security

OAuth 2 authorization code + PKCE S256 with the `surf` Network client; the session lives in httpOnly
cookies and no script can read or log it. The only place the token goes is the `Authorization` header
of a request to the configured Actor origin. A Web task must come from this site's own `Origin` (a
cross-site request could spend the visitor's allowance); `/web/go` also checks `Sec-Fetch-Site`; `next`
after sign-in is this site's own path only and control characters/backslashes are refused.

Watch-together: only the host may command, from this site's own Origin; a member's or another site's
command is 403. Party ids are unguessable; at most 200 parties and 50 members each.

## Deploy

`sudo ovhost deploy surf`: checkout `/opt/openvibe.surf`, unit `openvibe-surf.service` on
`127.0.0.1:5110`, env `/etc/openvibe/surf.env`. nginx
`deploy/nginx/openvibe.surf.conf` (installed with `ov-vhost-install`): `/api` reads only,
`/api/v1/web/` and `/web/go` the forms zone, `/auth` GET only, `/auth/me` the API budget,
`/internal` and `/metrics` 404. Readiness answers `degraded` (HTTP 200) when Network, Live or Games is
unreachable. Rollback with `sudo ovhost rollback surf --to <sha>`.

## Commands and tests

```bash
npm ci
npm run dev                 # http://127.0.0.1:5110
npm test                    # every test/*.test.js against in-process stand-ins
npm test -- watch           # only matching files
npm test -- --strict        # a skipped file fails the run
```

`test/run.js` uses `openvibe-shared/test-runner` (60 s, serial); each file boots Surf against
in-process Network/Live/Games/Actor stand-ins, never the internet. Tests cover the merged feed and
partial sources, Ride fallbacks, the Actor task (Idempotency-Key, statuses), watch parties and SSE,
the pages, sign-in origin rules, discovery/agent twins, contrast and links.

## Conventions and pitfalls

- CommonJS, 4-space indent, single quotes, semicolons; problem+json for API errors; escaped,
  server-rendered HTML. No database and no schema: do not add a migration without a design change.
- **Nothing durable may be assumed.** Parties, caches and tokens-in-flight die on restart; a feature
  that needs to survive one belongs in another service, not in Surf's memory.
- **Never weaken the origin checks** on `/api/v1/web/tasks`, `/web/go` or a party command; they protect
  a person's Actor allowance and their party.
- **A Live/Games/Actor failure is named, not hidden:** `sources`/`partial`, `games: "not_ready"` and
  `502 actor.unavailable` are the contract; never fabricate feed entries or map data.
- **The Web question never goes in a URL:** `/web/go` posts it and 303s to the Actor task page.
- **Progressive enhancement:** every page must work without `public/js/surf.js`; the HLS vendor file is
  loaded only when native HLS is missing.
