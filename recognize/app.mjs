import {renderFile,recognize,endpoint,number,billWarnings,mapBillTransformers} from './ocr-core.mjs';
import {readSales,prepareSale,matchingSale,saveSale,SALES_KEY} from './sales-store.mjs';
const $=id=>document.getElementById(id);
const settings={base:'',model:'',key:''};
$('settingsButton').hidden=true;
$('configDot').classList.add('ready');
$('sendTo').textContent='网页识别，无需 API Key 或本机服务。原件在当前浏览器处理，请对照核对。';
let pages=[],selected=0,busy=false,controller=null;
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function status(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error);}
function buttonState(){
  $('recognizeButton').disabled=busy||!pages.length||!pages.some(p=>!p.result);
  $('clearButton').disabled=busy||!pages.length;
  $('cancelButton').hidden=!busy;
  $('settingsButton').disabled=busy;
  $('files').disabled=busy;
  $('reviewed').disabled=busy;
  $('downloadButton').disabled=busy||!$('reviewed').checked||!pages.some(p=>p.result);
  if($('handoffButton')){
    $('handoffButton').disabled=busy||!pages.some(p=>p.result);
    $('bridgeStatus').textContent=$('reviewed').checked?'可传回原台账，确认目标电表和结算月份后保存。售电收入未确认时请保留为空。':'请对照原件核对，并勾选上方“我已对照原件核对本次识别结果”，再传回台账。';
  }
  document.querySelectorAll('[data-save-sale]').forEach(b=>b.disabled=busy||!$('reviewed').checked);
  document.querySelectorAll('[data-confirm-revenue]').forEach(b=>b.disabled=busy);
}
function renderList(){
  $('pageCount').textContent=`${pages.length} 页`;
  $('fileList').replaceChildren(...pages.map((p,i)=>{
    const b=document.createElement('button');b.className=`fileitem${i===selected?' selected':''}`;b.title=`${p.name} · 第 ${p.page} 页`;b.type='button';
    const s=document.createElement('span');s.textContent=`${p.name} · ${p.page}`;
    const state=document.createElement('i');state.textContent=p.result?'✓':p.error?'!':'○';b.append(s,state);
    b.onclick=()=>{selected=i;renderPreview();};return b;
  }));
}
function renderPreview(){
  renderList();const p=pages[selected];$('previewEmpty').hidden=!!p;$('preview').hidden=!p;
  if(p){$('previewName').textContent=`${p.name} · 第 ${p.page} 页`;$('previewImage').src=p.url;$('viewOriginal').href=p.url;}
  else{$('previewImage').removeAttribute('src');$('viewOriginal').removeAttribute('href');}
}
async function addFiles(list){
  if(busy||!list.length)return;
  busy=true;buttonState();status('正在本机读取并生成页面预览…');
  let errors=[];
  try{
    for(const file of list){try{
      const incoming=await renderFile(file);
      if(pages.length+incoming.length>20)throw new Error('本次最多保留 20 页，请分批处理。');
      pages.push(...incoming.map(p=>({...p,result:null,error:''})));selected=pages.length-incoming.length;
    }catch(e){errors.push(`${file.name}：${e.message}`);}}
    $('reviewed').checked=false;renderPreview();renderResults();
    status(errors.length?errors.join('；'):`已加载 ${pages.length} 页。点击“开始识别”，文件将在本机处理。`,!!errors.length);
  }finally{busy=false;buttonState();}
}
$('files').addEventListener('change',e=>{addFiles([...e.target.files]);e.target.value='';});
const drop=$('dropzone');
drop.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&!busy){e.preventDefault();$('files').click();}});
drop.addEventListener('dragover',e=>{e.preventDefault();if(!busy)drop.classList.add('dragging');});
drop.addEventListener('dragleave',()=>drop.classList.remove('dragging'));
drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('dragging');addFiles([...e.dataTransfer.files]);});
$('settingsButton').onclick=()=>{$('settingsError').textContent='';$('settingsDialog').showModal();};
$('closeSettings').onclick=()=>$('settingsDialog').close();
$('settingsForm').onsubmit=e=>{
  e.preventDefault();try{endpoint($('apiBase').value);if(!$('apiModel').value.trim())throw new Error('请填写视觉模型名称。');
    settings.base=$('apiBase').value.trim();settings.model=$('apiModel').value.trim();settings.key=$('apiKey').value.trim();
    $('configDot').classList.add('ready');$('settingsDialog').close();
    $('sendTo').textContent=`识别时发送至 ${new URL(settings.base).host} · ${settings.model}。密钥仅保留在当前页面。`;
    status('接口已设置。上传文件后即可识别。');
  }catch(err){$('settingsError').textContent=err.message;}
};
$('recognizeButton').onclick=async()=>{
  busy=true;controller=new AbortController();$('reviewed').checked=false;buttonState();
  let done=0,failed=0,stopped=false;const pending=pages.filter(p=>!p.result);
  try{
    for(const p of pending){
      if(controller.signal.aborted){stopped=true;break;}
      selected=pages.indexOf(p);renderPreview();status(`正在识别 ${done+failed+1}/${pending.length}：${p.name} · 第 ${p.page} 页…`);
      try{
        const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(300000)]);
        p.result=await recognize(p.url,settings,signal);p.error='';done++;
        renderResults();renderList();
      }catch(err){
        if(controller.signal.aborted){stopped=true;break;}
        p.error=err.name==='TimeoutError'?'识别超过 5 分钟，请重试或缩小图片。':err.message;failed++;renderList();
        status(`${p.name}：${p.error}`,true);
      }
    }
    const errs=pages.filter(p=>p.error).map(p=>`${p.name}：${p.error}`);
    status(stopped?`已停止，保留 ${done} 页已完成结果。`:failed?`本次完成 ${done} 页，失败 ${failed} 页。${errs.join('；')}`:`识别完成。请逐项对照原件核对，尤其是手写名称、小数点和月份。`,!!failed);
  }finally{busy=false;controller=null;buttonState();}
};
$('cancelButton').onclick=()=>{controller?.abort();status('正在停止识别…');};
$('clearButton').onclick=()=>{pages=[];selected=0;$('reviewed').checked=false;renderPreview();renderResults();buttonState();status('已清空本次文件与识别结果。');};
function meterTable(result,index){
  if(!result.meters.length)return '';
  return `<h3>手写抄表 · ${result.meters.length} 块表</h3>${result.date?`<p class="source-label">原文抄表日期：${escape(result.date)}；结算月份需在台账中确认。</p>`:''}<div class="tablewrap"><table><thead><tr><th>企业原文</th><th>电表编号 / 名称</th><th>累计示数</th></tr></thead><tbody>${result.meters.map((m,i)=>`<tr><td><input aria-label="企业 ${i+1}" data-page="${index}" data-kind="meters" data-row="${i}" data-key="company" value="${escape(m.company)}"></td><td><input aria-label="电表 ${i+1}" data-page="${index}" data-kind="meters" data-row="${i}" data-key="meter" value="${escape(m.meter)}"></td><td><input aria-label="累计示数 ${i+1}" type="number" min="0" step="any" data-page="${index}" data-kind="meters" data-row="${i}" data-key="reading" value="${m.reading??''}" class="${m.reading===null?'missing':''}"></td></tr>${m.note?`<tr><td colspan="3" class="row-note">待核对：${escape(m.note)}</td></tr>`:''}`).join('')}</tbody></table></div>`;
}
function billFields(result,index){
  const fields=[['month','结算月份','month'],['energy','上网电量（度）','number'],['price','含税单价（元/度）','number'],['amount','含税金额（元）','number'],['revenue','售电收入（确认金额，元）','number'],['amountExTax','不含税金额（元）','number'],['tax','税额（元）','number']];
  return result.bills.map((b,i)=>`<h3>电费结算单${result.bills.length>1?` · ${i+1}`:''}</h3><div class="billbox"><input class="titleinput" aria-label="结算单元" data-page="${index}" data-kind="bills" data-row="${i}" data-key="settlementUnit" value="${escape(b.settlementUnit)}" placeholder="填写结算单元"><p class="source-label">售电方：${escape(b.seller)||'未识别'}</p><label class="companyfield">归属公司（请确认）<input data-page="${index}" data-kind="bills" data-row="${i}" data-key="company" value="${escape(b.company??'')}" placeholder="填写这条上网记录归属的公司"></label>${b.company==='新鑫钢结构'?`<label class="companyfield">对应变压器<select data-page="${index}" data-kind="bills" data-row="${i}" data-key="transformer"><option value="">请选择变压器</option>${['250变压器','1000变压器'].map(t=>`<option value="${t}" ${b.transformer===t?'selected':''}>${t}</option>`).join('')}</select><span class="source-label">同月两条结算电量：较大 → 1000变压器，较小 → 250变压器。请核对。</span></label>`:''}<div class="billfields">${fields.map(([key,label,type])=>`<label>${label}<input type="${type}" ${type==='number'?'min="0" step="any"':''} data-page="${index}" data-kind="bills" data-row="${i}" data-key="${key}" value="${escape(b[key]??'')}" class="${(key==='energy'&&b.energy===null)||(key==='month'&&!b.month)?'missing':''}"></label>`).join('')}</div><p class="source-label" style="margin-top:10px">售电收入需你确认；结算金额不会自动当作已收到的收入。</p><div class="warnings" data-warnings="${index}-${i}">${billWarnings(b).map(escape).join('；')}</div><div class="bill-actions"><button class="button secondary" data-confirm-revenue="${index}-${i}">按结算金额确认收入</button><button class="button primary" data-save-sale="${index}-${i}" disabled>保存上网记录</button></div></div>`).join('');
}
function renderResults(){
  const recognized=pages.map((p,i)=>({p,i})).filter(({p})=>p.result);const count=recognized.reduce((s,{p})=>s+p.result.meters.length+p.result.bills.length,0);
  $('resultEmpty').hidden=!!recognized.length;$('results').hidden=!recognized.length;
  $('resultCount').textContent=recognized.length?`${count} 条数据`:'等待识别';
  $('resultBody').innerHTML=recognized.map(({p,i})=>`<section class="result-section"><p class="source-label">${escape(p.name)} · 第 ${p.page} 页</p>${meterTable(p.result,i)}${billFields(p.result,i)}${!p.result.meters.length&&!p.result.bills.length?'<p class="empty-found">此页未识别到抄表示数或电费结算数据。</p>':''}</section>`).join('');
  buttonState();
}
$('resultBody').addEventListener('input',e=>{
  const el=e.target;if(!el.dataset.key)return;
  const {page,kind,row,key}=el.dataset,item=pages[Number(page)].result[kind][Number(row)];
  item[key]=el.type==='number'?number(el.value):el.value;
  el.classList.toggle('missing',(key==='reading'||key==='energy')?item[key]===null:key==='month'&&!item[key]);
  if(kind==='bills')$('resultBody').querySelector(`[data-warnings="${page}-${row}"]`).textContent=billWarnings(item).join('；');
  $('reviewed').checked=false;buttonState();
});
$('resultBody').addEventListener('change',e=>{
  const {page,kind,row,key}=e.target.dataset;
  if(kind!=='bills'||!['company','month','energy','settlementUnit'].includes(key))return;
  const item=pages[Number(page)].result.bills[Number(row)];
  if(item.company==='新鑫钢构')item.company='新鑫钢结构';
  item.transformer='';
  if(item.company==='新鑫钢结构'){
    const group=pages.flatMap(p=>p.result?.bills||[]).filter(b=>b.company===item.company&&b.month===item.month);
    group.forEach(b=>b.transformer='');mapBillTransformers(group);
  }
  renderResults();
});
$('reviewed').onchange=buttonState;
$('resultBody').addEventListener('click',e=>{
  const income=e.target.closest('[data-confirm-revenue]'),save=e.target.closest('[data-save-sale]');if(!income&&!save)return;
  const [page,row]=(income?.dataset.confirmRevenue||save.dataset.saveSale).split('-').map(Number),bill=pages[page].result.bills[row];
  if(income){if(bill.amount===null){status('请先补齐含税结算金额。',true);return;}bill.revenue=bill.amount;$('reviewed').checked=false;renderResults();status('已填入按结算金额确认的收入，请重新核对后保存。');return;}
  if(!$('reviewed').checked)return;
  try{
    const entry=prepareSale(bill,pages[page].name),records=readSales();
    if(matchingSale(records,entry)>=0&&!confirm(`${entry.company} / ${entry.settlementUnit} / ${entry.month} 已有上网记录。是否更新这条记录？`))return;
    saveSale(records,entry);renderSavedSales();status('上网电量、结算金额和确认的售电收入已保存在本浏览器。');
  }catch(error){status(error.message,true);}
});
function renderSavedSales(){
  try{
    const records=readSales();
    $('salesList').innerHTML=records.length?`<div class="tablewrap"><table><thead><tr><th>月份 / 归属</th><th>结算单元</th><th>上网电量（度）</th><th>结算金额（元）</th><th>售电收入（元）</th></tr></thead><tbody>${[...records].sort((a,b)=>b.month.localeCompare(a.month)).map(r=>`<tr><td>${escape(r.month)}<br>${escape(r.company)}</td><td>${escape(r.settlementUnit)}${r.transformer?`<br>${escape(r.transformer)}`:''}</td><td>${escape(r.energy)}</td><td>${escape(r.amount)}</td><td>${escape(r.revenue)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="sales-empty">暂未保存上网记录。识别结算单后，可在校对表中保存。</p>';
  }catch(error){$('salesList').textContent=error.message;}
}
$('exportSales').onclick=()=>{
  try{
    const records=readSales(),url=URL.createObjectURL(new Blob([JSON.stringify({version:1,type:'grid-sales',records},null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='上网电量及售电收入备份.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(error){status(error.message,true);}
};
window.addEventListener('storage',e=>{if(e.key===SALES_KEY)renderSavedSales();});
$('downloadButton').onclick=()=>{
  const data={version:1,reviewed:true,documents:pages.filter(p=>p.result).map(p=>({file:p.name,page:p.page,...p.result}))};
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='电费识别校对结果.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('已下载校对结果。此文件是识别数据，不是台账的整份备份文件。');
};
buttonState();
renderSavedSales();
if($('handoffButton')){
  const session=new URLSearchParams(location.hash.slice(1)).get('ledger-return'),ledgerOrigin='https://uxpeterongzbnn.github.io';
  let waiting=false,timer;
  window.addEventListener('message',e=>{
    if(!waiting||e.origin!==ledgerOrigin||e.source!==window.opener||e.data?.type!=='electricity-ledger-received'||e.data.session!==session)return;
    clearTimeout(timer);waiting=false;status('结果已传回原网站。请切回台账，确认目标电表后填入并保存；上网结算记录在台账识别窗口单独保存。');
  });
  $('handoffButton').onclick=()=>{
    if(!$('reviewed').checked){status('请先对照原件核对，并勾选“我已对照原件核对本次识别结果”，再传回台账。',true);$('reviewed').focus();return;}
    if(!session||!window.opener||window.opener.closed){status('请从原电费台账顶部的“识别照片 / PDF”按钮打开本工具，才能传回保存。当前结果仍保留在这里，也可以下载校对结果。',true);return;}
    const payload={version:1,reviewed:true,documents:pages.filter(p=>p.result).map(p=>({file:p.name,page:p.page,...p.result}))};
    waiting=true;clearTimeout(timer);window.opener.postMessage({type:'electricity-reader-result',session,payload},ledgerOrigin);
    status('正在将校对结果传回原台账…');
    timer=setTimeout(()=>{if(waiting){waiting=false;status('原台账未确认接收。请保持原台账标签页打开，并从该页面的固定识别按钮进入本工具；当前结果仍保留。',true);}},5000);
  };
}

window.addEventListener('ocr-progress',e=>{if(busy)status(String(e.detail));});
