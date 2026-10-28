# Changelog

What changed in OpenVibe.Surf, newest first. Each site also publishes its patch notes at /updates.

## 0.1.0 — 2026-10-28

The service skeleton: three surfs, one room.

- **Sign-in with OpenVibe.Network** (`server/auth/sso.js`, OAuth client `surf`): authorization code with PKCE
  S256, a state check, a server-side code exchange, httpOnly `surf_at` and `surf_rt` cookies (SameSite=Lax,
  Secure in production), the `surf_oauth` flow cookie, and `sanitizeNext` (this site's own origin only, no
  control characters or backslashes). `/auth/login`, `/auth/callback`, `/auth/logout`, `/auth/me`.
- **Watch** (`server/watch/feed.js`, `GET /api/v1/watch/feed`): OpenVibe.Live's live streams
  (`GET /api/streams`), clips (`GET /api/content/feed?type=clips&sort=new&window=week`) and AI moments
  (`GET /api/content/moments?type=clips&sort=top&window=week`) merged into one item shape. Live streams first by
  viewers, then moments and clips interleaved by freshness, never two cards from the same channel in a row. The
  merged feed is cached 30 s; each Live source gets 2 s and a failing one is left out and named in `sources`. The
  topic filter, an opaque per-source cursor and `public, max-age=30` are included.
- **Ride** (`server/ride/games.js`, `GET /api/v1/ride/maps`, `/api/v1/ride/maps/:id`): a proxy to OpenVibe.Games'
  `/api/surf/maps` routes, cached 60 s, each map carrying its
  `https://openvibe.games/play/surf?map=<id>&embed=1` embed URL. While Games' new routes answer 404 the list is
  empty and `games` is `'not_ready'`; a Games failure is a 502 and is never cached.
- **Web** (`server/web/tasks.js`, `POST /api/v1/web/tasks`, `GET /web/go`): Surf with Vibe. A signed-in,
  same-origin request creates one OpenVibe.Actor task with the person's own Network token from `surf_at` as a
  Bearer, an `Idempotency-Key`, and a short browsing brief (search_web, read_page, a desk when a page needs one,
  keep sources, finish with a cited report). Answers `{ task_id, page }`; Actor's 4xx refusal keeps its status
  and words. `POST /web/go` is the same task as a no-JavaScript form (this site only) that 303s to the Actor task page.
- **Pages** (`server/http/pages.js`, `server/views/index.js`): `/`, `/ride`, `/ride/:map`, `/watch`, `/web`,
  `/developers` and a 404, all server-rendered through the OpenVibe Frame and complete without JavaScript, with
  stable `sf-` ids and classes. Public pages are `public, max-age=60` with `Vary: Cookie`; a page rendered for a
  signed-in person is `private, no-store`. The room is designed: the run motif and three tiles on the home page, the
  Watch TV with its guide (clips and moments play in the page over HLS), the maps, and the Web form.
- **Plumbing** (`server/app.js`): helmet with the network's CSP (the Games embed, a possible Live player, the
  media edge for HLS), content-hashed `/css` and `/js`, `/api/health`, `/api/ready` (degraded, never 503, when an
  optional upstream is down), `/release.json`, `/release-metrics`, `/shared/*`, `/robots.txt`, `/sitemap.xml` and
  `/llms.txt`, a 120/min per-IP limit on `/api` and `/auth`, and a graceful stop.
- **Deploy:** `deploy/systemd/openvibe-surf.service` (port 5110, `/etc/openvibe/surf.env`) and
  `deploy/nginx/openvibe.surf.conf` (TLS for openvibe.surf, www → apex, the Watch/Ride read zone, the forms zone
  for `/web/go` and `/api/v1/web/`, `/auth/me` on the API zone, `/internal` and `/metrics` 404).
- **Tests:** `test/feed.test.js`, `test/ride.test.js`, `test/web.test.js`, `test/sso.test.js`,
  `test/pages.test.js` and `test/discovery.test.js`, each against in-process Network/Live/Games/Actor stand-ins.
