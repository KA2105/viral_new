const fs = require("fs");
const path = require("path");

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith(".json")) out.push(p);
  }
  return out;
}

const root = process.cwd();
const files = walk(root);

let hasErr = false;

for (const file of files) {
  const txt = fs.readFileSync(file, "utf8");
  try {
    JSON.parse(txt);
    console.log("OK ", file);
  } catch (e) {
    hasErr = true;
    console.log("ERR", file);
    console.log(String(e.message));
    // line/col çıkar
    const m = String(e.message).match(/position (\d+)/i);
    if (m) {
      const pos = Number(m[1]);
      const before = txt.slice(0, pos);
      const line = before.split("\n").length;
      const col = before.length - before.lastIndexOf("\n");
      console.log(`=> line ${line}, col ${col}`);
      console.log("=> around:", JSON.stringify(txt.slice(Math.max(0, pos - 40), pos + 40)));
    }
    console.log("----");
  }
}

process.exit(hasErr ? 1 : 0);
