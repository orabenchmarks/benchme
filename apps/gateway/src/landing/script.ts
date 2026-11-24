/**
 * The front page's one script, inline, run once the page has parsed. It filters the scenario cards as a person
 * types: a card stays when every word of the query is in what it says (its `data-search`, which the server writes
 * already normalised), the count says how many are left, and an empty result says so. `/` jumps to the search box,
 * Escape clears it, and `?q=` in the address opens the page filtered. The copy buttons copy a card's command, and
 * select it where the clipboard is refused. Without the script every card is shown and nothing is lost.
 */
export const LANDING_SCRIPT = `(function(){
var q=document.getElementById("q");if(!q)return;
var cards=Array.prototype.slice.call(document.querySelectorAll("[data-search]"));
var count=document.getElementById("count"),empty=document.getElementById("empty"),emptyQ=document.getElementById("empty-q"),said=document.getElementById("said");
var total=cards.length;
function norm(s){return String(s).toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g,"")}
function apply(){var terms=norm(q.value).split(/\\s+/).filter(Boolean),shown=0;
cards.forEach(function(c){var hay=c.getAttribute("data-search")||"";var ok=terms.every(function(t){return hay.indexOf(t)!==-1});c.hidden=!ok;if(ok)shown++});
count.textContent=(terms.length?shown+" of "+total:String(total))+(total===1?" scenario":" scenarios");
empty.hidden=shown!==0;emptyQ.textContent=q.value.trim()}
q.addEventListener("input",apply);
q.addEventListener("keydown",function(e){if(e.key==="Escape"&&q.value){q.value="";apply()}});
document.addEventListener("keydown",function(e){if(e.key!=="/"||e.ctrlKey||e.metaKey||e.altKey)return;var t=e.target;if(t&&(t.tagName==="INPUT"||t.tagName==="TEXTAREA"||t.isContentEditable))return;e.preventDefault();q.focus()});
try{var start=new URLSearchParams(location.search).get("q");if(start)q.value=start}catch(e){}
apply();
function select(el){var r=document.createRange();r.selectNodeContents(el);var s=window.getSelection();s.removeAllRanges();s.addRange(r)}
document.addEventListener("click",function(e){var b=e.target&&e.target.closest?e.target.closest("button[data-copy]"):null;if(!b)return;
var code=document.getElementById(b.getAttribute("data-copy"));if(!code)return;var what=b.getAttribute("data-what")||"the command";
function done(ok){b.textContent=ok?"Copied":"Selected";said.textContent=ok?"Copied "+what+".":"Selected "+what+": copy it with your keyboard.";setTimeout(function(){b.textContent="Copy"},2000)}
if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(code.textContent).then(function(){done(true)},function(){select(code);done(false)});
else{select(code);done(false)}})
})();`;
