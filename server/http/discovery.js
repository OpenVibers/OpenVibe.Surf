'use strict';

/**
 * Crawl artifacts for openvibe.surf, built with openvibe-shared/seo: robots.txt, sitemap.xml and llms.txt.
 * The public pages are for search engines and AI crawlers; the API, sign-in and the form that creates a task are
 * not. The sitemap adds one page per surf map while Games lists them; a Games failure leaves the static pages in
 * place rather than failing the crawl artifact.
 */
const fs = require('fs');
const path = require('path');
const seo = require('openvibe-shared/seo');
const { asyncRouter } = require('./router');

const SITE_NAME = 'OpenVibe.Surf';
const DESCRIPTION = 'Ride maps, surf the web, surf what\'s on. OpenVibe.Surf is the Surf room of the OpenVibe network: ride CS-style surf maps in the browser (OpenVibe.Games), lean back and surf live streams, clips and AI moments (OpenVibe.Live), and let an agent browse the web for you on a private desk (OpenVibe.Actor).';
const DISALLOW = ['/auth/', '/api/', '/web/go'];

function dayOf(ts) {
    const m = String(ts == null ? '' : ts).match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
}
function siteUpdated() {
    try { return dayOf(JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'STATUS.json'), 'utf8')).updated); } catch { return null; }
}

/** Every public page, in the order a crawler should read them. */
function publicPages(maps = []) {
    const static_ = [
        { path: '/', changefreq: 'weekly', priority: 1.0, title: 'OpenVibe.Surf', text: 'Ride CS-style surf maps in the browser, watch live streams, clips and AI moments, and surf the web with an agent.' },
        { path: '/ride', changefreq: 'weekly', priority: 0.9, title: 'Ride', text: 'The OpenVibe.Games surf map catalogue, with each map’s stages, records and in-browser embed.' },
        { path: '/watch', changefreq: 'hourly', priority: 0.9, title: 'Watch', text: 'Live streams, clips people cut and the AI moments of the week, merged into one lean-back feed from OpenVibe.Live.' },
        { path: '/web', changefreq: 'monthly', priority: 0.8, title: 'Surf with Vibe', text: 'Ask an agent to browse the web for you: it searches, reads pages, keeps its sources and finishes with a cited report.' },
        { path: '/developers', changefreq: 'monthly', priority: 0.5, title: 'The Surf API', text: 'The Watch feed, the Ride maps proxy and the Web task route.' },
    ];
    const mapPages = (Array.isArray(maps) ? maps : []).filter((m) => m && m.id).map((m) => ({
        path: `/ride/${encodeURIComponent(String(m.id))}`,
        changefreq: 'monthly',
        priority: 0.6,
        title: String(m.name || m.id),
        text: `${String(m.name || m.id)}: a ${String(m.tier === 1 ? 'beginner' : m.tier === 2 ? 'intermediate' : 'advanced')} surf map with ${m.stages == null ? 'several' : String(m.stages)} stages${m.records != null ? ` and ${String(m.records)} recorded runs` : ''}.`,
    }));
    return [...static_, ...mapPages];
}

function createDiscoveryRoutes(ctx) {
    const { config, ride } = ctx;
    const r = asyncRouter();
    const site = String(config.baseUrl).replace(/\/+$/, '');
    const abs = (p) => `${site}${p}`;
    const TEXT = 'public, max-age=3600';

    async function maps() {
        try { const list = await ride.maps(); return list.maps || []; } catch { return []; }
    }

    r.get('/robots.txt', async (_req, res) => {
        res.type('text/plain').set('Cache-Control', TEXT).send(
            '# openvibe.surf: the public pages are for search and AI crawlers; sign-in, the API and the task form are not.\n'
            + seo.robotsTxt({ sitemaps: [abs('/sitemap.xml')], disallow: DISALLOW }));
    });

    r.get('/llms.txt', async (_req, res) => {
        res.type('text/plain').set('Cache-Control', TEXT).send(seo.llmsTxt({
            name: SITE_NAME,
            summary: DESCRIPTION,
            details: 'The pages here are server-rendered and readable without JavaScript. Ride is a proxy to OpenVibe.Games, Watch merges OpenVibe.Live’s live, clip and moment feeds, and Web creates one OpenVibe.Actor task with the signed-in person’s own Network token.',
            sections: [
                { title: 'Start here', links: [
                    { title: 'OpenVibe.Surf', url: abs('/'), note: 'the three surfs' },
                    { title: 'Ride', url: abs('/ride'), note: 'CS-style surf maps from OpenVibe.Games' },
                    { title: 'Watch', url: abs('/watch'), note: 'live streams, clips and AI moments from OpenVibe.Live' },
                    { title: 'Surf with Vibe', url: abs('/web'), note: 'an agent browses the web for you and cites its sources' },
                    { title: 'For developers', url: abs('/developers'), note: 'the Watch, Ride and Web endpoints' },
                ] },
                { title: 'Machine-readable', links: [
                    { title: 'The Watch feed (JSON)', url: abs('/api/v1/watch/feed?topic=all'), note: 'public, cached 30 seconds' },
                    { title: 'The Ride maps (JSON)', url: abs('/api/v1/ride/maps'), note: 'public, cached 60 seconds' },
                    { title: 'Sitemap', url: abs('/sitemap.xml') },
                    { title: 'Release metadata (JSON)', url: abs('/release.json') },
                ] },
                { title: 'Elsewhere', links: [
                    { title: 'OpenVibe.Live', url: 'https://openvibe.live', note: 'what Watch surfs' },
                    { title: 'OpenVibe.Games', url: 'https://openvibe.games', note: 'what Ride plays' },
                    { title: 'OpenVibe.Actor', url: 'https://openvibe.actor', note: 'who browses the web for Web' },
                ] },
            ],
        }));
    });

    r.get('/sitemap.xml', async (_req, res) => {
        const pages = publicPages(await maps());
        const lastmod = siteUpdated();
        const urls = pages.map((e) => ({ loc: abs(e.path), ...(lastmod ? { lastmod } : {}), changefreq: e.changefreq, priority: e.priority }));
        res.type('application/xml').set('Cache-Control', TEXT).send(seo.sitemapXml(urls));
    });

    return r;
}

module.exports = { createDiscoveryRoutes, publicPages, DESCRIPTION, SITE_NAME, DISALLOW };
