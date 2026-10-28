const clean=value=>String(value??'').replace(/\s+/g,'');
const numeric=value=>/^\d+(?:\.\d+)?$/.test(clean(value).replace(/[,，]/g,''))?Number(clean(value).replace(/[,，]/g,'')):null;
export function blocks(rows){
  if(!Array.isArray(rows)||rows.length>3000)throw Error('识别结果格式不完整。');
  return rows.flatMap(row=>{
    const box=row.poly??row.box;
    if(!Array.isArray(box)||box.length!==4||box.some(p=>!Array.isArray(p)||p.length!==2||p.some(v=>!Number.isFinite(v))))return [];
    const xs=box.map(p=>p[0]),ys=box.map(p=>p[1]);
    return [{text:String(row.text??row.txt??'').slice(0,500),score:Number(row.score),x:(Math.min(...xs)+Math.max(...xs))/2,y:(Math.min(...ys)+Math.max(...ys))/2,left:Math.min(...xs),right:Math.max(...xs),top:Math.min(...ys),bottom:Math.max(...ys),height:Math.max(...ys)-Math.min(...ys)}];
  }).sort((a,b)=>a.y-b.y||a.x-b.x);
}
const rowNumbers=(items,marker)=>items.filter(b=>b.left>marker.right+3&&Math.abs(b.y-marker.y)<Math.max(12,marker.height*.8)&&numeric(b.text)!==null).sort((a,b)=>a.x-b.x).map(b=>numeric(b.text));
function totalValues(items,marker){
  const names=['结算电量合计','结算不含税电费合计','税率(%)','税额','结算含税电费小计'];
  const headers=names.map(name=>items.filter(b=>b.y<marker.y&&clean(b.text).replace('税費','税额').replaceAll('（','(').replaceAll('）',')')===name).at(-1));
  if(headers.some(b=>!b))return Array(5).fill(null);
  const edges=headers.slice(1).map((b,i)=>(headers[i].x+b.x)/2),cells=headers.map(()=>[]);
  for(const b of items)if(b.left>marker.right&&Math.abs(b.y-marker.y)<Math.max(12,marker.height*.8)&&numeric(b.text)!==null)cells[edges.filter(edge=>b.x>edge).length].push(numeric(b.text));
  return cells.map(c=>c.length===1?c[0]:null);
}
function parseBills(items){
  const header=items.find(b=>clean(b.text)==='结算单元'),subtotals=items.filter(b=>clean(b.text)==='结算小计');
  if(!header||!subtotals.length)throw Error('未完整识别结算单元或小计，请上传清晰完整的原单。');
  const monthMatch=items.map(b=>clean(b.text).match(/(20\d{2})年(\d{1,2})月/)).find(Boolean);
  const month=monthMatch?monthMatch[1]+'-'+monthMatch[2].padStart(2,'0'):'';
  const head=items.find(b=>b.y<header.y&&b.text.includes('新能源科技有限公司'));
  let seller=head?.text??'';
  const unclosed=()=>[...seller].filter(c=>'（('.includes(c)).length>[...seller].filter(c=>'）)'.includes(c)).length;
  if(head&&unclosed())for(const b of items){
    if(b.y<=head.y||b.y>head.y+head.height*1.8||b.left<head.left-15||b.right>head.right+15)continue;
    if(/地址|云南省/.test(b.text))break;
    seller+=b.text;if(!unclosed())break;
  }
  const bills=[];let top=header.y+header.height/2;
  for(const subtotal of subtotals){
    const values=rowNumbers(items,subtotal);
    const unit=items.filter(b=>top<b.y&&b.y<subtotal.y+subtotal.height/2&&b.x<(header.x+subtotal.x)/2).map(b=>b.text).join('');
    const [energy,price,amount]=values.length===3?values:[null,null,null];
    const plant=seller.match(/[（(]([^）)]+)[）)]/)?.[1]??'';
    bills.push({seller,settlementUnit:unit,company:plant,month,energy,price,amount,revenue:null,tax:null,amountExTax:null,note:values.length===3?'浏览器识别摘录，请对照原单核对；售电收入未确认。':'本行数字未完整识别，请补齐电量、单价和金额。'});
    top=subtotal.y+subtotal.height/2;
  }
  const total=items.find(b=>clean(b.text)==='合计总'&&b.y>top),totals=total?totalValues(items,total):Array(5).fill(null);
  if(totals[0]!==null&&totals[4]!==null){
    if(bills.length===1){
      bills[0].amountExTax=totals[1];bills[0].tax=totals[3];
      if(bills[0].energy===null){bills[0].energy=totals[0];bills[0].amount=totals[4];bills[0].note='仅有一个结算单元，电量和金额取整单合计；单价请核对，售电收入未确认。';}
    }
    if(bills.every(b=>b.energy!==null&&b.amount!==null)&&(Math.abs(bills.reduce((n,b)=>n+b.energy,0)-totals[0])>.01||Math.abs(bills.reduce((n,b)=>n+b.amount,0)-totals[4])>.03))bills.forEach(b=>b.note+=' 分单元加总与整单合计不同，请核对后再保存。');
  }
  return {date:'',meters:[],bills};
}
function meterValue(b){
  const text=clean(b.text).replaceAll('：',':').replaceAll('；',':').replace(/^[-—]+|[-—]+$/g,'');
  if(/[年月日]/.test(text))return null;
  const match=text.match(/^(.*?)[;:=](\d{1,7}(?:\.\d{1,3})?)$/);
  let company='',reading,meter='',rawMeter='';
  if(match){
    const token=match[1].match(/(\d{1,2}|千)(?:号|表|#)?$/);
    if(!token)return null;
    company=match[1].slice(0,token.index).replace(/[^\u4e00-\u9fff]/g,'');rawMeter=token[1];meter=/^\d$/.test(rawMeter)?rawMeter+'号':'';reading=Number(match[2]);
  }else{
    const plain=text.match(/^([\u4e00-\u9fff]{0,20})[乏{｛]?(\d{1,7}\.\d{1,3})$/);
    if(!plain)return null;company=plain[1];reading=Number(plain[2]);
  }
  return {company,reading,meter,rawMeter,valueLeft:b.right-(b.right-b.left)*String(match?.[2]??text.match(/\d+\.\d+$/)?.[0]??'').length/Math.max(1,text.length)};
}
function labels(items){
  const list=items.flatMap(b=>{
    const v=meterValue(b),name=v?v.company:clean(b.text);
    if(!/^[\u4e00-\u9fff]{1,30}$/.test(name)||/[年月日号]/.test(name))return [];
    const label={...b,text:name};
    if(v){label.right=b.left+(b.right-b.left)*name.length/clean(b.text).length;label.x=(label.left+label.right)/2;}
    return [label];
  }),merged=[],used=new Set();
  for(let i=0;i<list.length;i++){
    if(used.has(i))continue;let label=list[i];
    if(label.text.length===1){
      const next=list.map((p,j)=>({p,j})).filter(({p,j})=>j!==i&&!used.has(j)&&p.text.length===1&&p.y>label.y&&p.top-label.bottom<Math.max(p.height,label.height)&&Math.abs(p.x-label.x)<Math.max(p.right-p.left,label.right-label.left)).sort((a,b)=>a.p.y-b.p.y)[0];
      if(next){label={...label,text:label.text+next.p.text,bottom:next.p.bottom,right:Math.max(label.right,next.p.right),y:(label.top+next.p.bottom)/2};used.add(next.j);}
    }
    if(label.text.length>1)merged.push(label);
  }
  return merged;
}
export function parseRows(rows){
  const items=blocks(rows);
  if(items.some(b=>['结算小计','电费结算单','结算单元'].some(marker=>clean(b.text).includes(marker))))return parseBills(items);
  const dateMatch=items.map(b=>clean(b.text).match(/(20\d{2})年(\d{1,2})月(\d{1,2})[日号]?/)).find(Boolean);
  const date=dateMatch?dateMatch[1]+'-'+dateMatch[2].padStart(2,'0')+'-'+dateMatch[3].padStart(2,'0'):'';
  const companyLabels=labels(items),meters=[];
  for(const b of items){
    let value=meterValue(b);
    if(numeric(b.text)!==null){
      const nearby=items.filter(p=>p.right<b.left&&Math.abs(p.y-b.y)<Math.max(12,b.height*.5)&&/^\d{1,2}号[:：]?$/.test(clean(p.text))).sort((a,b)=>b.right-a.right)[0];
      if(nearby){const token=nearby.text.replace(/\D/g,'');value={company:'',meter:token+'号',rawMeter:token,reading:numeric(b.text),valueLeft:b.left};}
    }
    if(!value)continue;
    const distance=p=>Math.max(p.top-b.y,b.y-p.bottom,0);
    const label=companyLabels.filter(p=>0<=value.valueLeft-p.right&&value.valueLeft-p.right<=b.height*3&&distance(p)<=b.height*2).sort((a,c)=>(distance(a)+Math.abs(value.valueLeft-a.right)*.15)-(distance(c)+Math.abs(value.valueLeft-c.right)*.15))[0];
    let note='手写内容请逐项核对企业归属、表号和小数点。';
    if(!label)note+=' 未确定企业归属，尤其注意跨栏的 0 号表。';
    if(value.rawMeter&&!value.meter)note+=' 表号原文“'+value.rawMeter+'”未确定，请手动补齐。';
    let reading=value.reading;
    if(!Number.isFinite(b.score)||b.score<.85){reading=null;note+=' 示数识别置信度较低，已留空，请对照原图填写。';}
    meters.push({company:label?.text??'',meter:value.meter,reading,note});
  }
  if(!meters.length)throw Error('未读到可用的抄表示数或结算单，请上传清晰完整的原件。');
  return {date,meters,bills:[]};
}
