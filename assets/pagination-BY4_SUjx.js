import{j as s}from"./query-ChRcmyIl.js";import{c,B as i}from"./index-BDsC3lHm.js";/**
 * @license lucide-react v0.469.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const o=c("ChevronLeft",[["path",{d:"m15 18-6-6 6-6",key:"1wnfg3"}]]);/**
 * @license lucide-react v0.469.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const x=c("ChevronRight",[["path",{d:"m9 18 6-6-6-6",key:"mthhwq"}]]);function u({page:e,pageSize:t,total:n,onPageChange:r}){const a=Math.max(1,Math.ceil(n/t));if(a<=1)return null;const l=e*t+1,m=Math.min(n,(e+1)*t);return s.jsxs("div",{className:"flex items-center justify-between gap-3 border-t border-cream-200 px-4 py-3",children:[s.jsxs("p",{className:"text-sm text-brand-600 tabular-nums",children:[l,"–",m," of ",n]}),s.jsxs("div",{className:"flex items-center gap-1",children:[s.jsx(i,{variant:"outline",size:"sm",disabled:e===0,onClick:()=>r(e-1),"aria-label":"Previous page",children:s.jsx(o,{className:"h-4 w-4"})}),s.jsxs("span",{className:"px-2 text-sm text-brand-700 tabular-nums",children:[e+1," / ",a]}),s.jsx(i,{variant:"outline",size:"sm",disabled:e>=a-1,onClick:()=>r(e+1),"aria-label":"Next page",children:s.jsx(x,{className:"h-4 w-4"})})]})]})}export{u as P};
//# sourceMappingURL=pagination-BY4_SUjx.js.map
