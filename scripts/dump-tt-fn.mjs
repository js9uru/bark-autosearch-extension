import fs from "fs";

const bg = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
const a = bg.indexOf('if(r.action==="fetchPageDataThatsThem")');
const b = bg.indexOf('if(r.action==="fetchPageDataUnite")');
const chunk = bg.slice(a, b);
const i = chunk.indexOf("func:()=>{const out");
const j = chunk.indexOf("return out}", i) + "return out}".length;
fs.writeFileSync(new URL("../scripts/_tt-fn.txt", import.meta.url), chunk.slice(i, j));
console.log("wrote", j - i);
