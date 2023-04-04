import{noChange as t}from"../lit-html.js";import{isPrimitive as s}from"../directive-helpers.js";import{AsyncDirective as i}from"../async-directive.js";import{PseudoWeakRef as r,Pauser as e}from"./private-async-helpers.js";import{directive as o}from"../directive.js";
/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const n=t=>!s(t)&&"function"==typeof t.then,h=1073741823;class c extends i{constructor(){super(...arguments),this._$Cwt=h,this._$Cyt=[],this._$CK=new r(this),this._$CX=new e}render(...s){var i;return null!==(i=s.find((t=>!n(t))))&&void 0!==i?i:t}update(s,i){const r=this._$Cyt;let e=r.length;this._$Cyt=i;const o=this._$CK,c=this._$CX;this.isConnected||this.disconnected();for(let t=0;t<i.length&&!(t>this._$Cwt);t++){const s=i[t];if(!n(s))return this._$Cwt=t,s;t<e&&s===r[t]||(this._$Cwt=h,e=0,Promise.resolve(s).then((async t=>{for(;c.get();)await c.get();const i=o.deref();if(void 0!==i){const r=i._$Cyt.indexOf(s);r>-1&&r<i._$Cwt&&(i._$Cwt=r,i.setValue(t))}})))}return t}disconnected(){this._$CK.disconnect(),this._$CX.pause()}reconnected(){this._$CK.reconnect(this),this._$CX.resume()}}const m=o(c);export{c as UntilDirective,m as until};
//# sourceMappingURL=until.js.map
