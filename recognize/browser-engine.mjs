import {parseRows} from './parse-ocr.mjs';
let worker=null,pending=null,sequence=0;
function stop(error){
  worker?.terminate();worker=null;
  if(pending){const current=pending;pending=null;current.cleanup();current.reject(error);}
}
function ensureWorker(){
  if(worker)return worker;
  if(typeof Worker!=='function'||typeof createImageBitmap!=='function')throw Error('此浏览器暂不支持网页识别，请使用新版 Edge 或 Chrome。');
  worker=new Worker(new URL('./recognition-worker.mjs',import.meta.url),{type:'module'});
  worker.onmessage=({data})=>{
    if(!pending||data.id!==pending.id)return;
    if(data.progress){window.dispatchEvent(new CustomEvent('ocr-progress',{detail:data.progress}));return;}
    const current=pending;pending=null;current.cleanup();
    if(data.error){current.reject(Error(data.error));return;}
    try{current.resolve(parseRows(data.rows));}catch(error){current.reject(error);}
  };
  worker.onerror=()=>stop(Error('识别引擎加载失败，请检查网络后重试。'));
  return worker;
}
export async function recognizeInBrowser(image,signal){
  if(signal?.aborted)throw signal.reason;
  if(pending)throw Error('上一页仍在识别，请稍候。');
  if(typeof image!=='string'||image.length>13*1024*1024||!/^data:image\/(png|jpeg|webp);base64,/.test(image))throw Error('图片数据无效。');
  const bitmap=await createImageBitmap(await(await fetch(image)).blob());
  if(signal?.aborted){bitmap.close();throw signal.reason;}
  let active;try{active=ensureWorker();}catch(error){bitmap.close();throw error;}
  return new Promise((resolve,reject)=>{
    const abort=()=>stop(signal.reason??new DOMException('识别已停止','AbortError'));
    pending={id:++sequence,resolve,reject,cleanup:()=>signal?.removeEventListener('abort',abort)};
    signal?.addEventListener('abort',abort,{once:true});
    try{active.postMessage({id:pending.id,image:bitmap},[bitmap]);}catch(error){bitmap.close();stop(error);}
  });
}
