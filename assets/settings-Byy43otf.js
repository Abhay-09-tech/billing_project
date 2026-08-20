import{s as r}from"./index-BDsC3lHm.js";async function a(n){const{data:e,error:t}=await r.from("settings").select("value").eq("key",n).maybeSingle();if(t)throw t;return(e==null?void 0:e.value)??null}async function o(n,e){const{error:t}=await r.from("settings").update({value:e}).eq("key",n);if(t)throw t}export{a as g,o as u};
//# sourceMappingURL=settings-Byy43otf.js.map
