/* Side panel multi-node renderer for RichYAML */
(function(){
  const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
  function h(tag, attrs, ...kids){ const el=document.createElement(tag); if(attrs) for(const[k,v] of Object.entries(attrs)){ if(k==='className') el.className=v; else if(k==='text') el.textContent=String(v); else el.setAttribute(k,String(v)); } for(const k of kids){ if(k==null) continue; if(typeof k==='string') el.appendChild(document.createTextNode(k)); else el.appendChild(k);} return el; }
  let panelMode = 'edit';
  function renderEquation(container, item, editable){
    const effEditable = editable && panelMode !== 'preview';
    const wrap = h('div',{className:'ry-node ry-equation'+(effEditable?' ry-current':' ry-clickable'), 'data-path': JSON.stringify(item.path), tabindex: effEditable? undefined : '0', role: effEditable? 'group':'button', 'aria-label': effEditable? 'Current equation editor' : 'Go to equation'});
    const header = h('div',{className:'ry-head', text: editable? 'Equation (current)' : 'Equation'});
    const body = h('div',{className:'ry-body'});
    const mf = document.createElement('math-field');
    let originalLatexAbsent = false;
    try {
      const lx = item.data?.latex;
      originalLatexAbsent = (lx === undefined || lx === null) && !!item.data?.mathjson;
      if (lx !== undefined && lx !== null) {
        mf.value = String(lx);
      } else if (item.data?.mathjson) {
        function miniLatex(expr){
          try{
            if(expr==null) return '';
            if(typeof expr==='number') return String(expr);
            if(typeof expr==='string') return expr;
            if(Array.isArray(expr)){
              const [head,...rest]=expr;
              switch(head){
                case 'Equal': return rest.map(miniLatex).join(' = ');
                case 'Add': return rest.map(miniLatex).join(' + ');
                case 'Subtract': return rest.map(miniLatex).join(' - ');
                case 'Multiply': return rest.map(r=>{ const s=miniLatex(r); return /^(Add|Subtract)$/i.test(r?.[0])? '('+s+')': s; }).join(' \\cdot ');
                case 'Divide': return rest.length===2? `\\frac{${miniLatex(rest[0])}}{${miniLatex(rest[1])}}` : rest.map(miniLatex).join('/');
                case 'Rational': return rest.length===2? `\\frac{${miniLatex(rest[0])}}{${miniLatex(rest[1])}}` : '';
                case 'Power': return rest.length===2? `${miniLatex(rest[0])}^{${miniLatex(rest[1])}}` : '';
                case 'Sqrt': return rest.length? `\\sqrt{${miniLatex(rest[0])}}`:'\\sqrt{}';
                case 'Root': return rest.length===2? `\\sqrt[${miniLatex(rest[1])}]{${miniLatex(rest[0])}}`:'';
                case 'Negate': return '-'+miniLatex(rest[0]);
                case 'Factorial': return miniLatex(rest[0])+'!';
                case 'Apply': if(rest.length){ const fn=miniLatex(rest[0]); const args=rest.slice(1).map(miniLatex).join(','); return `${fn}(${args})`; } return '';
                default: if(typeof head==='string' && rest.length){ return `${head}(${rest.map(miniLatex).join(',')})`; } return head+'';
              }
            }
          }catch(e){}
          return '';
        }
        // Try real ComputeEngine serialization first
        let serialized = '';
        try {
          // (logging removed) attempting serialization from mathjson
          let ce = window.__richyamlCE;
          if (!ce && globalThis.MathfieldElement && globalThis.MathfieldElement.computeEngine) {
            ce = window.__richyamlCE = globalThis.MathfieldElement.computeEngine;
            // Using embedded MathfieldElement.computeEngine
          }
          if (!ce && window.ComputeEngine) {
            try { ce = window.__richyamlCE = new window.ComputeEngine(); } catch (e) { console.warn('[RichYAML][side] Failed new ComputeEngine()', e); }
          }
          if (ce) {
            try {
              if (typeof ce.serialize === 'function') {
                serialized = ce.serialize(item.data.mathjson) || '';
                // CE serialize result obtained
              } else if (typeof ce.box === 'function') {
                const boxed = ce.box(item.data.mathjson);
                serialized = (boxed && boxed.latex) || '';
                // CE box().latex result obtained
              } else {
                console.warn('[RichYAML][side] CE has neither serialize nor box');
              }
            } catch (e) { console.warn('[RichYAML][side] Error during CE serialization', e); }
          } else {
            // Compute Engine not yet available
          }
        } catch (e) { console.warn('[RichYAML][side] Serialization attempt failed', e); }
        if (!serialized) {
          try {
            const mj = item.data.mathjson;
            if (Array.isArray(mj) && mj[0] === 'Equal' && mj.length === 3) serialized = String(mj[1]) + ' = ' + String(mj[2]);
            else { const mini = miniLatex(mj); if(mini){ serialized = mini; } }
          } catch {}
        }
        mf.value = serialized;
      } else {
        mf.value = '';
      }
      // Retry logic if CE not yet available and nothing serialized
      if (!mf.value && item.data?.mathjson) {
        let attempts = 0;
        const retry = () => {
          if (mf.value) return; // user typed or already filled
          if (attempts++ >= 5) return;
            let ce = window.__richyamlCE;
            if (!ce && globalThis.MathfieldElement && globalThis.MathfieldElement.computeEngine) {
              ce = window.__richyamlCE = globalThis.MathfieldElement.computeEngine;
              // Found CE on retry attempt
            }
            if (ce) {
              try {
                let out = '';
                if (typeof ce.serialize === 'function') out = ce.serialize(item.data.mathjson) || '';
                else if (typeof ce.box === 'function') out = ce.box(item.data.mathjson).latex || '';
                if (out) {
                  mf.value = out; mf.removeAttribute('placeholder');
                  // Serialization succeeded on retry
                  return;
                }
              } catch (e) { console.warn('[RichYAML][side][retry] serialization error', e); }
            }
          setTimeout(retry, 150 * attempts);
        };
        setTimeout(retry, 120);
      }
    } catch {}
    // Provide a visible placeholder styling if empty
    if(!mf.value){ mf.setAttribute('placeholder','Enter LaTeX…'); }
  if(!effEditable) mf.setAttribute('readonly','');
  mf.setAttribute('aria-label', effEditable? 'Editable equation latex' : 'Equation latex');
    body.appendChild(mf);
  if(effEditable){
  let t; const send=()=>{ if(!vscode) return; const val=mf.value||''; if(originalLatexAbsent){ vscode.postMessage({type:'edit:apply', path:item.path, propPath:['mathjson'], edit:'set', value:{ $__fromLatex: val }}); } else { vscode.postMessage({type:'edit:apply', path:item.path, key:'latex', edit:'set', value: val}); }};
      mf.addEventListener('input', ()=>{ clearTimeout(t); t=setTimeout(send,200); });
    }
    wrap.appendChild(header); wrap.appendChild(body); container.appendChild(wrap);
  if(!effEditable && vscode){
      const go=()=>{ vscode.postMessage({type:'navigate:to', path: item.path}); };
      wrap.addEventListener('click', go);
      wrap.addEventListener('keydown', (e)=>{ if(e.key==='Enter' || e.key===' '){ e.preventDefault(); go(); }});
    }
  }
  function ensureVega(cb){
    if(window.vega && (window.vega.expressionInterpreter || window.__vegaExpressionInterpreter)) return cb();
    let doneCalled=false;const done=(e)=>{if(doneCalled) return;doneCalled=true;window.removeEventListener('vega-ready',onReady);clearTimeout(tid);clearInterval(pid);cb(e);};
    const onReady=()=>{ if(window.vega && (window.vega.expressionInterpreter || window.__vegaExpressionInterpreter)) done(); };
    window.addEventListener('vega-ready',onReady);const pid=setInterval(onReady,100);const tid=setTimeout(()=>done(new Error('vega timeout')),8000);
  }
  function renderChart(container, item, editable){
    const effEditable = editable && panelMode !== 'preview';
    const wrap = h('div',{className:'ry-node ry-chart', 'data-path': JSON.stringify(item.path)});
    const header = h('div',{className:'ry-head', text: editable? 'Chart (current)' : 'Chart'});
    const body = h('div',{className:'ry-body'});
    if(!effEditable){
      wrap.className += ' ry-clickable';
      wrap.setAttribute('tabindex','0');
      wrap.setAttribute('role','button');
      wrap.setAttribute('aria-label','Go to chart');
      const summary = h('div',{className:'ry-chart-summary', text: (item.data?.title || 'Chart') + ' • ' + (item.data?.mark || 'mark')}); body.appendChild(summary);
      wrap.appendChild(header); wrap.appendChild(body); container.appendChild(wrap);
      if(vscode){
        const go=()=>{ vscode.postMessage({type:'navigate:to', path:item.path}); };
        wrap.addEventListener('click', go);
        wrap.addEventListener('keydown', (e)=>{ if(e.key==='Enter' || e.key===' '){ e.preventDefault(); go(); }});
      }
      return;
    }
  // Editable chart: preview + minimal controls (disabled in preview mode)
    const title = h('div',{className:'ry-title', text: item.data?.title || 'Chart'});
    const target = h('div',{className:'ry-chart', role:'img','aria-label':'Chart preview'});
    const controls = h('div',{className:'ry-controls'});
    const row = (label, control)=>{ const w=h('div',{className:'ry-row'}); const l=h('label',{className:'ry-lbl', text: label}); w.appendChild(l); w.appendChild(control); return w; };
    const input = (val, ph)=>{ const el=h('input',{type:'text'}); el.value= val!=null? String(val):''; if(ph) el.placeholder=ph; return el; };
    const select=(opts,val)=>{ const el=h('select'); for(const o of opts){ const opt=h('option',{value:o,text:o}); if(String(val)===o) opt.selected=true; el.appendChild(opt);} return el; };
    const markSel = select(['line','bar','point'], item.data?.mark || 'line');
    const titleInp = input(item.data?.title,'Title');
    const xFieldInp = input(item.data?.encoding?.x?.field,'x field');
    const xTypeSel = select(['quantitative','nominal','temporal','ordinal'], item.data?.encoding?.x?.type || 'quantitative');
    const yFieldInp = input(item.data?.encoding?.y?.field,'y field');
    const yTypeSel = select(['quantitative','nominal','temporal','ordinal'], item.data?.encoding?.y?.type || 'quantitative');
    const hint = h('div',{className:'ry-hint'});
    controls.appendChild(row('Title', titleInp));
    controls.appendChild(row('Mark', markSel));
    controls.appendChild(row('X Field', xFieldInp));
    controls.appendChild(row('X Type', xTypeSel));
    controls.appendChild(row('Y Field', yFieldInp));
    controls.appendChild(row('Y Type', yTypeSel));
    controls.appendChild(hint);
    body.appendChild(target); body.appendChild(controls);
    // Issues banner (only for current)
    if(Array.isArray(item.issues) && item.issues.length){
      const banner = h('div',{className:'ry-issues'});
      const errs=item.issues.filter(i=>i.severity==='error'); const warns=item.issues.filter(i=>i.severity!=='error');
      banner.style.color = errs.length? 'var(--vscode-errorForeground,#f00)':'var(--vscode-editorWarning-foreground,#e0a800)';
      banner.textContent = errs.length? errs[0].message : warns[0].message;
      if(item.issues.length>1) banner.title = item.issues.map(i=>i.severity.toUpperCase()+': '+i.message).join('\n');
      wrap.appendChild(banner);
    }
    wrap.appendChild(header); wrap.appendChild(title); wrap.appendChild(body); container.appendChild(wrap);
    const allowedMarks=new Set(['line','bar','point']);
    const allowedTypes=new Set(['quantitative','nominal','temporal','ordinal']);
    const showError=(m)=>{ hint.textContent=m||''; hint.style.color=m? 'var(--vscode-errorForeground,red)':''; };
  const sendEdit=(propPath,value)=>{ if(!vscode || panelMode==='preview') return; vscode.postMessage({type:'edit:apply', path:item.path, propPath, edit:'set', value}); };
    function onTitle(){ const v=titleInp.value.trim(); if(!v){ showError('Title required'); return;} showError(''); sendEdit(['title'], v); }
    function onMark(){ const v=String(markSel.value||'').toLowerCase(); if(!allowedMarks.has(v)){ showError('Invalid mark'); return;} showError(''); sendEdit(['mark'], v); }
    function onXField(){ const v=xFieldInp.value.trim(); if(!v){ showError('x.field required'); return;} showError(''); sendEdit(['encoding','x','field'], v); }
    function onXType(){ const v=String(xTypeSel.value||'').toLowerCase(); if(!allowedTypes.has(v)){ showError('Invalid x.type'); return;} showError(''); sendEdit(['encoding','x','type'], v); }
    function onYField(){ const v=yFieldInp.value.trim(); if(!v){ showError('y.field required'); return;} showError(''); sendEdit(['encoding','y','field'], v); }
    function onYType(){ const v=String(yTypeSel.value||'').toLowerCase(); if(!allowedTypes.has(v)){ showError('Invalid y.type'); return;} showError(''); sendEdit(['encoding','y','type'], v); }
    if(panelMode !== 'preview'){
      titleInp.addEventListener('change', onTitle); titleInp.addEventListener('blur', onTitle);
      markSel.addEventListener('change', onMark);
      xFieldInp.addEventListener('change', onXField); xFieldInp.addEventListener('blur', onXField);
      xTypeSel.addEventListener('change', onXType);
      yFieldInp.addEventListener('change', onYField); yFieldInp.addEventListener('blur', onYField);
      yTypeSel.addEventListener('change', onYType);
    } else {
      // In preview mode disable form controls
      [titleInp, markSel, xFieldInp, xTypeSel, yFieldInp, yTypeSel].forEach(el=>{ try{ el.disabled=true; }catch{} });
    }
  if(panelMode !== 'preview') body.addEventListener('keydown', (e)=>{ if(e.key==='Escape' || (e.key==='Enter' && (e.ctrlKey||e.metaKey))){ e.preventDefault(); try{ (wrap.closest('[tabindex]')||wrap).focus(); }catch{} if(vscode) vscode.postMessage({type:'focus:return'}); }});
    // Data resolution
    function requestData(cb){ const file=item.data && item.data.data && item.data.data.file; if(vscode && typeof file==='string' && file.trim()){ const onMsg=(ev)=>{ const m=ev.data||{}; if(m.type==='data:resolved' && JSON.stringify(m.path)===JSON.stringify(item.path)){ window.removeEventListener('message', onMsg); const next={...item.data, data:{...(item.data.data||{}), values: Array.isArray(m.values)? m.values:[]}}; cb(null,next);} else if(m.type==='data:error' && JSON.stringify(m.path)===JSON.stringify(item.path)){ window.removeEventListener('message', onMsg); showError('Data error: '+(m.error||'unknown')); cb(new Error(m.error||'data error')); }}; window.addEventListener('message', onMsg); vscode.postMessage({type:'data:request', path:item.path, file}); } else cb(null,item.data); }
    function renderChartSpec(c){ try { const enc=c.encoding||{}; const x=enc.x||{}, y=enc.y||{}; const xField=x.field||'x'; const yField=y.field||'y'; const markType=String(c.mark||'line').toLowerCase(); const xType=(x.type||'').toLowerCase(); const xScaleType = markType==='bar'? 'band': (xType==='quantitative'? 'linear':'point'); const values=Array.isArray(c?.data?.values)? c.data.values:[]; const width=Number(c.width)>0? Number(c.width):320; const height=Number(c.height)>0? Number(c.height):160; const color = Array.isArray(c.colors)&&c.colors.length? String(c.colors[0]):undefined; const spec={ width, height, padding:8, data:[{name:'table', values}], scales:[ {name:'x', type:xScaleType, domain:{data:'table', field:xField}, range:'width'}, {name:'y', type:'linear', nice:true, domain:{data:'table', field:yField}, range:'height'} ], axes:[ {orient:'bottom', scale:'x', title:x.title}, {orient:'left', scale:'y', title:y.title} ] }; const enterCommon={ x:{scale:'x', field:xField}, y:{scale:'y', field:yField} }; if(markType==='point'){ const encEnter={...enterCommon, size:{value:60}}; if(color) encEnter.fill={value:color}; spec.marks=[{type:'symbol', from:{data:'table'}, encode:{enter:encEnter}}]; } else if(markType==='bar' && xScaleType==='band'){ const barEnter={ x:{scale:'x', field:xField}, width:{scale:'x', band:1}, y:{scale:'y', field:yField}, y2:{scale:'y', value:0} }; if(color) barEnter.fill={value:color}; spec.marks=[{type:'rect', from:{data:'table'}, encode:{enter:barEnter}}]; } else { const lineEnter={...enterCommon, strokeWidth:{value:2}}; if(color) lineEnter.stroke={value:color}; spec.marks=[{type:'line', from:{data:'table'}, encode:{enter:lineEnter}}]; } const runtime=window.vega.parse(spec,null,{ast:true}); const interp=window.__vegaExpressionInterpreter || window.vega.expressionInterpreter; const view=new window.vega.View(runtime,{renderer:'canvas', container:target, hover:true, expr:interp}); view.runAsync(); } catch(e){ target.textContent='Chart render error: '+e.message; target.style.color='red'; } }
    ensureVega((err)=>{ if(err){ target.textContent='Chart engine unavailable'; target.style.color='red'; return; } requestData((e2,c2)=>{ if(e2) return; renderChartSpec(c2); }); });
  }
  function applyPayload(msg){
    if(typeof msg.mode === 'string') panelMode = msg.mode;
    const root=document.getElementById('root'); if(!root) return;
    if(!Array.isArray(msg.items)){ root.textContent='(No rich nodes)'; return; }
    // Focus-preserving fast path: if current equation math-field focused and still current, update value only
    try {
      const current = msg.items.find(it=>it.current && it.nodeType==='equation');
      if(current){
        const curWrap = root.querySelector('.ry-equation.ry-current');
        const mf = curWrap ? curWrap.querySelector('math-field') : null;
        if(mf && document.activeElement === mf){
          const newLatexRaw = current?.data?.latex;
          const newLatex = (newLatexRaw !== undefined && newLatexRaw !== null) ? String(newLatexRaw) : (current?.data?.mathjson ? '' : '');
          if(mf.value !== newLatex) mf.value = newLatex;
          // Re-render neighbors if counts changed or ordering changed; simple heuristic: same number of .ry-node
          const existingCount = root.querySelectorAll('.ry-node').length;
          if(existingCount === msg.items.length){
            return; // keep rest intact
          }
        }
      }
    } catch {}
    // Full re-render fallback
    root.innerHTML='';
    for(const it of msg.items){ if(it.nodeType==='equation') renderEquation(root,it,it.current); else if(it.nodeType==='chart') renderChart(root,it,it.current); }
  }
  function showTransientWarning(msg){
    const root=document.getElementById('root'); if(!root) return; let bar=root.querySelector('.ry-warn');
    if(!bar){ bar=document.createElement('div'); bar.className='ry-warn'; bar.style.cssText='background:var(--vscode-editorWarning-foreground,#e0a800);color:#000;padding:2px 6px;font-size:11px;margin:2px 0;'; root.prepend(bar); }
    bar.textContent=msg; clearTimeout(bar._t); bar._t=setTimeout(()=>{ try{ bar.remove(); }catch{} }, 4000);
  }
  function onMessage(ev){ const m=ev.data||{}; if(m.type==='preview:multi') applyPayload(m); else if(m.type==='edit:skipped'){ const reason=m.reason||'document changed'; showTransientWarning('Edit skipped: '+reason); } else if(m.type==='preview:error'){ const root=document.getElementById('root'); if(root){ root.innerHTML=''; const div=document.createElement('div'); div.className='ry-error'; div.setAttribute('role','alert'); div.textContent=m.error||'Invalid YAML'; div.style.cssText='margin:6px; padding:6px 8px; background:var(--vscode-inputValidation-errorBackground,#5a1d1d); color:var(--vscode-inputValidation-errorForeground,#fff); border-left:4px solid var(--vscode-errorForeground,#f00); font-size:12px; border-radius:4px;'; root.appendChild(div);} } }
  window.addEventListener('message', onMessage);
  if(vscode) vscode.postMessage({type:'preview:ready'});
})();
