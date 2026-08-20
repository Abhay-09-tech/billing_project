function d(t){if(t==null)return"";const n=String(t);return/[",\n\r]/.test(n)?`"${n.replaceAll('"','""')}"`:n}function l(t,n){return[t,...n].map(o=>o.map(d).join(",")).join(`\r
`)}function u(t,n,o){const r="\uFEFF"+l(n,o),s=new Blob([r],{type:"text/csv;charset=utf-8;"}),c=URL.createObjectURL(s),e=document.createElement("a");e.href=c,e.download=t.endsWith(".csv")?t:`${t}.csv`,document.body.appendChild(e),e.click(),document.body.removeChild(e),URL.revokeObjectURL(c)}export{u as d};
//# sourceMappingURL=csv-B_luEchJ.js.map
