#!/usr/bin/env node
// Run the TypeScript source directly — the prototype favours one obvious source
// of truth over a build step. Swap this for a compiled dist/ if it ever ships.
require('tsx/cjs');
require('../src/main.ts').main();
