import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = resolve(root, "dist");
const distDir = resolve(distRoot, "FlowTools");
const zipPath = resolve(distRoot, "FlowTools-obfuscated.zip");

function ensureInsideRoot(path) {
  const relative = path.slice(root.length);
  if (!path.startsWith(root) || relative.includes("..")) {
    throw new Error(`Unsafe path outside project root: ${path}`);
  }
}

function run(command, args) {
  const isCmdShim = process.platform === "win32" && command.toLowerCase().endsWith(".cmd");
  const file = isCmdShim ? "cmd.exe" : command;
  const finalArgs = isCmdShim ? ["/d", "/s", "/c", command, ...args] : args;

  execFileSync(file, finalArgs, {
    cwd: root,
    stdio: "inherit",
    windowsHide: true
  });
}

function obfuscate(input, output) {
  run("npx.cmd", [
    "javascript-obfuscator",
    input,
    "--output",
    output,
    "--compact",
    "true",
    "--control-flow-flattening",
    "true",
    "--control-flow-flattening-threshold",
    "0.75",
    "--dead-code-injection",
    "true",
    "--dead-code-injection-threshold",
    "0.25",
    "--identifier-names-generator",
    "hexadecimal",
    "--rename-globals",
    "false",
    "--string-array",
    "true",
    "--string-array-calls-transform",
    "true",
    "--string-array-calls-transform-threshold",
    "0.75",
    "--string-array-encoding",
    "rc4",
    "--string-array-indexes-type",
    "hexadecimal-number",
    "--string-array-rotate",
    "true",
    "--string-array-shuffle",
    "true",
    "--string-array-threshold",
    "1",
    "--split-strings",
    "true",
    "--split-strings-chunk-length",
    "8",
    "--transform-object-keys",
    "true",
    "--unicode-escape-sequence",
    "false",
    "--self-defending",
    "false",
    "--disable-console-output",
    "false"
  ]);
}

ensureInsideRoot(distRoot);
ensureInsideRoot(distDir);
ensureInsideRoot(zipPath);

mkdirSync(distRoot, { recursive: true });
rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

copyFileSync(resolve(root, "manifest.json"), resolve(distDir, "manifest.json"));
copyFileSync(resolve(root, "styles.css"), resolve(distDir, "styles.css"));

obfuscate("background.js", "dist/FlowTools/background.js");
obfuscate("content.js", "dist/FlowTools/content.js");
obfuscate("protection.js", "dist/FlowTools/protection.js");

run("node", ["--check", "dist/FlowTools/background.js"]);
run("node", ["--check", "dist/FlowTools/content.js"]);
run("node", ["--check", "dist/FlowTools/protection.js"]);

rmSync(zipPath, { force: true });
run("powershell", [
  "-NoProfile",
  "-Command",
  "Compress-Archive -Path dist\\FlowTools\\* -DestinationPath dist\\FlowTools-obfuscated.zip -Force"
]);

console.log("Built dist/FlowTools");
console.log(`Zip size: ${statSync(zipPath).size} bytes`);
