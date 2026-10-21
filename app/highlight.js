import { esc } from './util.js';

const MNEM = new Set('LD LDI LDIR LDD LDDR PUSH POP EX EXX ADD ADC SUB SBC AND OR XOR CP INC DEC DAA CPL NEG CCF SCF NOP HALT DI EI IM RLCA RLA RRCA RRA RLC RL RRC RR SLA SRA SLL SL1 SRL BIT SET RES JP JR DJNZ CALL RET RETI RETN RST IN OUT OTIR INIR OTDR INDR OUTI OUTD INI IND CPI CPIR CPD CPDR RLD RRD'.split(' '));
const DIRS = new Set('ORG EQU DB DW DS DEFB DEFW DEFS DM DEFM END INCLUDE ALIGN'.split(' '));
const REGS = new Set("A B C D E H L F AF BC DE HL IX IY SP I R AF' IXH IXL IYH IYL HX LX HY LY Z NZ NC PO PE P M".split(' '));

// Colors one source line; `symbols` = set of known names (upper case)
export function highlight(line, symbols = new Set()) {
  let code = line, comment = '', inStr = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') inStr = !inStr;
    if (line[i] === ';' && !inStr) { code = line.slice(0, i); comment = line.slice(i); break; }
  }
  let out = '';
  const re = /("[^"]*"?|'[^']'|&[0-9A-Fa-f]+|#[0-9A-Fa-f]+|\$[0-9A-Fa-f]+|%[01]+|0x[0-9A-Fa-f]+|\b\d[0-9A-Fa-f]*[hH]?\b|[A-Za-z_.][A-Za-z0-9_.']*:?|\s+|.)/g;
  let m;
  while ((m = re.exec(code))) {
    const tok = m[0], up = tok.toUpperCase();
    let cls = '';
    if (/^\s+$/.test(tok)) { out += tok; continue; }
    if (tok[0] === '"' || (tok[0] === "'" && tok.length === 3)) cls = 's';
    else if (/^[&#$%]|^0x|^\d/i.test(tok)) cls = 'n';
    else if (tok.endsWith(':') || (m.index === 0 && /^[A-Za-z_.]/.test(tok))) cls = 'l';
    else if (MNEM.has(up)) cls = 'm';
    else if (DIRS.has(up)) cls = 'd';
    else if (REGS.has(up)) cls = 'r';
    else if (symbols.has(up)) cls = 'y';
    out += cls ? `<span class="tk-${cls}">${esc(tok)}</span>` : esc(tok);
  }
  if (comment) out += `<span class="tk-c">${esc(comment)}</span>`;
  return out;
}
