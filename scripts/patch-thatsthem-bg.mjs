/**
 * Inserts fetchPageDataThatsThem into background.js before fetchPageDataUnite (if missing).
 */
import fs from "fs";

function compactJs(src) {
  return src
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\r?\n\s*/g, "")
    .trim()
    .replace(/\(\)\s*=>\s*\{/g, "()=>{");
}

const path = new URL("../background.js", import.meta.url);
let bg = fs.readFileSync(path, "utf8");

const needle = 'if(r.action==="fetchPageDataUnite")return(async()=>{';
if (!bg.includes(needle)) {
  throw new Error("needle fetchPageDataUnite not found");
}

const inner = compactJs(
  fs.readFileSync(new URL("../thatsthem-inject-body.js", import.meta.url), "utf8")
);

const block =
  'if(r.action==="fetchPageDataThatsThem"){chrome.tabs.query({url:"https://thatsthem.com/*"},async e=>{let t;if(e.length===0){t=await chrome.tabs.create({url:"https://thatsthem.com/",active:!1});await new Promise(a=>{const o=(n,i)=>{if(n===t.id&&i.status==="complete"){chrome.tabs.onUpdated.removeListener(o);a()}};chrome.tabs.onUpdated.addListener(o);chrome.tabs.get(t.id,n=>{if(n?.status==="complete"){chrome.tabs.onUpdated.removeListener(o);a()}})})}else t=e[0];await chrome.tabs.update(t.id,{url:r.url});await new Promise(a=>{const o=(n,i)=>{if(n===t.id&&i.status==="complete"){chrome.tabs.onUpdated.removeListener(o);a()}};chrome.tabs.onUpdated.addListener(o);chrome.tabs.get(t.id,n=>{if(n?.status==="complete"){chrome.tabs.onUpdated.removeListener(o);a()}})});await new Promise(a=>{let w=0;const o=setInterval(()=>{chrome.scripting.executeScript({target:{tabId:t.id},func:()=>{if(document.readyState!=="complete")return!1;const b=document.body;if(!b||!b.innerText)return!1;const h=document.querySelector("h1");return!!(h&&/results\\s+for/i.test(h.textContent||""))&&(b.innerText.includes("@")||/\\d[\\d\\s().*\\-]{8,}/.test(b.innerText))}},n=>{if(n&&n[0]&&n[0].result){clearInterval(o);a();return}if(++w>70){clearInterval(o);a()}})},200)});await new Promise(P=>setTimeout(P,900));chrome.scripting.executeScript({target:{tabId:t.id},func:' +
  inner +
  "},a=>{a&&a[0]?c({data:a[0].result}):c({data:[]})})});return true}";

if (bg.includes("fetchPageDataThatsThem")) {
  const start = 'if(r.action==="fetchPageDataThatsThem"){';
  const si = bg.indexOf(start);
  const ei = bg.indexOf(needle);
  if (si === -1 || ei === -1 || ei <= si) {
    throw new Error("ThatsThem block boundaries not found for refresh");
  }
  bg = bg.slice(0, si) + block + bg.slice(ei);
  fs.writeFileSync(path, bg);
  new Function(bg);
  console.log("refreshed ThatsThem inject, chars", inner.length);
  process.exit(0);
}

bg = bg.replace(needle, block + needle);

fs.writeFileSync(path, bg);
new Function(bg);
console.log("patched + syntax ok, inject chars", inner.length);
