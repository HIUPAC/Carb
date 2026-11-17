import{t as __testT,languageControl as __testLanguageControl,getLanguage as __testLocale}from"./test-i18n.js";
import{Dn as e,Sn as t,va as n,vn as r,xa as i}from"./index-dY3kjCLH.js";import{Tt as a,a as o,c as s,ct as c,i as l,n as u,o as d,s as f,t as p,ut as m}from"./WorkerPoolContext-Mdd0GPQm.js";var h=e();function g(e,t){return typeof window>`u`&&t!=null?(0,h.jsxs)(h.Fragment,{children:[(0,h.jsx)(`template`,{shadowrootmode:`open`,dangerouslySetInnerHTML:{__html:t}}),e]}):(0,h.jsx)(h.Fragment,{children:e})}var _=i(n(),1),v=(0,_.createContext)(void 0);function y(){return(0,_.useContext)(v)}var b=typeof window>`u`?_.useEffect:_.useLayoutEffect;function x({fileDiff:e,options:t,editorOptions:n,lineAnnotations:r,selectedLines:i,prerenderedHTML:a,metrics:c,hasGutterRenderUtility:l,hasCustomHeader:u,disableWorkerPool:h,edit:g}){let v=y(),x=i!==void 0,C=(0,_.useContext)(p),w=o(),T=(0,_.useRef)(null),E=d(n=>{if(n!=null){if(T.current!=null)throw Error(`useFileDiffInstance: An instance should not already exist when a node is created`);v==null?T.current=new s(S({controlledSelection:x,hasCustomHeader:u,hasGutterRenderUtility:l,options:t}),h?void 0:C,!0):T.current=new f(S({controlledSelection:x,hasCustomHeader:u,hasGutterRenderUtility:l,options:t}),v,c,h?void 0:C,!0),T.current.hydrate({fileDiff:e,fileContainer:n,lineAnnotations:r,prerenderedHTML:a})}else{if(T.current==null)throw Error(`useFileDiffInstance: A FileDiff instance should exist when unmounting`);T.current.cleanUp(),T.current=null}});return b(()=>{let{current:n}=T;if(n==null)return;let a=S({controlledSelection:x,hasCustomHeader:u,hasGutterRenderUtility:l,options:t}),o=a!==void 0&&!m(n.options,a);n.setOptions(a),n.render({forceRender:o,fileDiff:e,lineAnnotations:r}),i!==void 0&&n.setSelectedLines(i)}),b(()=>{if(g&&T.current!=null){if(w===void 0)throw Error(`FileDiff: EditContext is not attached`);let e=w(n??{});if(e==null)throw Error(`FileDiff: EditProvider.createEditor must return an editor instance`);try{return e.edit(T.current)}catch(t){throw e.cleanUp(),t}}},[g]),{ref:E,getHoveredLine:(0,_.useCallback)(()=>T.current?.getHoveredLine(),[])}}function S({options:e,controlledSelection:t,hasCustomHeader:n,hasGutterRenderUtility:r}){return t||r||n?{...e,controlledSelection:t,renderCustomHeader:n?l:e?.renderCustomHeader,renderGutterUtility:r?l:e?.renderGutterUtility}:e}function C({fileDiff:e,options:t,editorOptions:n,metrics:r,lineAnnotations:i,selectedLines:o,className:s,style:c,prerenderedHTML:l,renderAnnotation:d,renderCustomHeader:f,renderHeaderPrefix:p,renderHeaderFilenameSuffix:m,renderHeaderMetadata:_,renderGutterUtility:v,disableWorkerPool:y=!1,edit:b=!1}){let{ref:S,getHoveredLine:C}=x({fileDiff:e,options:t,editorOptions:n,metrics:r,lineAnnotations:i,selectedLines:o,prerenderedHTML:l,hasGutterRenderUtility:v!=null,hasCustomHeader:f!=null,disableWorkerPool:y,edit:b});return(0,h.jsx)(a,{ref:S,className:s,style:c,children:g(u({fileDiff:e,renderCustomHeader:f,renderHeaderPrefix:p,renderHeaderFilenameSuffix:m,renderHeaderMetadata:_,renderAnnotation:d,renderGutterUtility:v,lineAnnotations:i,getHoveredLine:C}),l)})}function w(e){let t=e.previousPath??e.path;return`--- ${e.status===`added`?`/dev/null`:t}\n+++ ${e.status===`removed`?`/dev/null`:e.path}\n${e.patch??``}`}var T=`
  :host {
    --diffs-font-family: var(--font-mono);
    --diffs-header-font-family: var(--font-ui);
    --diffs-font-size: var(--t-xs);
    --diffs-line-height: 22px;
    --diffs-light-bg: var(--chrome-recessed);
    --diffs-dark-bg: var(--chrome-recessed);
    --diffs-light: var(--text-2);
    --diffs-dark: var(--text-2);
    --diffs-addition-color: var(--success);
    --diffs-deletion-color: var(--error);
    --diffs-modified-color: var(--attention);
    --diffs-selection-base: var(--surface-2);
    --diffs-bg-context-override: var(--chrome-recessed);
    --diffs-bg-context-gutter-override: color-mix(in srgb, var(--surface-2) 72%, var(--chrome-recessed));
    --diffs-bg-separator-override: var(--surface-2);
    --diffs-fg-number-override: var(--text-3);
    --diffs-gap-inline: 8px;
    --diffs-gap-block: 6px;
    background: var(--chrome-recessed);
  }

  [data-separator] {
    border-block-color: var(--line);
  }

  [data-line-annotation],
  [data-gutter-buffer='annotation'] {
    --diffs-annotation-bg: var(--bg);
  }

  [data-gutter-utility-slot] {
    align-items: center;
    justify-content: flex-start;
    left: 0;
    right: auto;
    padding-left: 7px;
  }

  [data-utility-button] {
    width: 20px;
    height: 20px;
    margin: 0;
    background: color-mix(in srgb, var(--surface-2) 82%, transparent);
    border: 1px solid var(--line-strong);
    border-radius: var(--r-md);
    box-shadow: none;
    color: var(--text-2);
    transition:
      background var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  [data-utility-button]:hover,
  [data-utility-button]:focus-visible {
    background: var(--surface-3);
    border-color: var(--line-strong);
    color: var(--text);
  }

  [data-utility-button]:focus-visible {
    outline: 1px solid var(--line-strong);
    outline-offset: 1px;
  }
`;function E(e){let[n,i]=(0,_.useState)(),a=(0,_.useRef)(e.cacheKey);a.current=e.cacheKey;let o=n===e.cacheKey,s=(0,_.useMemo)(()=>D(e.file,e.cacheKey),[e.cacheKey,e.file]),c=globalThis.document?.documentElement.dataset.theme===`light`?`light`:`dark`,l=(0,_.useMemo)(()=>({diffStyle:`unified`,diffIndicators:`bars`,disableFileHeader:!0,hunkSeparators:`line-info-basic`,lineDiffType:`word-alt`,overflow:`scroll`,preferredHighlighter:`shiki-js`,theme:{dark:`github-dark`,light:`github-light`},themeType:c,unsafeCSS:T,lineHoverHighlight:`line`,enableGutterUtility:!0,onGutterUtilityClick:t=>{e.onCommentLine({lineNumber:t.start,side:t.side===`deletions`?`deletions`:`additions`})},onPostRender:(e,t,n)=>{n!==`unmount`&&e.shadowRoot?.querySelector(`pre > *, [data-error-wrapper]`)&&i(a.current)}}),[e.onCommentLine,c]);return s?(0,h.jsxs)(`div`,{className:o?`pr-diffs-frame is-ready`:`pr-diffs-frame`,children:[(0,h.jsx)(C,{fileDiff:s,options:l,selectedLines:null,lineAnnotations:e.annotations,renderAnnotation:e.renderAnnotation,className:`pr-diffs-renderer`,disableWorkerPool:!0}),o?null:(0,h.jsx)(t,{label:(__testT("Preparing diff")),className:`pr-diffs-loading`,children:(0,h.jsx)(r,{lines:5,gutter:!0})})]}):(0,h.jsx)(`div`,{className:`pr-diffs-error`,children:(__testT("Diffs could not parse this patch."))})}function D(e,t){try{let n=c(w(e),t,!0);return n.length===1&&n[0]?.files.length===1?n[0].files[0]:void 0}catch{return}}export{E as PullRequestDiffRenderer};