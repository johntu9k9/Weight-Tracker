// reconstruct the previously deployed bundle from git HEAD, to verify it matches the deployed hash
const { execSync } = require("child_process"), fs = require("fs");
const html = execSync("git show HEAD:src/index.html", { maxBuffer: 1e8 }).toString();
let js = execSync("git show HEAD:src/index.js", { maxBuffer: 1e8 }).toString();
js = js.replace('import PAGE from "./index.html";\n\n', `const PAGE = ${JSON.stringify(html)};\n`);
fs.writeFileSync(process.argv[2], js);
console.log(js.length, require("crypto").createHash("sha256").update(js).digest("hex").slice(0, 16));
