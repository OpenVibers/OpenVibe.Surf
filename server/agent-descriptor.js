'use strict';
// What OpenVibe.Surf tells an agent about itself (openvibe-shared/agent-layer): /.well-known/agent.json (SEO-2).
// Every field is something this site really serves; the purpose is its own llms.txt summary.
module.exports = {
    id: "surf",
    name: "OpenVibe.Surf",
    purpose: "Ride CS-style surf maps in the browser, surf live streams, clips and AI moments, and let an agent surf the web for you with its sources cited.",
    home: "https://openvibe.surf",
    site: "openvibe.surf",
    api: "/api/v1",
    docs: "/developers",
    policy: {
        auth: ["none"],
    },
};
