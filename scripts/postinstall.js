/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

// `lamejs` publishes a modular build that references globals, but `lame.all.js`
// is self-contained. We patch it to export `module.exports = lamejs;` so our
// app can `import("lamejs/lame.all.js")` safely (for MP3 voice notes).
const targetPath = path.join(__dirname, "..", "node_modules", "lamejs", "lame.all.js");

function patchLameAllJs(source) {
  if (source.includes("module.exports = lamejs")) {
    return source;
  }

  // Prefer inserting right after the existing `lamejs();` call.
  const inserted = source.replace(/\n?lamejs\(\);\s*$/m, (match) => `${match}\nmodule.exports = lamejs;\n`);
  if (inserted !== source) {
    return inserted;
  }

  return `${source}\nmodule.exports = lamejs;\n`;
}

try {
  execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["prisma", "generate"], {
    cwd: path.join(__dirname, ".."),
    stdio: "inherit",
  });
} catch (error) {
  const message = error && typeof error === "object" && "message" in error ? String(error.message) : String(error);
  console.log(`[postinstall] prisma generate skipped: ${message}`);
}

try {
  if (!fs.existsSync(targetPath)) {
    process.exit(0);
  }
  const original = fs.readFileSync(targetPath, "utf8");
  const patched = patchLameAllJs(original);
  if (patched !== original) {
    fs.writeFileSync(targetPath, patched, "utf8");
    console.log("[postinstall] Patched lamejs/lame.all.js to export module.exports.");
  }
} catch (error) {
  const message = error && typeof error === "object" && "message" in error ? String(error.message) : String(error);
  console.log(`[postinstall] lamejs patch skipped: ${message}`);
}
