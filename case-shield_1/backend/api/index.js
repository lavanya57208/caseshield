// Vercel serverless entry point.
//
// Plain CommonJS on purpose: Vercel runs it as-is instead of compiling
// src/*.ts itself, so every import goes through the compiled build in dist/
// (`npm run build` = tsc + tsc-alias, which rewrites "@/..." to relative paths).
//
// dist/server.js is the long-running entry (app.listen + signal handlers);
// Vercel owns the listener, so this exports the same Express app it starts.
const { createApp } = require("../dist/app.js");

module.exports = createApp();
