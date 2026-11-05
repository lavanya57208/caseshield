import fs from "fs";
import path from "path";

/**
 * Minimal .env loader (no external dependency). Reads KEY=VALUE lines from a
 * .env file at the project root and applies any key not already set in
 * process.env. Silently does nothing if no .env file is present - the app
 * runs on its built-in defaults either way.
 */
export function loadEnv() {
  const envPath = path.join(__dirname, "..", "..", ".env");
  if (!fs.existsSync(envPath)) return;
  const contents = fs.readFileSync(envPath, "utf-8");
  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
