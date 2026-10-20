const $=s=>document.querySelector(s);
const uid=()=>crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2);
const dev=localStorage.mzDev||(localStorage.mzDev=uid());
const api=async(u,o={})=>{const r=await fetch(u,{headers:{'Content-Type':'application/json'},method:o.method,body:o.body?JSON.stringify(o.body):undefined});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'Request failed');return j;};
const say=(el,t,ok)=>{el.innerHTML='';if(!t)return;const d=document.createElement('div');d.className='msg'+(ok?' ok':'');d.textContent=t;el.append(d);};
const dur=s=>s>=86400?(s/86400)+(s===86400?' day':' days'):s>=3600?(s/3600)+(s===3600?' hour':' hours'):(s/60)+' minutes';
let pkg=null,pay=null,timer=null;
async function load(){
 const [list,cfg]=await Promise.all([api('/api/packages'),api('/api/config')]);
 $('#simBox').hidden=!cfg.simulator;$('#noProv').hidden=cfg.simulator;
 const g=$('#grid');g.innerHTML='';
 if(!list.length)g.innerHTML='<p class="muted">No packages are on sale right now. Ask the operator.</p>';
 list.forEach(p=>{const c=document.createElement('div');c.className='card pick';c.tabIndex=0;
  c.innerHTML='<h3></h3><div class="price"></div><p class="muted"></p>';
  c.querySelector('h3').textContent=p.name;c.querySelector('.price').innerHTML=p.priceTzs.toLocaleString()+'<small>TZS</small>';
  c.querySelector('p').textContent=dur(p.durationSeconds)+' - up to '+p.maxDevices+(p.maxDevices>1?' devices':' device');
  const pick=()=>{pkg=p;$('#coTitle').textContent=p.name;$('#coInfo').textContent=p.priceTzs.toLocaleString()+' TZS for '+dur(p.durationSeconds);
   ['#step2','#step3'].forEach(x=>$(x).hidden=true);$('#step1').hidden=false;say($('#coMsg'),'');$('#checkout').hidden=false;$('#pkgs').hidden=true;$('#phone').focus();};
  c.onclick=pick;c.onkeydown=e=>{if(e.key==='Enter')pick()};g.append(c);});
}
$('#back').onclick=()=>{$('#checkout').hidden=true;$('#pkgs').hidden=false;};
$('#go').onclick=async()=>{try{pay=await api('/api/orders',{method:'POST',body:{packageId:pkg.id,phone:$('#phone').value}});
 $('#ref').textContent=pay.reference;$('#step1').hidden=true;$('#step2').hidden=false;say($('#coMsg'),'');}catch(e){say($('#coMsg'),e.message);}};
const sim=o=>async()=>{try{const r=await api('/api/dev/pay/'+pay.paymentId,{method:'POST',body:{outcome:o}});
 if(r.code){$('#vcode').textContent=r.code;$('#step2').hidden=true;$('#step3').hidden=false;say($('#coMsg'),'');}
 else say($('#coMsg'),r.status==='FAILED'?'Payment failed. You were not charged. Try again from the package list.':'This payment was already processed.');}catch(e){say($('#coMsg'),e.message);}};
$('#simOk').onclick=sim('ok');$('#simNo').onclick=sim('fail');
async function redeem(code,out){try{const r=await api('/api/vouchers/redeem',{method:'POST',body:{code,deviceId:dev}});say(out,'Connected. Enjoy your session.',true);show(r.expiresAt);}catch(e){say(out,e.message);}}
$('#useIt').onclick=()=>redeem($('#vcode').textContent,$('#coMsg'));
$('#redeem').onclick=()=>redeem($('#vin').value,$('#rMsg'));
function show(exp){$('#status').hidden=false;clearInterval(timer);const t=()=>{let s=Math.max(0,Math.floor((new Date(exp)-Date.now())/1000));
 $('#left').textContent=[Math.floor(s/3600),Math.floor(s%3600/60),s%60].map(n=>String(n).padStart(2,'0')).join(':');
 if(!s){clearInterval(timer);$('#status').querySelector('h2').textContent='Session ended';}};t();timer=setInterval(t,1000);}
load().catch(e=>say($('#grid'),e.message));
api('/api/sessions/me?deviceId='+encodeURIComponent(dev)).then(r=>{if(r.active)show(r.expiresAt)}).catch(()=>{});
