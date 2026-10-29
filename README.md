# OpenVibe.Surf

> Ride maps, surf the web, surf what's on.

**Status:** v1, the three-surf front (v0.1.0, see [STATUS.json](STATUS.json)).
**Domain:** `openvibe.surf` · **Port:** 5110 · **Service id:** `surf` · **Env prefix:** `SURF`
**License:** AGPL-3.0-only (the same as every OpenVibe service).

OpenVibe.Surf is the Surf room. One room, three surfs:

- **Ride** — CS-style surf in the browser, served by OpenVibe.Games. The map catalogue is proxied from Games and
  every map plays in an embed (`https://openvibe.games/surf/embed?map=<id>&embed=1`).
- **Watch** — lean-back channel surfing over OpenVibe.Live: live streams, clips people cut and the AI moments of
  the week, merged into one feed with one card shape. Open a party and everyone follows the host's channel.
- **Web** — *Surf with Vibe*: tell an agent what you are looking for and it browses the web for you on a private
  desk through OpenVibe.Actor, keeps its sources and finishes with a cited report.

## What it is

- **Identity:** service id `surf`, name OpenVibe.Surf, port 5110, host 127.0.0.1. It stores no accounts, no
  database and no tokens: the person's Network session lives in httpOnly cookies.
- **Sign-in:** an OAuth 2 client of OpenVibe.Network (`surf`), authorization code with PKCE S256, a state check
  and a server-side code exchange.
- **In memory, no database:** no database, no Valkey, no Events. The only state is a 30 s Watch feed cache, a
  60 s Ride cache, the SDK's JWKS cache and the watch-together parties, all in this one process. **A restart ends
  every watch party.**

## Watch

`GET /api/v1/watch/feed?topic=all|live|clips|moments&cursor=`

Merges three public OpenVibe.Live reads (`OV_LIVE_INTERNAL_URL`, default `http://127.0.0.1:3000`):

| Source | Live route | What it gives |
|---|---|---|
| live | `GET /api/streams` | `{ streams: [...] }` with `username`, `display_name`, `avatar_url`, `title`, `viewer_count`, `thumbnail_url` |
| clips | `GET /api/content/feed?type=clips&sort=new&window=week` | `items` with `href`, `thumbnail_url`, `preview_url`, `title`, `channel`, `duration_seconds` |
| moments | `GET /api/content/moments?type=clips&sort=top&window=week` | the same shape, AI-cut clips |

Every card is one shape:

```json
{
  "key": "live:bo",
  "kind": "live",
  "title": "Surf practice, all day",
  "channel": { "username": "bo", "display_name": "Bo", "avatar_url": null },
  "thumbnail": "https://openvibe.media/live/bo.jpg",
  "play": { "type": "live", "src": null, "page": "https://openvibe.live/@bo" },
  "duration_seconds": null,
  "viewers": 38,
  "why": "Live now · 38 watching"
}
```

- A clip or moment has `play.type: "hls"`, `play.src` = its `preview_url` (an HLS master playlist on
  `openvibe.media`: Media 302s `/c/<id>` to `master.m3u8`) and `play.page` = its Live page. A live stream has
  `play.type: "live"`, `src: null` and `page` = `https://openvibe.live/@<username>` (Live has no embeddable
  player yet).
- **Ranking:** live streams first, by viewers; then moments and clips interleaved by freshness. Finally, no two
  cards from the same channel sit next to each other when another channel is available.
- **Cache:** a complete merged page for a topic/cursor is cached 30 s (`SURF_WATCH_CACHE_MS`); a partial page is
  not kept, so the next request retries the missing source. Each Live source gets 2 s
  (`SURF_WATCH_SOURCE_TIMEOUT_MS`); a source that fails or times out is left out, named in `sources`
  (`{ live: "ok", clips: "ok", moments: "error" }`) and `partial` is true.
- **Cursor:** opaque; it carries each Live feed's own `next` cursor. Page two does not repeat live streams.
- **Cache-Control:** `public, max-age=30`.

### Watch together

A signed-in person opens a party (`POST /watch/party`, from this site) and gets an unguessable id at
`/watch/p/<id>`; that link is the invitation. Opening it sends a guest to sign in first and joins everyone else.
The page reuses the TV markup with a `sf-party-` bar: members, host, **Copy link**, **Leave**, and, if the host
pasted one, a link to an OpenVibe.Chat room (`https://openvibe.chat/...`, validated). There is no chat inside Surf.

- **Host:** the person who opened the party. Only the host commands, with
  `POST /watch/p/<id>/command` (also `POST /watch/p/<id>` and `/state`) and
  `{ channel_key, position_s, playing, at }`, from this site's own Origin. A member's command is 403, and so is a
  command from another site.
- **Sync:** `GET /watch/p/<id>/events` is Server-Sent Events (`text/event-stream`): `state` once, then `command`
  when the host changes channel, play/pause or seek, `members` on a join/leave, and `chat` when the room link
  changes. The browser applies commands, follows play/pause and seeks, and corrects a drift over 2 s.
- **Leaving and lifetime:** `POST /watch/p/<id>/leave` (the Leave button) removes that member; if the host leaves
  while others remain, the earliest remaining member becomes host. The last member out starts a 30-minute clock.
  The Map holds at most 200 open parties and 50 members each; an empty party is dropped on the next read 30
  minutes after its last member leaves. Everything is memory only: a restart ends every party.

## Ride

`GET /api/v1/ride/maps` and `GET /api/v1/ride/maps/:id`

Proxy to OpenVibe.Games (`OV_GAMES_INTERNAL_URL`, default `http://127.0.0.1:8000`), cached 60 s
(`SURF_RIDE_CACHE_MS`). The routes `/api/surf/maps` and `/api/surf/maps/:id` are being added to Games now. Until
they answer, Games gives 404: the list is `{ "maps": [], "games": "not_ready" }` and a map detail is a shell that
still carries the embed (`{ "map": { "id": … }, "top": [], "games": "not_ready" }`). A Games timeout or 5xx is a
`502 games.unavailable` problem and is never cached.

Each map carries `embed_url`:
`https://openvibe.games/surf/embed?map=<id>&embed=1` (`SURF_GAMES_PUBLIC_URL`).

## Web — Surf with Vibe

`POST /api/v1/web/tasks` (signed in; this site's own `Origin`) with `{ "query": "…" }` (3–500 characters).

The person's own Network access token from the httpOnly `surf_at` cookie is sent to OpenVibe.Actor
(`OV_ACTOR_INTERNAL_URL`, default `http://127.0.0.1:4950`) as a Bearer on `POST /api/v1/tasks`. Actor accepts a
person's session token there; the task is theirs — their allowance and their task list — not OpenVibe.Surf's.

The task text is a short standing brief plus the query unchanged:

> Surf the web for me with your tools. Use search_web to find pages, read_page to read them, and a desk when a
> page needs one. Keep every source you use and finish with a short report that cites each source.

The request carries an `Idempotency-Key` header (and Actor's body `idempotency_key`, the same value), so a retried
form does not start a second task. The answer is `{ "task_id": "tsk_…", "page": "https://openvibe.actor/tasks/tsk_…" }`
(201, `Location` set). Actor's 4xx refusal (401, 403, 429 allowance/budget, 422) keeps its status and its words;
an Actor that does not answer is a `502 actor.unavailable`.

`POST /web/go` (form field `q`) is the same task as a plain form for no-JavaScript: it creates the task and
**303**s to the Actor task page, so the question is never in a URL. It is refused from another site (Origin or
Sec-Fetch-Site), a guest is sent to sign in, a bad query is a 400 with the form again, and an Actor refusal keeps
its status and prints its words. It is `private, no-store`; a `GET /web/go` starts nothing and goes back to `/web`.

## Pages

| Route | What it is |
|---|---|
| `/` | the Surf room: the run motif (ramps, speed lines, a ticking timer), the three tiles under the hero, scenes, questions |
| `/ride` | the maps with tier, stages, runs and the record, and the embed of the first map |
| `/ride/:map` | one map: name, tier, stages, records if Games answers, the embed |
| `/watch` | the TV: the screen plays clips and moments in the page (HLS), the guide lists every channel; ↑ ↓, a swipe or a tap changes channel; a live stream that records to MP4 plays over Media's DVR playlist, a little behind live, and any other opens on its channel; **Watch together** opens a party |
| `/watch/p/:id` | a watch party: the same TV, a `sf-party-` bar with the members, host, Copy link and Leave, and the optional OpenVibe.Chat room link; signed-in members follow the host's channel and position over SSE |
| `/web` | the Surf with Vibe form, examples, and what happens next |
| `/developers` | the API, for people and agents |
| anything else | the 404 page |

All of them are server-rendered through the OpenVibe Frame (`openvibe-shared/shell`) and readable without
JavaScript, with stable `sf-` ids and classes. A page rendered for a signed-in person is `private, no-store`; a
public page is `public, max-age=60` with `Vary: Cookie`. `public/js/surf.js` adds what the pages are complete
without: the TV (native HLS, else `/vendor/hls.light.min.js` 1.7.3, loaded only then), the Web form in the page and
the home timer; everything works without it.

## API

| Route | Auth | Cache | What it does |
|---|---|---|---|
| `GET /api/v1/watch/feed` | none | `public, max-age=30` | the merged Live feed |
| `GET /api/v1/ride/maps` | none | `public, max-age=60` | the Games surf map catalogue |
| `GET /api/v1/ride/maps/:id` | none | `public, max-age=60` | one map and its fastest runs |
| `POST /api/v1/web/tasks` | cookie + Origin | `private, no-store` | create one Actor task as the person |
| `POST /web/go` | cookie, this site only | `private, no-store` | the no-JavaScript task form, 303 to Actor |
| `POST /watch/party` | cookie + Origin | `private, no-store` | open a party, 303 to `/watch/p/<id>` (JSON: 201) |
| `GET /watch/p/:id/events` | cookie, member | `no-store` | the party's SSE stream (`state`, `command`, `members`, `chat`) |
| `POST /watch/p/:id/command` | cookie, host + Origin | `private, no-store` | `{ channel_key, position_s, playing, at }`, broadcast over SSE |
| `POST /watch/p/:id/leave` | cookie + Origin | `private, no-store` | leave the party, 303 to `/watch` (JSON: 200) |
| `POST /watch/p/:id/chat` | cookie, host + Origin | `private, no-store` | set the `https://openvibe.chat/...` room link |

Errors are RFC 9457 `application/problem+json`. A blank map id is 400; a bad Watch topic or cursor is 400. The
only outbound person token is the `Authorization: Bearer` on the request to Actor.

Plumbing: `GET /api/health`, `GET /api/ready` (200 `ready` or `degraded`; Network, JWKS, the OAuth client, Live,
Games and Actor are optional checks), `GET /release.json`, `POST /release-metrics`, `/shared/*` (the pinned Frame),
`/css/*` and `/js/*` (content-hashed `?v=` → immutable), `GET /robots.txt`, `GET /sitemap.xml` (the public pages
and the Ride maps), `GET /llms.txt` and `GET /metrics` (loopback only).

## Sign-in

`server/auth/sso.js` is OpenVibe.Design's module with this site's names:

- `GET /auth/login?next=/web[&silent=1]` mints a state and a PKCE S256 verifier/challenge, stores them (and the
  sanitized `next`) in the httpOnly `surf_oauth` flow cookie scoped to `/auth`, and redirects to
  `${OV_NETWORK_URL}/oauth/authorize` with `client_id=surf` and `redirect_uri=${BASE_URL}/auth/callback`.
- `GET /auth/callback` checks the state in constant time, exchanges the code at the Network's internal
  `/oauth/token` with the client secret and the code verifier, and sets `surf_at` (24 h) and `surf_rt` (30 d):
  httpOnly, SameSite=Lax, Secure in production, Path=/.
- `GET /auth/logout` clears them and revokes the refresh token (best effort); `GET /auth/me` answers `{ user }` or
  `{ user: null }` for the shared navbar. A FedCM assertion or an app/service token never becomes a session.
- `sanitizeNext` accepts same-site relative paths only. An absolute URL on this site's own origin counts as its
  path; another origin, `//evil`, a control character or a backslash goes to `/`.

The Network signs the access token (RS256); `server/auth/keys.js` fetches and refreshes its JWKS from
`${OV_NETWORK_INTERNAL_URL}/api/.well-known/jwks` through `openvibe-sdk/auth`.

## Configuration

See [.env.example](.env.example). Required in production: `BASE_URL` and `OV_OAUTH_CLIENT_SECRET` (the `surf`
OAuth client on the Network).

| Variable | Default | What |
|---|---|---|
| `OV_NETWORK_INTERNAL_URL` | `http://127.0.0.1:4000` | sign-in token exchange and JWKS |
| `OV_NETWORK_URL` | `https://openvibe.network` | where a browser is sent to authorize |
| `OV_NETWORK_ISSUER` | `OV_NETWORK_URL` | the token issuer |
| `OV_LIVE_INTERNAL_URL` | `http://127.0.0.1:3000` | Watch's three Live reads |
| `OV_GAMES_INTERNAL_URL` | `http://127.0.0.1:8000` | Ride's map reads |
| `OV_ACTOR_INTERNAL_URL` | `http://127.0.0.1:4950` | Web's task creation |
| `SURF_GAMES_PUBLIC_URL` | `https://openvibe.games` | the embed origin and `embed_url` |
| `SURF_LIVE_PUBLIC_URL` | `https://openvibe.live` | card page links |
| `SURF_ACTOR_PUBLIC_URL` | `https://openvibe.actor` | the task page a person is sent to |
| `SURF_WATCH_CACHE_MS` | `30000` | the merged Watch feed cache |
| `SURF_WATCH_SOURCE_TIMEOUT_MS` | `2000` | one Live source's budget |
| `SURF_RIDE_CACHE_MS` | `60000` | the Ride cache |
| `SURF_GAMES_TIMEOUT_MS` | `4000` | one Games read's budget |
| `SURF_ACTOR_TIMEOUT_MS` | `15000` | one Actor task creation's budget |
| `SURF_RATE_LIMIT_PER_MIN` | `120` | per-IP `/api` and `/auth` budget |
| `SURF_PARTY_MAX` | `200` | open watch parties (may only be lowered, hard cap 200) |
| `SURF_PARTY_MEMBER_MAX` | `50` | members per party (may only be lowered, hard cap 50) |
| `COOKIE_SECURE` | true in production | Secure cookies |

## How to run

```bash
npm install
npm run dev            # http://localhost:5110
OV_ALLOW_SUITE=1 npm test
```

`npm test` runs every `test/*.test.js` (including `test/party.test.js`: create/join/leave, host-only and
same-site commands, SSE delivery, the 30-minute TTL and the caps) in its own process with in-process stand-ins
(`test/helpers/network.js`, `test/helpers/upstreams.js`): a real RS256 key pair and the OAuth token endpoint for
Network, and recorded Live, Games and Actor routes. Nothing calls the real internet. `OV_ALLOW_SUITE=1` is the
suite opt-in the shared test runner expects.

## Deploy (for the lead)

- **Deploy:** `sudo ovhost deploy surf` on the host (checkout at `/opt/openvibe.surf`, unit
  `openvibe-surf.service` on 127.0.0.1:5110, env `/etc/openvibe/surf.env`).
- **nginx:** [deploy/nginx/openvibe.surf.conf](deploy/nginx/openvibe.surf.conf), installed with
  `ov-vhost-install`. `/api` is reads only; `/api/v1/web/` and `/web/go` are the forms zone; `/auth` is GET only;
  `/auth/me` gets the API budget; `/internal` and `/metrics` are 404. The SSE route
  `GET /watch/p/<id>/events` has `proxy_buffering off`, no gzip and a 1-hour read timeout.
- **Readiness:** `/api/ready` reports `degraded` (HTTP 200) when Network, Live or Games does not answer; the
  process still serves the pages and the crawl artifacts.

## Security (threat notes)

Reporting a vulnerability: [SECURITY.md](SECURITY.md).

- Session tokens are httpOnly cookies; no script can read them and nothing renders or logs them. The only place
  they go is the `Authorization` header of a request to the configured Actor origin.
- A Web task must come from this site's own origin (`Origin`), so another site cannot make a signed-in visitor
  spend their Actor allowance. `/web/go` refuses a cross-site navigation when the browser says it is one.
- `next` after sign-in is this site's own path only; control characters and backslashes are refused because
  browsers drop or rewrite them.
- Watch's card fields are allow-listed and escaped; only `http(s)` URLs become `href`/`src`. Actor's error
  detail is trimmed and no token or request body is logged.
- A watch party's id is 144 random bits. Only its host may command; a browser command must come from this
  site's own Origin (`Origin`/`Sec-Fetch-Site`, while a request with neither is a non-browser client and still
  needs the session cookie). Only a member may open the SSE stream, and the party page is `private, no-store`.
  The Map is capped and an empty party is dropped after 30 minutes. Member names and the optional Chat link are
  escaped; the Chat link is an absolute `https://openvibe.chat/` URL with no credentials, and Surf stores no chat.
- Secrets live only in the environment file; only variable names appear in code and docs, and no secret or token
  is logged.

---

Part of the [OpenVibe network](https://openvibe.network). Built in the open by
[OpenVibers](https://github.com/OpenVibers).

<!-- versions:start -->
- openvibe-contracts: v0.232.0
- openvibe-sdk: v0.70.0
- openvibe-shared: v4.43.0
<!-- versions:end -->
