/**
 * The pages' one script, inline, run once a page has parsed. It filters a page's list as a person types or picks:
 * an item (`[data-search]`) stays when every word of the query is in what it says (its `data-search`, which the
 * server writes already normalised) and, for each picked filter (`select[data-filter=<name>]`), its `data-<name>`
 * (space-separated values) holds the picked value. The count says how many are left (`data-noun` names them), an
 * empty result says so, `/` jumps to the search box, Escape clears it, and the address's `?q=` and filter values
 * open the page filtered. The copy buttons copy the code they name, and show and select it where the clipboard is
 * refused, so it can be copied by hand.
 * Without the script every item the server rendered stays as it was, and nothing is lost.
 */
export const LANDING_SCRIPT = `(function(){
var q=document.getElementById("q");
var items=Array.prototype.slice.call(document.querySelectorAll("[data-search]"));
var filters=Array.prototype.slice.call(document.querySelectorAll("select[data-filter]"));
var count=document.getElementById("count"),empty=document.getElementById("empty"),emptyQ=document.getElementById("empty-q"),said=document.getElementById("said");
var total=items.length,noun=count?count.getAttribute("data-noun")||"items":"items",one=count?count.getAttribute("data-one")||noun:noun;
function norm(s){return String(s).toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g,"")}
function apply(){var terms=q?norm(q.value).split(/\\s+/).filter(Boolean):[],picked=filters.filter(function(f){return f.value}),shown=0;
items.forEach(function(it){var hay=it.getAttribute("data-search")||"";var ok=terms.every(function(t){return hay.indexOf(t)!==-1})&&picked.every(function(f){var v=(it.getAttribute("data-"+f.getAttribute("data-filter"))||"").split(" ");return v.indexOf(f.value)!==-1});it.hidden=!ok;if(ok)shown++});
var narrowed=terms.length||picked.length;
if(count)count.textContent=(narrowed?shown+" of "+total:String(total))+" "+(total===1?one:noun);
if(empty){empty.hidden=shown!==0;if(emptyQ)emptyQ.textContent=q?q.value.trim():""}}
if(q){q.addEventListener("input",apply);q.addEventListener("keydown",function(e){if(e.key==="Escape"&&q.value){q.value="";apply()}})}
filters.forEach(function(f){f.addEventListener("change",apply)});
document.addEventListener("keydown",function(e){if(!q||e.key!=="/"||e.ctrlKey||e.metaKey||e.altKey)return;var t=e.target;if(t&&(t.tagName==="INPUT"||t.tagName==="TEXTAREA"||t.tagName==="SELECT"||t.isContentEditable))return;e.preventDefault();q.focus()});
try{var p=new URLSearchParams(location.search);var start=p.get("q");if(q&&start)q.value=start;filters.forEach(function(f){var v=p.get(f.getAttribute("data-filter"));if(v)f.value=v})}catch(e){}
if(items.length)apply();
function select(el){if(el.hidden)el.hidden=false;var r=document.createRange();r.selectNodeContents(el);var s=window.getSelection();s.removeAllRanges();s.addRange(r)}
document.addEventListener("click",function(e){var b=e.target&&e.target.closest?e.target.closest("button[data-copy]"):null;if(!b)return;
var code=document.getElementById(b.getAttribute("data-copy"));if(!code)return;var what=b.getAttribute("data-what")||"the command",label=b.getAttribute("data-label")||"Copy";
function done(ok){b.textContent=ok?"Copied":"Selected";if(said)said.textContent=ok?"Copied "+what+".":"Selected "+what+": copy it with your keyboard.";setTimeout(function(){b.textContent=label},2000)}
if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(code.textContent).then(function(){done(true)},function(){select(code);done(false)});
else{select(code);done(false)}})
})();`;
