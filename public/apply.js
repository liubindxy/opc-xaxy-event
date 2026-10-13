import{api,message,copy,showPreview}from'./shared.js';
const form=document.querySelector('#apply-form'), fields=document.querySelector('#form-fields'), output=document.querySelector('#form-message');
let widget=null;
try{
  const event=await api('/api/event');showPreview(event);
  document.querySelector('#event-title').textContent=event.title;document.querySelector('#event-date').textContent=event.date_label;document.querySelector('#event-venue').textContent=event.venue;document.querySelector('#capacity').textContent=event.capacity;
  document.querySelector('#closed').hidden=!!event.registration_open;
  fields.disabled=!event.registration_open;
  if(event.registration_open&&!event.preview){
    fields.disabled=true;
    if(!event.turnstile_site_key)message(document.querySelector('#load-message'),'报名验证尚未配置，请联系主办方。',true);
    else{
      const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.onload=()=>{widget=window.turnstile.render('#turnstile',{sitekey:event.turnstile_site_key,action:'apply','error-callback':()=>message(output,'验证加载失败，请检查网络后刷新。',true)});fields.disabled=false;};
      script.onerror=()=>message(output,'验证加载失败，请刷新后重试。',true);document.head.append(script);
    }
  }
}catch(e){message(document.querySelector('#load-message'),e.message,true);}
form.addEventListener('submit',async e=>{
  e.preventDefault();const data=Object.fromEntries(new FormData(form));
  for(const key of ['laptop','full_attendance','share_project','consent'])data[key]=form.elements[key].checked;
  data.source=(new URLSearchParams(location.search).get('source')||'direct').slice(0,80);
  data.turnstile_token=widget===null?'':window.turnstile.getResponse(widget);
  const submit=document.querySelector('#submit');submit.disabled=true;message(output,'正在提交…');
  try{const result=await api('/api/applications',{method:'POST',body:JSON.stringify(data)});
    const link=`${location.origin}/status#${result.token}`;
    form.hidden=true;document.querySelector('#receipt').hidden=false;document.querySelector('#receipt-id').textContent=result.id;document.querySelector('#receipt-link').value=link;document.querySelector('#view-status').href=link;
    document.querySelector('#receipt').scrollIntoView({behavior:'smooth',block:'center'});
  }catch(error){message(output,error.message,true);if(widget!==null)window.turnstile.reset(widget);}finally{submit.disabled=false;}
});
document.querySelector('#copy-link').addEventListener('click',async()=>{const button=document.querySelector('#copy-link');try{await copy(document.querySelector('#receipt-link').value);button.textContent='已复制，请妥善保存';}catch(e){button.textContent=e.message;}});
