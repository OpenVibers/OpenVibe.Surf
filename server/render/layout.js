'use strict';

/**
 * Page shell for OpenVibe.Surf. Every page is server-rendered through openvibe-shared/shell and is complete
 * without JavaScript: the OpenVibe Frame (theme, navbar, footer) comes from the shared shell and the room's accent
 * from openvibe-shared/rooms. The views themselves are the v1 placeholders (server/views/index.js): stable `sf-`
 * ids and classes, semantic HTML, readable with no script.
 *
 *   - <head>: the shared app icon, the room's stylesheets, this site's content-hashed surf.css
 *   - the navbar's session probe (/auth/me), sign-in and sign-out URLs and silent sign-in, as every site's
 *   - surf.js on every page (deferred), for the main session's progressive enhancement
 */
const shell = require('openvibe-shared/shell');
const ovServe = require('openvibe-shared/serve');
const appIcon = require('openvibe-shared/app-icon');
const kit = require('openvibe-shared/kit');
const rooms = require('openvibe-shared/rooms');
const { asset, assetVersion } = require('../assets');

const NAME = 'OpenVibe.Surf';
const NETWORK = 'https://openvibe.network';
const ROOM = rooms.get('surf');
const esc = kit.esc;

const NAV = [
    { label: 'Home', href: '/', icon: 'fa-house' },
    { label: 'Ride', href: '/ride', icon: 'fa-gamepad' },
    { label: 'Watch', href: '/watch', icon: 'fa-play' },
    { label: 'Web', href: '/web', icon: 'fa-globe' },
    { label: 'Developers', href: '/developers', icon: 'fa-code', more: true },
];

let RELEASE = 'dev';
let BASE = 'https://openvibe.surf';
function setRelease(id) { if (id) RELEASE = String(id); }
function configure({ baseUrl } = {}) { if (baseUrl) BASE = String(baseUrl).replace(/\/+$/, ''); }
const baseUrl = () => BASE;
const canonical = (p) => `${BASE}${p || '/'}`;

/** The page around a body: the shared shell with the room's stylesheets and behaviour. */
function layout({ title, description, canonical, path, robots = 'index, follow', body, active = '/', scripts = ['js/surf.js'], jsonLd = [] } = {}) {
    const pathNow = path || active || '/';
    canonical = canonical || (path ? `${BASE}${path}` : undefined);
    const navbar = {
        service: 'surf',
        apiBase: NETWORK,
        links: NAV.map((l) => ({ ...l, active: l.href === active || (l.href !== '/' && String(active).startsWith(`${l.href}/`)) })),
        // The phone app bar: the room's four places, with icons the navbar draws itself (no icon font on this site).
        appBar: [{ label: 'Home', href: '/', icon: 'fa-house' }, { label: 'Ride', href: '/ride', icon: 'fa-gamepad' }, { label: 'Watch', href: '/watch', icon: 'fa-play' }, { label: 'Web', href: '/web', icon: 'fa-globe' }],
        history: { type: 'page', title: title || NAME },
        silentLogin: `${BASE}/auth/login?silent=1&next={url}`,
        sessionUrl: '/auth/me',
        loginUrl: '/auth/login?next={path}',
        logoutUrl: '/auth/logout?next={path}',
    };
    const footer = { service: 'surf', variant: 'full', mount: '#ov-footer', brandName: NAME };
    return shell.page({
        name: NAME,
        lang: 'en',
        title: title || `${NAME}: ${ROOM.line}`,
        titleSuffix: title ? ` · ${NAME}` : '',
        siteName: NAME,
        description: description || `${ROOM.line}. Ride CS-style surf maps in the browser, surf what is live on OpenVibe.Live, and let an agent browse the web for you.`,
        canonical,
        robots,
        jsonLd,
        home: '/',
        navLinks: NAV,
        navbar,
        footer,
        head: `${appIcon.headTags({ site: 'surf' })}
<link rel="stylesheet" href="${esc(ovServe.url('kit.css'))}">
<link rel="stylesheet" href="${esc(ovServe.url('room.css'))}">
<link rel="stylesheet" href="${esc(ovServe.url('showcase.css'))}">
<link rel="stylesheet" href="${esc(asset('css/surf.css'))}">
<script src="${esc(ovServe.url('kit-web.js'))}" defer></script>
<script src="${esc(ovServe.url('motion.js'))}" defer></script>
${(scripts || []).map((rel) => `<script src="${esc(asset(rel))}" defer></script>`).join('\n')}
<meta name="ov-boost" content="surf@${esc(RELEASE)}">`,
        body: `<a class="skip" href="#main">Skip to content</a>
<div id="navbar-mount"></div>
<main id="main" class="sf ov-room" style="${rooms.style('surf')}">${body || ''}</main>
<script>window.__OV_PAGE = ${JSON.stringify({ navbar, footer, path: pathNow }).replace(/</g, '\\u003c')};
document.addEventListener('DOMContentLoaded', function () { try { if (window.OpenVibeFooter) OpenVibeFooter.init(window.__OV_PAGE.footer); } catch (e) { /* the Frame is optional */ } });</script>`,
    });
}

/**
 * Send a page; a page rendered for a signed-in person is private and never cached. A public page gets the short
 * 60-second public window the main session asked for, with Vary: Cookie because the frame differs by session.
 */
function send(res, status, html, { viewer } = {}) {
    const personal = viewer && viewer.kind === 'user';
    res.set('Cache-Control', personal ? 'private, no-store' : 'public, max-age=60');
    res.set('Vary', 'Cookie');
    res.status(status).type('html').send(html);
}

module.exports = { layout, send, setRelease, configure, baseUrl, canonical, NAME, NETWORK, ROOM, NAV, esc, asset, assetVersion };
