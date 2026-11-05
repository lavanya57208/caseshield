// Zero-dependency "copy the static bits into dist" step (no bundler installed
// in the sandbox this was authored in - see README). Plain Node, no deps.
const fs = require("fs");
const path = require("path");

const PUBLIC_DIR = path.join(__dirname, "public");
const DIST_DIR = path.join(__dirname, "dist");

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

fs.mkdirSync(DIST_DIR, { recursive: true });
copyRecursive(PUBLIC_DIR, DIST_DIR);
console.log("Copied public/ into dist/");
