/**
 * Restores fetchPageData (ZabaSearch) if missing — required by sidebar-zabasearch.js.
 */
import fs from "fs";

const path = new URL("../background.js", import.meta.url);
let bg = fs.readFileSync(path, "utf8");

if (bg.includes('if(r.action==="fetchPageData"){')) {
  console.log("fetchPageData already present");
  process.exit(0);
}

const zaba =
  'if(r.action==="fetchPageData"){chrome.tabs.query({url:"https://www.zabasearch.com/*"},async e=>{let t;if(e.length===0){t=await chrome.tabs.create({url:"https://www.zabasearch.com/",active:!1});await new Promise(a=>{const o=(n,i)=>{if(n===t.id&&i.status==="complete"){chrome.tabs.onUpdated.removeListener(o);a()}};chrome.tabs.onUpdated.addListener(o);chrome.tabs.get(t.id,n=>{if(n?.status==="complete"){chrome.tabs.onUpdated.removeListener(o);a()}})})}else t=e[0];await chrome.tabs.update(t.id,{url:r.url});await new Promise(a=>{const o=(n,i)=>{if(n===t.id&&i.status==="complete"){chrome.tabs.onUpdated.removeListener(o);a()}};chrome.tabs.onUpdated.addListener(o);chrome.tabs.get(t.id,n=>{if(n?.status==="complete"){chrome.tabs.onUpdated.removeListener(o);a()}})});await new Promise(a=>{const o=setInterval(()=>{chrome.scripting.executeScript({target:{tabId:t.id},func:()=>!!document.querySelector(".containerbody")},n=>{if(n?.[0]?.result){clearInterval(o);a()}})},200)});chrome.scripting.executeScript({target:{tabId:t.id},func:()=>{const e=document.querySelectorAll(".person"),t=[];for(let r=0;r<e.length;r++){try{const a=e[r].querySelectorAll(".section-box.flex.column-2");if(a.length>0){const o=a[0].querySelectorAll("ul.showMore-list");if(o.length>1){const n=o[1].querySelectorAll("li");t.push(...Array.from(n).map(i=>i.textContent.trim()))}}}catch{}}return t}},a=>{a?.[0]?c({data:a[0].result}):c({data:[]})})});return true}';

const needle = 'if(r.action==="fetchPageDataThatsThem"){';
if (!bg.includes(needle)) {
  throw new Error("fetchPageDataThatsThem block not found; cannot anchor zaba insert");
}

bg = bg.replace(needle, zaba + needle);

fs.writeFileSync(path, bg);
new Function(bg);
console.log("zaba fetchPageData restored");
