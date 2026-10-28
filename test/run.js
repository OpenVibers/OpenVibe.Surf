#!/usr/bin/env node
/**
 * Runs every test/*.test.js in its own process and fails if any fails. Each file boots OpenVibe.Surf against
 * in-process Network/Live/Games/Actor stand-ins (test/helpers/); none needs the internet or a running site.
 *
 *   npm test                 # everything
 *   npm test -- watch        # only files whose name contains one of the words
 *   npm test -- --strict     # a skipped test fails the run too
 */
'use strict';
const { run } = require('openvibe-shared/test-runner');

// VERBOSE=1 also prints every file's output, then the summary again.
run({ dir: __dirname, timeoutMs: 60_000, pad: 34, parallel: 1 }).then((r) => {
    if (process.env.VERBOSE) {
        for (const t of r.results) console.log(`\n── ${t.file} ──\n${t.output.trimEnd()}`);
        console.log(`\n${r.summary}`);
    }
    process.exit(r.exitCode);
}, (err) => { console.error(err); process.exit(1); });
