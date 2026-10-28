import {number,billWarnings} from './ocr-core.mjs';
export const SALES_KEY='electricity-ledger:grid-sales:v1';
export function readSales(storage=localStorage){
  let records;try{records=JSON.parse(storage.getItem(SALES_KEY)||'[]');}catch{throw new Error('上网记录读取失败，未覆盖已有数据。');}
  if(!Array.isArray(records)||records.some(r=>!r||typeof r!=='object'||typeof r.company!=='string'||typeof r.month!=='string'))throw new Error('上网记录格式异常，未覆盖已有数据。');
  return records;
}
export function prepareSale(b,source=''){
  if(!b.company?.trim()||!b.settlementUnit?.trim()||!/^\d{4}-(0[1-9]|1[0-2])$/.test(b.month)||[b.energy,b.amount,b.revenue].some(v=>number(v)===null))throw new Error('请补齐归属公司、结算单元、月份、上网电量、结算金额和确认的售电收入。');
  if(b.company==='新鑫钢结构'&&!['250变压器','1000变压器'].includes(b.transformer))throw new Error('请确认新鑫钢构这条结算记录对应的变压器。');
  if(billWarnings(b).some(w=>w.startsWith('不含税金额 +')||w.startsWith('电量 × 单价')))throw new Error('金额校验未通过，请先核对结算金额、单价和税额。');
  return {company:b.company.trim(),settlementUnit:b.settlementUnit.trim(),...(b.transformer?{transformer:b.transformer}:{}),month:b.month,energy:number(b.energy),amount:number(b.amount),revenue:number(b.revenue),price:number(b.price),tax:number(b.tax),amountExTax:number(b.amountExTax),seller:b.seller||'',source,savedAt:new Date().toISOString()};
}
export function matchingSale(records,entry){return records.findIndex(r=>r.company===entry.company&&r.settlementUnit===entry.settlementUnit&&r.month===entry.month);}
export function saveSale(records,entry,storage=localStorage){
  const result=[...records],index=matchingSale(result,entry);if(index>=0)result[index]=entry;else result.push(entry);
  storage.setItem(SALES_KEY,JSON.stringify(result));return result;
}
