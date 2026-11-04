// Builds dist/worker.js: one self-contained ES module (page + assets inlined) for API-based deploys.
// Normal deploys just use `wrangler deploy`; this exists for deploying without wrangler.
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "src/index.html"), "utf8");
const assets = fs.readFileSync(path.join(root, "src/assets.js"), "utf8").replace(/^export /gm, "");
let js = fs.readFileSync(path.join(root, "src/index.js"), "utf8");
js = js.replace('import PAGE from "./index.html";\n', `const PAGE = ${JSON.stringify(html)};\n`)
       .replace(/import \{[^}]*\} from "\.\/assets\.js";\n/, assets + "\n");
if (/^import /m.test(js)) throw new Error("unresolved import");
fs.mkdirSync(path.join(root, "dist"), { recursive: true });
fs.writeFileSync(path.join(root, "dist/worker.js"), js);
const hash = require("crypto").createHash("sha256").update(js).digest("hex").slice(0, 16);
const N = 14000, parts = Math.ceil(js.length / N);
for (let i = 0; i < parts; i++) fs.writeFileSync(path.join(root, `dist/chunk${i + 1}.json`), JSON.stringify(js.slice(i * N, (i + 1) * N)));
for (let i = parts; i < 12; i++) fs.rmSync(path.join(root, `dist/chunk${i + 1}.json`), { force: true });
console.log(JSON.stringify({ length: js.length, hash, parts }));
