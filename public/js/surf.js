/* OpenVibe.Surf: what the pages are complete without.
 *   - Watch: the TV plays clips and moments in the page (native HLS, else hls.js from /vendor, loaded only then);
 *     ↑ ↓, the buttons, a swipe on the screen or a tap in the guide change channel; live streams open on Live.
 *   - Web: the form starts the task in the page (POST /api/v1/web/tasks) and goes to it; examples fill the box.
 *   - Home: the run motif's timer and speed tick. */
(function () {
    'use strict';
    var reduced = function () { try { return matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.ovMotion === 'reduced'; } catch (e) { return false; } };

    // ── Home: the run's timer ─────────────────────────────────
    function runMotif() {
        var t = document.querySelector('[data-sf-timer]'), sp = document.querySelector('[data-sf-speed]');
        if (!t || t.dataset.ticking || reduced()) return;
        t.dataset.ticking = '1';
        var start = performance.now() - 12384;
        var tick = function () {
            if (!document.body.contains(t)) return;
            var ms = (performance.now() - start) % 59999, m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000), x = Math.floor(ms % 1000);
            t.textContent = m + ':' + String(s).padStart(2, '0') + '.' + String(x).padStart(3, '0');
            if (sp) sp.textContent = (1180 + Math.round(140 * Math.sin(ms / 700))).toLocaleString('en-US').replace(',', ' ');
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }

    // ── Watch: the TV ─────────────────────────────────────────
    var hlsLoading = null;
    function loadHls() {
        if (window.Hls) return Promise.resolve(window.Hls);
        return hlsLoading || (hlsLoading = new Promise(function (ok) {
            var s = document.createElement('script'); s.src = '/vendor/hls.light.min.js'; s.async = true;
            s.onload = function () { ok(window.Hls || null); }; s.onerror = function () { hlsLoading = null; ok(null); };
            document.head.appendChild(s);
        }));
    }
    function tv() {
        var root = document.querySelector('[data-sf-tv]');
        if (!root || root.dataset.ready) return;
        root.dataset.ready = '1';
        var screen = root.querySelector('[data-sf-screen]');
        var chs = Array.prototype.slice.call(root.querySelectorAll('.sf-ch'));
        var title = root.querySelector('[data-sf-title]'), why = root.querySelector('[data-sf-why]'), meta = root.querySelector('[data-sf-meta]');
        var kindPill = root.querySelector('.sf-tv-kind .sf-pill');
        var LABEL = { live: 'Live', clip: 'Clip', moment: 'AI moment' };
        var cur = Math.max(0, Math.min(chs.length - 1, parseInt(root.dataset.sfStart || '0', 10) || 0)), hls = null;
        var party = document.querySelector('[data-sf-party]');
        var partyId = party && party.getAttribute('data-sf-party-id');
        var partyPath = (party && party.getAttribute('data-sf-party-url')) || (partyId ? '/watch/p/' + encodeURIComponent(partyId) : '');
        var isHost = Boolean(party) && party.getAttribute('data-sf-party-is-host') === '1';
        var partyStatus = party && party.querySelector('[data-sf-party-status]');
        var partyState = party ? {
            channel_key: party.getAttribute('data-sf-party-channel') || '',
            position_s: Number(party.getAttribute('data-sf-party-position')) || 0,
            playing: party.getAttribute('data-sf-party-playing') !== '0',
            at: Number(party.getAttribute('data-sf-party-at')) || Date.now(),
        } : null;
        var applying = false, partEvent = null, programmatic = 0;

        function el(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }
        function say(msg, bad) {
            if (!partyStatus) return;
            partyStatus.textContent = msg || '';
            partyStatus.classList.toggle('is-bad', Boolean(bad));
        }
        function currentVideo() { return screen.querySelector('video'); }
        function expectedOf(state) {
            if (!state) return 0;
            var at = Number(state.at), base = Number(state.position_s) || 0;
            if (!Number.isFinite(at)) at = Date.now();
            var elapsed = state.playing ? Math.max(0, Date.now() - at) / 1000 : 0;
            return Math.max(0, base + elapsed);
        }
        function applyVideo(v, state) {
            if (!v || !state) return;
            var target = expectedOf(state);
            var seek = function () {
                try { if (Math.abs(v.currentTime - target) > 2) v.currentTime = target; } catch (e) { /* the playlist may not seek that far */ }
            };
            if (v.readyState >= 1) seek(); else v.addEventListener('loadedmetadata', seek, { once: true });
            if (state.playing) v.play().catch(function () {});
            else v.pause();
        }
        function startVideo(v, d, node) {
            if (v.canPlayType('application/vnd.apple.mpegurl')) {
                v.src = d.sfSrc;
                if (partyState) { applying = true; applyVideo(v, partyState); applying = false; }
                else v.play().catch(function () {});
            } else {
                loadHls().then(function (Hls) {
                    if (!Hls || !Hls.isSupported()) {
                        v.src = d.sfSrc;
                        if (partyState) { applying = true; applyVideo(v, partyState); applying = false; }
                        return;
                    }
                    if (chs[cur] !== node) return;
                    hls = new Hls({ maxBufferLength: 20 }); hls.loadSource(d.sfSrc); hls.attachMedia(v);
                    hls.on(Hls.Events.MANIFEST_PARSED, function () {
                        if (partyState) { applying = true; applyVideo(v, partyState); applying = false; }
                        else v.play().catch(function () {});
                    });
                });
            }
        }

        // Host: tell the party what changed (channel, play/pause, seek). Members never write.
        function postCommand(extra) {
            if (!party || !partyId || !isHost || !chs[cur]) return;
            var v = currentVideo();
            var cmd = {
                channel_key: chs[cur].dataset.sfKey || '',
                position_s: v && Number.isFinite(v.currentTime) ? v.currentTime : 0,
                playing: v ? !v.paused : true,
                at: Date.now(),
            };
            if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) cmd[k] = extra[k];
            partyState = cmd;
            fetch(partyPath + '/command', {
                method: 'POST', credentials: 'same-origin',
                headers: { 'content-type': 'application/json', accept: 'application/json' },
                body: JSON.stringify(cmd),
            }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { return { r: r, b: b }; }); })
                .then(function (x) {
                    if (x.r.ok) return;
                    say((x.b && x.b.detail) || 'That command did not reach the party.', true);
                })
                .catch(function () { say('The party did not answer. It will reconnect.', true); });
        }

        function syncMembers(data) {
            if (!party || !data) return;
            var count = party.querySelector('[data-sf-party-members]');
            var host = party.querySelector('[data-sf-party-host-name]');
            if (count && data.members != null) count.textContent = data.members;
            if (host && data.host) host.textContent = data.host;
        }
        function syncChat(url) {
            if (!party || !url) return;
            var line = party.querySelector('[data-sf-party-chat]');
            if (!line) { line = el('p', 'sf-party-chat'); line.setAttribute('data-sf-party-chat', ''); party.appendChild(line); }
            line.hidden = false;
            line.replaceChildren();
            var a = el('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = 'Chat in OpenVibe.Chat';
            line.appendChild(a);
            var input = party.querySelector('[data-sf-party-chat-form] input');
            if (input) input.value = url;
        }

        function applyCommand(cmd) {
            if (!party || !cmd || !cmd.channel_key) return;
            partyState = {
                channel_key: String(cmd.channel_key),
                position_s: Number(cmd.position_s) || 0,
                playing: cmd.playing !== false,
                at: Number(cmd.at) || Date.now(),
            };
            var at = -1;
            chs.forEach(function (c, n) { if (c.dataset.sfKey === partyState.channel_key) at = n; });
            if (at >= 0 && at !== cur) {
                show(at, at > cur ? 1 : -1, { fromSync: true });
            } else {
                var v = currentVideo();
                applying = true;
                applyVideo(v, partyState);
                applying = false;
            }
        }

        function connectParty() {
            if (!partyId || typeof EventSource === 'undefined') return;
            partEvent = new EventSource(partyPath + '/events');
            partEvent.addEventListener('open', function () {
                say(isHost ? 'You are the host: everyone follows your channel, play and seek.' : 'Following the host.');
            });
            partEvent.addEventListener('state', function (e) {
                var d = null; try { d = JSON.parse(e.data); } catch (err) { return; }
                syncMembers(d);
                if (d.chat_url) syncChat(d.chat_url);
                if (!isHost) applyCommand(d);
            });
            partEvent.addEventListener('command', function (e) {
                if (isHost) return;   // the host is the source of truth for its own screen
                var d = null; try { d = JSON.parse(e.data); } catch (err) { return; }
                applyCommand(d);
            });
            partEvent.addEventListener('members', function (e) {
                var d = null; try { d = JSON.parse(e.data); } catch (err) { return; }
                syncMembers(d);
                if (typeof d.is_host === 'boolean' && d.is_host !== isHost) {
                    isHost = d.is_host;
                    party.setAttribute('data-sf-party-is-host', isHost ? '1' : '0');
                    if (prev) { prev.disabled = !isHost; prev.title = isHost ? '' : 'The host picks the channel'; }
                    if (next) { next.disabled = !isHost; next.title = isHost ? '' : 'The host picks the channel'; }
                    say(isHost ? 'You are now the host: everyone follows your channel, play and seek.' : 'Following the host.');
                }
            });
            partEvent.addEventListener('chat', function (e) {
                var d = null; try { d = JSON.parse(e.data); } catch (err) { return; }
                if (d.chat_url) syncChat(d.chat_url);
            });
            partEvent.addEventListener('error', function () {
                say('Reconnecting to the party…', true);
            });
        }

        // Members correct drift above 2 s, and follow the host's play/pause.
        function drift() {
            if (!document.body.contains(root)) { clearInterval(drift.timer); if (partEvent) partEvent.close(); return; }
            if (!party || isHost || applying || !partyState || !partyState.channel_key) return;
            if (!chs[cur] || chs[cur].dataset.sfKey !== partyState.channel_key) return;
            var v = currentVideo();
            if (!v || v.readyState < 1 || !Number.isFinite(v.currentTime)) return;
            var target = expectedOf(partyState);
            if (Math.abs(v.currentTime - target) > 2) {
                try { v.currentTime = target; } catch (e) { /* not seekable */ }
            }
            if (partyState.playing && v.paused) { programmatic = Date.now(); v.play().catch(function () {}); }
            else if (!partyState.playing && !v.paused) { programmatic = Date.now(); v.pause(); }
        }
        drift.timer = setInterval(drift, 1000);

        function show(i, dir, opts) {
            if (!chs.length) return;
            opts = opts || {};
            if (party && !isHost && !opts.fromSync) {
                say('The host picks the channel and the position. You can leave any time.');
                return;
            }
            cur = (i + chs.length) % chs.length;
            programmatic = Date.now();
            var c = chs[cur], d = c.dataset;
            chs.forEach(function (x, n) { x.classList.toggle('is-on', n === cur); });
            if (hls) { try { hls.destroy(); } catch (e) { /* */ } hls = null; }
            screen.replaceChildren();
            screen.style.setProperty('--sf-dir', dir < 0 ? '-12px' : '12px');
            screen.classList.remove('is-changing'); void screen.offsetWidth; screen.classList.add('is-changing');
            if (d.sfPlayType === 'hls' && d.sfSrc) {
                var v = el('video', 'sf-tv-video'); v.playsInline = true; v.controls = true; v.autoplay = true; v.muted = !screen.dataset.sound;
                if (d.sfThumb) v.poster = d.sfThumb;
                v.setAttribute('data-ov-player', '');
                v.addEventListener('volumechange', function () { if (!v.muted) screen.dataset.sound = '1'; });
                // Host: every play/pause/seek is a command; applying one is not. Members only receive.
                v.addEventListener('play', function () { if (isHost && !applying && Date.now() - programmatic > 500) postCommand(); });
                v.addEventListener('pause', function () { if (isHost && !applying && Date.now() - programmatic > 500) postCommand(); });
                v.addEventListener('seeked', function () { if (isHost && !applying && Date.now() - programmatic > 500) postCommand(); });
                screen.appendChild(v);
                startVideo(v, d, c);
            } else {
                if (d.sfThumb) { var img = el('img', 'sf-tv-poster'); img.src = d.sfThumb; img.alt = ''; screen.appendChild(img); }
                var a = el('a', 'sf-tv-out'); a.href = d.sfPage || '#';
                a.textContent = d.sfKind === 'live' ? 'Watch live on OpenVibe.Live' : 'Play on OpenVibe.Live';
                screen.appendChild(a);
            }
            if (title) title.textContent = (c.querySelector('.sf-ch-body b') || {}).textContent || '';
            if (why) why.textContent = d.sfWhy || '';
            if (kindPill) { kindPill.textContent = LABEL[d.sfKind] || ''; kindPill.className = 'sf-pill sf-pill--' + (d.sfKind || 'clip'); }
            if (meta) {
                meta.replaceChildren();
                if (d.sfChannel) { var l = el('a'); l.href = 'https://openvibe.live/@' + encodeURIComponent(d.sfChannel); l.textContent = '@' + d.sfChannel; meta.appendChild(l); }
            }
            if (c.scrollIntoView && window.innerWidth >= 980) c.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
            if (party && isHost && !opts.fromSync) postCommand({ position_s: 0, playing: true, at: Date.now() });
        }

        var prev = root.querySelector('[data-sf-prev]'), next = root.querySelector('[data-sf-next]');
        if (party && !isHost) {
            if (prev) { prev.disabled = true; prev.title = 'The host picks the channel'; }
            if (next) { next.disabled = true; next.title = 'The host picks the channel'; }
        }
        if (prev) prev.addEventListener('click', function () { show(cur - 1, -1); });
        if (next) next.addEventListener('click', function () { show(cur + 1, 1); });
        chs.forEach(function (c, n) {
            c.querySelector('.sf-ch-link').addEventListener('click', function (e) {
                if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                e.preventDefault();
                if (party && !isHost) { say('The host picks the channel and the position.'); return; }
                show(n, n > cur ? 1 : -1);
                screen.scrollIntoView && window.innerWidth < 980 && screen.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
            });
        });
        document.addEventListener('keydown', function (e) {
            if (!document.body.contains(root)) return;
            var t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
            if (party && !isHost) return;
            if (e.key === 'ArrowDown') { e.preventDefault(); show(cur + 1, 1); } else if (e.key === 'ArrowUp') { e.preventDefault(); show(cur - 1, -1); }
        });
        // A vertical swipe on the screen changes channel (the video's own controls keep their taps).
        var y0 = null, x0 = null;
        screen.addEventListener('touchstart', function (e) { var t = e.touches[0]; y0 = t.clientY; x0 = t.clientX; }, { passive: true });
        screen.addEventListener('touchend', function (e) {
            if (y0 == null) return;
            var t = e.changedTouches[0], dy = t.clientY - y0, dx = t.clientX - x0; y0 = null;
            if (Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx) * 1.5) {
                if (party && !isHost) { say('The host picks the channel and the position.'); return; }
                show(cur + (dy < 0 ? 1 : -1), dy < 0 ? 1 : -1);
            }
        }, { passive: true });

        // Party bar: Copy link, the optional Chat room link, and the live member count.
        if (party) {
            var copy = party.querySelector('[data-sf-party-copy]');
            if (copy) copy.addEventListener('click', function () {
                var path = copy.getAttribute('data-sf-party-url') || partyPath;
                var url = location.origin + path;
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(url).then(function () { say('Party link copied.'); }, function () { window.prompt('Copy this party link', url); });
                } else window.prompt('Copy this party link', url);
            });
            var chatForm = party.querySelector('[data-sf-party-chat-form]');
            if (chatForm) chatForm.addEventListener('submit', function (e) {
                e.preventDefault();
                var input = chatForm.querySelector('input');
                if (!input) return;
                fetch(partyPath + '/chat', {
                    method: 'POST', credentials: 'same-origin',
                    headers: { 'content-type': 'application/json', accept: 'application/json' },
                    body: JSON.stringify({ chat_url: input.value }),
                }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { return { r: r, b: b }; }); })
                    .then(function (x) {
                        if (!x.r.ok) throw new Error((x.b && x.b.detail) || 'That is not a https://openvibe.chat/... link.');
                        syncChat(x.b.chat_url); say('Chat room linked.');
                    })
                    .catch(function (err) { say(err.message, true); });
            });
            connectParty();
        }

        var first = chs[cur];
        if (first && (first.dataset.sfPlayType === 'hls' || party)) show(cur, 1, { fromSync: true });
    }

    // ── Web: start in the page ────────────────────────────────
    function webForm() {
        var f = document.querySelector('[data-sf-web-form]');
        if (!f || f.dataset.ready) return;
        f.dataset.ready = '1';
        var box = f.querySelector('textarea'), status = document.getElementById('sf-web-status'), btn = f.querySelector('button[type=submit]');
        document.querySelectorAll('[data-sf-example]').forEach(function (b) {
            b.addEventListener('click', function () { box.value = b.getAttribute('data-sf-example'); box.focus(); });
        });
        f.addEventListener('submit', function (e) {
            e.preventDefault();
            var q = box.value.trim();
            if (q.length < 3) { status.textContent = 'Say a little more: at least 3 characters.'; status.classList.add('is-bad'); return; }
            btn.disabled = true; status.classList.remove('is-bad'); status.textContent = 'Starting the agent…';
            fetch('/api/v1/web/tasks', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ query: q }) })
                .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { return { r: r, b: b }; }); })
                .then(function (x) {
                    if (x.r.status === 401) { location.href = '/auth/login?next=%2Fweb'; return; }
                    if (!x.r.ok || !x.b.page) { throw new Error(x.b.detail || x.b.title || 'That did not start. Try again in a moment.'); }
                    status.textContent = 'Started. Taking you to the task…';
                    location.href = x.b.page;
                })
                .catch(function (err) { btn.disabled = false; status.textContent = err.message; status.classList.add('is-bad'); });
        });
    }

    function run() { runMotif(); tv(); webForm(); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
    document.addEventListener('ov:boost:load', run);
})();
