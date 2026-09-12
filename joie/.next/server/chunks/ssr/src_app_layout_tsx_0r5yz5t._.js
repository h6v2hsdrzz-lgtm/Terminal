module.exports=[27572,a=>{"use strict";var b=a.i(7997);let c=`
(function () {
  try {
    var choix = localStorage.getItem("joie:theme");
    var sombre = choix ? choix === "sombre"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.classList.toggle("dark", sombre);
  } catch (e) {}
})();
`;a.s(["default",0,function({children:a}){return(0,b.jsxs)("html",{lang:"fr",suppressHydrationWarning:!0,className:"h-full antialiased",children:[(0,b.jsx)("head",{children:(0,b.jsx)("script",{dangerouslySetInnerHTML:{__html:c}})}),(0,b.jsx)("body",{className:"flex min-h-full flex-col",children:a})]})},"metadata",0,{title:"Journal de joie — Momo, Sam & Samy",description:"Suivi quotidien du niveau de joie de Momo, Sam et Samy, et mesure de l'effet des déclencheurs Biberon et Plante verte.",appleWebApp:{capable:!0,title:"Joie",statusBarStyle:"default"},icons:{icon:"/icone-192.png",apple:"/icone-apple-180.png"}},"viewport",0,{themeColor:[{media:"(prefers-color-scheme: light)",color:"#f5f3ed"},{media:"(prefers-color-scheme: dark)",color:"#10151d"}]}])},50645,function(a){a.n(a.i(27572))}];

//# sourceMappingURL=src_app_layout_tsx_0r5yz5t._.js.map