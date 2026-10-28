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
        var cur = 0, hls = null;
        function el(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }
        function show(i, dir) {
            if (!chs.length) return;
            cur = (i + chs.length) % chs.length;
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
                screen.appendChild(v);
                if (v.canPlayType('application/vnd.apple.mpegurl')) { v.src = d.sfSrc; v.play().catch(function () {}); }
                else loadHls().then(function (Hls) {
                    if (!Hls || !Hls.isSupported()) { v.src = d.sfSrc; return; }
                    if (chs[cur] !== c) return;
                    hls = new Hls({ maxBufferLength: 20 }); hls.loadSource(d.sfSrc); hls.attachMedia(v);
                    hls.on(Hls.Events.MANIFEST_PARSED, function () { v.play().catch(function () {}); });
                });
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
        }
        root.querySelector('[data-sf-prev]').addEventListener('click', function () { show(cur - 1, -1); });
        root.querySelector('[data-sf-next]').addEventListener('click', function () { show(cur + 1, 1); });
        chs.forEach(function (c, n) {
            c.querySelector('.sf-ch-link').addEventListener('click', function (e) { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); show(n, n > cur ? 1 : -1); screen.scrollIntoView && window.innerWidth < 980 && screen.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' }); });
        });
        document.addEventListener('keydown', function (e) {
            if (!document.body.contains(root)) return;
            var t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
            if (e.key === 'ArrowDown') { e.preventDefault(); show(cur + 1, 1); } else if (e.key === 'ArrowUp') { e.preventDefault(); show(cur - 1, -1); }
        });
        // A vertical swipe on the screen changes channel (the video's own controls keep their taps).
        var y0 = null, x0 = null;
        screen.addEventListener('touchstart', function (e) { var t = e.touches[0]; y0 = t.clientY; x0 = t.clientX; }, { passive: true });
        screen.addEventListener('touchend', function (e) {
            if (y0 == null) return; var t = e.changedTouches[0], dy = t.clientY - y0, dx = t.clientX - x0; y0 = null;
            if (Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx) * 1.5) show(cur + (dy < 0 ? 1 : -1), dy < 0 ? 1 : -1);
        }, { passive: true });
        var first = chs[0];
        if (first && first.dataset.sfPlayType === 'hls') show(0, 1);
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
