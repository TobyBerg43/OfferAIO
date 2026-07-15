#!/usr/bin/env node
/* One-off refactor: dashboard Tasks page shows Active work by default;
 * submitted / responded tasks live only in their own tabs, all tabs get counts. */
const fs = require('fs');
let h = fs.readFileSync('OfferAIO.html', 'utf8');
let n = 0;
function rep(from, to) {
  if (!h.includes(from)) throw new Error('PATCH TARGET MISSING: ' + from.slice(0, 70));
  h = h.split(from).join(to);
  n++;
}

/* 1) default tab label: All -> Active */
rep('<div class="cat on" data-f="all">All</div>',
    '<div class="cat on" data-f="all">Active</div>');

/* 2) default filter excludes finished tasks */
rep('all:()=>true,',
    "all:t=>!['submitted','reply','interview'].includes(t.status),");

/* 3) live counts on every tab */
rep("const tb=$('taskBody');tb.innerHTML='';",
    "const tb=$('taskBody');tb.innerHTML='';\n" +
    "  const FLABELS={all:'Active',running:'Running',ready:'In Review',done:'Submitted',resp:'Responses'};\n" +
    "  document.querySelectorAll('#taskTabs .cat').forEach(x=>{const f=x.dataset.f;const fn=TASK_FILTERS[f];const c=fn?tasks.filter(fn).length:tasks.length;x.textContent=FLABELS[f]+(c?' '+c:'');});");

fs.writeFileSync('OfferAIO.html', h);
console.log('patched OfferAIO.html (' + n + ' replacements)');
