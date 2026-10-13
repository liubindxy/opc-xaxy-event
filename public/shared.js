export const labels={pending:'待审核',approved:'已通过',waitlisted:'候补',rejected:'未通过'};
export async function api(path,options={}){
  const response=await fetch(path,{...options,headers:{'Content-Type':'application/json',...options.headers}});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'请求失败');
  return data;
}
export function message(element,text,error=false){element.textContent=text;element.className=`message ${error?'error':'success'}`;}
export async function copy(text){
  try{await navigator.clipboard.writeText(text);}catch{const area=document.createElement('textarea');area.value=text;document.body.append(area);area.select();const ok=document.execCommand('copy');area.remove();if(!ok)throw new Error('复制失败，请手动复制');}
}
export function showPreview(event){if(event.preview){const banner=document.createElement('div');banner.className='preview-banner';banner.textContent='本地演示环境 · 使用测试数据 · 管理员认证与防刷仅在本地演示中跳过';document.body.prepend(banner);}}
