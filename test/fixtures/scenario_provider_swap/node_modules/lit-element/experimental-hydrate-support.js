import{render as t}from"lit-html";import{hydrate as i}from"lit-html/experimental-hydrate.js";import{HYDRATE_INTERNALS_ATTR_PREFIX as s}from"@lit-labs/ssr-dom-shim";
/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
globalThis.litElementHydrateSupport=({LitElement:h})=>{const e=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(h),"observedAttributes").get;Object.defineProperty(h,"observedAttributes",{get(){return[...e.call(this),"defer-hydration"]}});const o=h.prototype.attributeChangedCallback;h.prototype.attributeChangedCallback=function(t,i,s){"defer-hydration"===t&&null===s&&n.call(this),o.call(this,t,i,s)};const n=h.prototype.connectedCallback;h.prototype.connectedCallback=function(){this.hasAttribute("defer-hydration")||n.call(this)};const r=h.prototype.createRenderRoot;h.prototype.createRenderRoot=function(){return this.shadowRoot?(this._$AG=!0,this.shadowRoot):r.call(this)};const c=Object.getPrototypeOf(h.prototype).update;h.prototype.update=function(h){const e=this.render();if(c.call(this,h),this._$AG){this._$AG=!1;for(let t=0;t<this.attributes.length;t++){const i=this.attributes[t];if(i.name.startsWith(s)){const t=i.name.slice(s.length);this.removeAttribute(t),this.removeAttribute(i.name)}}i(e,this.renderRoot,this.renderOptions)}else t(e,this.renderRoot,this.renderOptions)}};
//# sourceMappingURL=experimental-hydrate-support.js.map
