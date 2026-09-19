import katex from './vendor/katex.mjs';

// This is a derived, reviewable speech layer. Offsets are UTF-16 source/text
// offsets, NOT audio timings. Parent mappings deliberately overlap child mappings.
export const MATH_SPEECH_VERSION = 'math-speech-1';
export const version = MATH_SPEECH_VERSION;
const WORDS = {
  '+':'plus', '-':'minus', '−':'minus', '=':'equals', '<':'less than', '>':'greater than',
  '/':'divided by', '*':'times', ',':'comma', ';':'semicolon', ':':'colon', '!':'factorial',
  '(':'open parenthesis', ')':'close parenthesis', '[':'open bracket', ']':'close bracket',
  '|':'vertical bar', '\\{':'open brace', '\\}':'close brace',
  '\\cdot':'times', '\\times':'times', '\\div':'divided by', '\\pm':'plus or minus', '\\mp':'minus or plus',
  '\\le':'less than or equal to', '\\leq':'less than or equal to', '\\ge':'greater than or equal to', '\\geq':'greater than or equal to',
  '\\ne':'not equal to', '\\neq':'not equal to', '\\approx':'approximately equals', '\\equiv':'is equivalent to',
  '\\in':'is an element of', '\\notin':'is not an element of', '\\subset':'is a proper subset of', '\\subseteq':'is a subset of or equal to',
  '\\supset':'is a proper superset of', '\\supseteq':'is a superset of or equal to',
  '\\cup':'union', '\\cap':'intersection', '\\emptyset':'empty set', '\\varnothing':'empty set',
  '\\to':'tends to', '\\rightarrow':'right arrow', '\\leftarrow':'left arrow', '\\leftrightarrow':'left right arrow',
  '\\Rightarrow':'implies', '\\Leftarrow':'is implied by', '\\Leftrightarrow':'if and only if',
  '\\infty':'infinity', '\\partial':'partial derivative symbol', '\\nabla':'nabla',
  '\\forall':'for all', '\\exists':'there exists', '\\neg':'not', '\\land':'and', '\\lor':'or',
  '\\ldots':'ellipsis', '\\cdots':'centered ellipsis', '\\vdots':'vertical ellipsis', '\\ddots':'diagonal ellipsis',
  '\\langle':'open angle bracket', '\\rangle':'close angle bracket', '\\lbrace':'open brace', '\\rbrace':'close brace',
  '\\lvert':'open vertical bar', '\\rvert':'close vertical bar', '\\vert':'vertical bar',
  '\\lVert':'open double vertical bar', '\\rVert':'close double vertical bar', '\\Vert':'double vertical bar', '\\|':'double vertical bar',
};
for (const name of 'alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega'.split(' ')) {
  WORDS[`\\${name}`] = /^[A-Z]/.test(name) ? `capital ${name.toLowerCase()}` : name.replace(/^var/, 'variant ');
}
const FUNCTIONS = {sin:'sine',cos:'cosine',tan:'tangent',cot:'cotangent',sec:'secant',csc:'cosecant',arcsin:'arc sine',arccos:'arc cosine',arctan:'arc tangent',sinh:'hyperbolic sine',cosh:'hyperbolic cosine',tanh:'hyperbolic tangent',log:'log',ln:'natural log',exp:'exponential',min:'minimum',max:'maximum',det:'determinant',gcd:'greatest common divisor',lim:'limit'};
const LARGE = {sum:'sum',prod:'product',int:'integral',iint:'double integral',iiint:'triple integral',oint:'closed contour integral',bigcup:'union',bigcap:'intersection'};
const WRAPPERS = {vec:'vector',hat:'hat over',widehat:'hat over',bar:'bar over',overline:'overline of',underline:'underline of',dot:'dot over',ddot:'double dot over',tilde:'tilde over',widetilde:'tilde over',mathbf:'bold',mathbb:'blackboard bold',mathcal:'calligraphic',mathfrak:'Fraktur',mathrm:'roman',mathit:'italic',boldsymbol:'bold'};
const SPACES = new Set(['\\,','\\;','\\:','\\!','\\ ','\\quad','\\qquad','\\enspace','\\thinspace']);

function tokenize(source) {
  const tokens = [];
  for (let i=0; i<source.length;) {
    const start=i, ch=source[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '%') { while (i<source.length && source[i] !== '\n') i++; continue; }
    if (ch === '\\') {
      i++;
      if (/[A-Za-z]/.test(source[i] || '')) while (i<source.length && /[A-Za-z]/.test(source[i])) i++;
      else if (i<source.length) i += source.codePointAt(i)>0xffff ? 2 : 1;
    } else i += source.codePointAt(i)>0xffff ? 2 : 1;
    tokens.push({value:source.slice(start,i),start,end:i});
  }
  return tokens;
}

export function speakLatex(latex, {offset=0,style='brief'}={}) {
  if (typeof latex !== 'string') throw new TypeError('LaTeX must be a string.');
  if (!Number.isSafeInteger(offset) || offset<0) throw new TypeError('offset must be a nonnegative safe integer.');
  if (!['brief','precise'].includes(style)) throw new TypeError('Unknown math speech style.');
  const brief=style==='brief';
  const warnings=[], mappings=[], breaks=[];
  let text='';
  const warn=(message,start=0,end=latex.length)=>warnings.push({message,sourceStart:offset+start,sourceEnd:offset+end});
  const fallback=()=>({text:'math expression requires review',mappings:latex.length?[{sourceStart:offset,sourceEnd:offset+latex.length,speechStart:0,speechEnd:31}]:[],warnings,breaks:[],version:MATH_SPEECH_VERSION});
  if (latex.length>20000) { warn('Math expression exceeds the 20,000 character limit.'); return fallback(); }
  const tokens=tokenize(latex);
  let nesting=0;
  for (const t of tokens) { if (t.value==='{' || t.value==='(' || t.value==='[') nesting++; if (t.value==='}' || t.value===')' || t.value===']') nesting--; if (nesting>64) { warn('Math expression exceeds the nesting limit.',t.start,t.end); return fallback(); } }
  try { katex.__parse(latex,{throwOnError:true,trust:false,maxExpand:1000,strict:'ignore'}); }
  catch (error) { const start=Math.max(0,Math.min(latex.length,error.position ?? 0)); warn(`Invalid LaTeX: ${error.rawMessage || 'syntax could not be parsed'}`,start,Math.min(latex.length,start+(error.length || 1))); return fallback(); }
  let pos=0, depth=0;
  const peek=()=>tokens[pos]?.value;
  const node=(kind,start,end,other={})=>({kind,start,end,...other});
  const sequence=(stop=()=>false)=>{
    if (++depth>64) throw new Error('Math expression exceeds the nesting limit.');
    const items=[];
    while (pos<tokens.length && !stop(peek())) {
      let current=atom();
      if (!current) continue;
      if (['\\limits','\\nolimits'].includes(peek()) && current.kind==='large') { current.end=tokens[pos++].end; }
      const scripts={};
      while (peek()==='^' || peek()==='_') {
        const marker=tokens[pos++], key=marker.value==='^'?'sup':'sub';
        const argument=arg();
        scripts[key]={...argument,markerStart:marker.start};
      }
      if (scripts.sup || scripts.sub) current=node('scripts',current.start,Math.max(current.end,scripts.sup?.end || 0,scripts.sub?.end || 0),{base:current,...scripts});
      items.push(current);
    }
    depth--;
    // TeX command arguments consume one token; join numerals only afterwards.
    const joined=[];
    for(const item of items) {
      const last=joined.at(-1);
      if(last?.kind==='number' && (item.kind==='number' || item.kind==='decimal') && last.end===item.start && !(item.kind==='decimal' && last.words.includes('.'))) { last.words+=item.words; last.end=item.end; }
      else joined.push(item);
    }
    // A slash binds the adjacent expressions at this group level; explicit
    // source groups and scripts have already been parsed recursively.
    for(let i=1;i<joined.length-1;i++) if(joined[i].slash) {
      const left=joined[i-1],right=joined[i+1];
      if(left.kind==='symbol' && Object.values(WORDS).includes(left.words) || right.slash) continue;
      joined.splice(i-1,3,node('fraction',left.start,right.end,{numerator:left,denominator:right})); i=Math.max(0,i-2);
    }
    return joined;
  };
  const group=(open,close,kind='group')=>{
    const first=tokens[pos++];
    const items=sequence(v=>v===close);
    if (peek()!==close) throw new Error(`Unclosed ${open} group.`);
    const last=tokens[pos++];
    return node(kind,first.start,last.end,{items});
  };
  const arg=()=>{
    if (!tokens[pos]) throw new Error('Missing command argument.');
    if (peek()==='{') return group('{','}','argument');
    return atom();
  };
  const literalArgument=()=>{
    if (peek()!=='{') throw new Error('A braced text argument is required.');
    const first=tokens[pos++]; let level=1,last=first;
    while (pos<tokens.length && level) { last=tokens[pos++]; if(last.value==='{') level++; if(last.value==='}') level--; }
    if (level) throw new Error('Unclosed text argument.');
    const raw=latex.slice(first.end,last.start);
    if (/[\\{}]/.test(raw)) warn('Nested formatting or commands inside text need review.',first.start,last.end);
    return node('literal',first.start,last.end,{words:raw.replace(/\s+/g,' ').trim()});
  };
  const atom=()=>{
    const t=tokens[pos];
    if (!t) throw new Error('Missing expression.');
    if (t.value==='{') return group('{','}');
    if (t.value==='(') return group('(',')','parentheses');
    if (t.value==='[') return group('[',']','brackets');
    pos++;
    if (SPACES.has(t.value)) return node('space',t.start,t.end);
    if (t.value==='\\left') {
      const left=tokens[pos++]; if(!left) throw new Error('Missing left delimiter.');
      const items=sequence(v=>v==='\\right');
      if(peek()!=='\\right') throw new Error('Missing right delimiter.');
      pos++; const right=tokens[pos++]; if(!right) throw new Error('Missing right delimiter.');
      return node('delimited',t.start,right.end,{left,right,items});
    }
    if (t.value==='\\begin') {
      const env=literalArgument(), name=env.words;
      const rows=[[]];
      while (pos<tokens.length && peek()!=='\\end') {
        const items=sequence(v=>v==='&' || v==='\\\\' || v==='\\end');
        rows.at(-1).push(items);
        if (peek()==='&') pos++;
        else if (peek()==='\\\\') { pos++; if(peek()!=='\\end') rows.push([]); }
        else break;
      }
      if(peek()!=='\\end') throw new Error('Missing environment end.');
      pos++; const end=literalArgument();
      if(end.words!==name) throw new Error('Mismatched environment end.');
      if(!['matrix','pmatrix','bmatrix','Bmatrix','vmatrix','Vmatrix','smallmatrix'].includes(name)) warn(`Unsupported environment ${name}; its layout needs review.`,t.start,end.end);
      if(rows.some(row=>row.length!==rows[0].length)) warn('Unequal matrix row lengths need review.',t.start,end.end);
      return node('matrix',t.start,end.end,{name,rows});
    }
    const command=t.value.startsWith('\\')?t.value.slice(1):null;
    if (['frac','dfrac','tfrac','binom','dbinom','tbinom'].includes(command)) {
      const numerator=arg(),denominator=arg();
      return node(command.includes('binom')?'binomial':'fraction',t.start,denominator.end,{numerator,denominator});
    }
    if(command==='sqrt') {
      const index=peek()==='['?group('[',']','argument'):null,body=arg();
      return node('root',t.start,body.end,{index,body});
    }
    if(command==='text' || command==='operatorname') {
      const body=literalArgument(); return node('literal',t.start,body.end,{words:body.words});
    }
    if(WRAPPERS[command]) { const body=arg(); return node('wrapper',t.start,body.end,{words:WRAPPERS[command],body}); }
    if(LARGE[command]) return node('large',t.start,t.end,{words:LARGE[command]});
    if(FUNCTIONS[command]) return node('symbol',t.start,t.end,{words:FUNCTIONS[command]});
    if(WORDS[t.value]) return node('symbol',t.start,t.end,{words:WORDS[t.value],slash:t.value==='/'});
    if(/^[0-9]$/.test(t.value)) return node('number',t.start,t.end,{words:t.value});
    if(t.value==='.') return node('decimal',t.start,t.end,{words:'.'});
    if(/^[A-Za-z]$|^[0-9]+(?:\.[0-9]+)?$/.test(t.value)) return node('symbol',t.start,t.end,{words:t.value});
    warn(`Unsupported math symbol or command ${t.value}; review its spoken meaning.`,t.start,t.end);
    return node('symbol',t.start,t.end,{words:'unsupported math symbol'});
  };
  let tree;
  try { tree=sequence(); }
  catch(error) { warn(error.message,tokens[pos]?.start || 0,tokens[pos]?.end || latex.length); return fallback(); }
  const emit=(words,n)=>{
    if(!words) return;
    if(text) text+=' ';
    const start=text.length; text+=words;
    mappings.push({sourceStart:offset+n.start,sourceEnd:offset+n.end,speechStart:start,speechEnd:text.length});
  };
  const pause=(role,ms=180)=>{ if(text) breaks.push({speechOffset:text.length,ms,role}); };
  const renderItems=items=>items.forEach(render);
  function render(n) {
    const before=text.length+(text?1:0);
    switch(n.kind) {
      case 'space': break;
      case 'symbol': case 'large': case 'literal': case 'number': case 'decimal': emit(n.words,n); break;
      case 'argument': renderItems(n.items); break;
      case 'group': case 'parentheses': case 'brackets':
        emit(n.kind==='group'?'quantity':n.kind==='parentheses'?'open parenthesis':'open bracket',n); pause('group-open',100);
        renderItems(n.items); emit(n.kind==='group'?'end quantity':n.kind==='parentheses'?'close parenthesis':'close bracket',n); pause('group-close'); break;
      case 'fraction': case 'binomial':
        if(brief && n.kind==='fraction') {
          const complex=x=>['fraction','scripts','root','matrix'].includes(x.kind) || x.items?.some(y=>['fraction','scripts','root','matrix'].includes(y.kind));
          const contents=x=>x.items && ['argument','group','parentheses','brackets'].includes(x.kind)?renderItems(x.items):render(x);
          if(complex(n.numerator) || complex(n.denominator)) { emit('fraction',n); contents(n.numerator); pause('numerator-close',200); emit('over',n); render(n.denominator); emit('end fraction',n); }
          else { contents(n.numerator); pause('numerator-close',180); emit(n.numerator.items?.length>1?'all over':'over',n); if(n.denominator.items?.length>1) { emit('quantity',n.denominator); contents(n.denominator); emit('end quantity',n.denominator); } else contents(n.denominator); }
          pause('fraction-close',220); break;
        }
        emit(n.kind==='fraction'?'fraction numerator':'binomial upper argument',n); pause('numerator-open',120); render(n.numerator);
        pause('numerator-close'); emit(n.kind==='fraction'?'denominator':'lower argument',n); pause('denominator-open',120); render(n.denominator);
        emit(n.kind==='fraction'?'end fraction':'end binomial',n); pause('fraction-close',220); break;
      case 'root':
        emit(n.index?'root with index':'square root of',n);
        if(n.index) { render(n.index); emit('of',n); }
        pause('root-open',120); render(n.body); emit('end root',n); pause('root-close',200); break;
      case 'scripts': {
        const power=n.sup && (n.sup.words || (n.sup.items?.length===1?n.sup.items[0].words:null));
        if(brief && !n.sub && ['2','3'].includes(power) && n.base.kind!=='large') {
          if(['parentheses','group','brackets'].includes(n.base.kind)) renderItems(n.base.items); else render(n.base);
          pause('power-base-close',200);
          emit(`${['symbol','number'].includes(n.base.kind)?'':'the whole thing '}${power==='2'?'squared':'cubed'}`,{start:n.sup.markerStart,end:n.sup.end}); pause('exponent-close',180); break;
        }
        render(n.base);
        const bound=n.base.kind==='large';
        if(n.sub) { emit(bound?'from':'subscript',{start:n.sub.markerStart,end:n.sub.end}); render(n.sub); if(!bound) emit('end subscript',n.sub); pause('subscript-close',100); }
        if(n.sup) { emit(bound?'to':'to the power',{start:n.sup.markerStart,end:n.sup.end}); render(n.sup); if(!bound) emit('end exponent',n.sup); pause('exponent-close',180); }
        if(bound && (n.sub || n.sup)) { emit('of',n); pause('bounds-close',180); }
        break;
      }
      case 'wrapper': emit(n.words,n); render(n.body); emit('end '+n.words,n); pause('modifier-close',120); break;
      case 'delimited':
        if(n.left.value!=='.') emit(WORDS[n.left.value] || ({'(':'open parenthesis','[':'open bracket'}[n.left.value]) || 'open delimiter',n.left);
        pause('group-open',100); renderItems(n.items);
        if(n.right.value!=='.') emit(WORDS[n.right.value] || ({')':'close parenthesis',']':'close bracket'}[n.right.value]) || 'close delimiter',n.right);
        pause('group-close'); break;
      case 'matrix':
        emit(`${n.name==='vmatrix'?'determinant of ':n.name==='Vmatrix'?'double vertical bars around ':''}matrix with ${n.rows.length} rows and ${n.rows[0]?.length || 0} columns`,n); pause('matrix-open',220);
        n.rows.forEach((row,i)=>{ emit(`row ${i+1}`,n); row.forEach((cell,j)=>{ if(j) {emit('next column',n);pause('matrix-column',160);} renderItems(cell); });pause('matrix-row',250); });
        emit('end matrix',n); pause('matrix-close',250); break;
      default: throw new Error('Unexpected math speech node.');
    }
    if(text.length>before && !['symbol','large','literal','number','decimal','space'].includes(n.kind)) mappings.push({sourceStart:offset+n.start,sourceEnd:offset+n.end,speechStart:before,speechEnd:text.length});
  }
  renderItems(tree);
  if(!text && latex.trim()) warn('The expression has no supported spoken content.');
  return {text,mappings,warnings,breaks,version:MATH_SPEECH_VERSION};
}
