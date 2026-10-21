export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const hex = (v, n = 2) => v == null ? '-'.repeat(n) : (v >>> 0).toString(16).toUpperCase().padStart(n, '0');
export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const NS = 'http://www.w3.org/2000/svg';
export function S(tag, attrs = {}, parent, text) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}
export const cssVar = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
// « &4000 », « #4000 », « $4000 », « 0x4000 », « 4000h » ou décimal
export function parseNum(s) {
  s = String(s).trim();
  let m;
  if ((m = s.match(/^(?:&|#|\$|0x)([0-9a-f]+)$/i))) return parseInt(m[1], 16);
  if ((m = s.match(/^([0-9][0-9a-f]*)h$/i))) return parseInt(m[1], 16);
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (/^[0-9a-f]+$/i.test(s)) return parseInt(s, 16);
  return NaN;
}
