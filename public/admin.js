const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const api=async(u,o={})=>{const r=await fetch(u,{headers:{'Content-Type':'application/json'},method:o.method,body:o.body?JSON.stringify(o.body):undefined});const j=await r.json().catch(()=>({}));if(r.status===401&&!u.includes('login')){gate();throw new Error('Please sign in');}if(!r.ok)throw new Error(j.error||'Request failed');return j;};
const when=d=>d?new Date(d).toLocaleString():'-';
const pill=s=>`<span class="pill ${['SUCCEEDED','ACTIVE','AVAILABLE','PAID'].includes(s)?'good':['FAILED','REVOKED'].includes(s)?'bad':''}">${esc(s)}</span>`;
const table=(rows,cols)=>rows.length?`<div class="scroll"><table><tr>${cols.map(c=>`<th>${c[0]}</th>`).join('')}</tr>${rows.map(r=>`<tr>${cols.map(c=>`<td>${c[1](r)}</td>`).join('')}</tr>`).join('')}</table></div>`:'<p class="muted">Nothing here yet.</p>';
const note=(t,ok)=>`<div class="msg${ok?' ok':''}">${esc(t)}</div>`;
const tabs={
 async Dashboard(){const d=await api('/api/admin/dashboard');
  return `${d.enforcing?'':note('Network controller: '+d.controller+'. Traffic is NOT being blocked or allowed yet; this is a software-only test.')}
  <div class="grid">${[['Confirmed revenue',d.revenueTzs.toLocaleString()+' TZS'],['Paid',d.paid],['Pending',d.pending],['Failed',d.failed],['Active sessions',d.activeSessions],['Unused vouchers',d.availableVouchers]].map(x=>`<div class="card"><p class="muted">${x[0]}</p><div class="stat">${x[1]}</div></div>`).join('')}</div>`;},
 async Packages(){const l=await api('/api/admin/packages');
  return table(l,[['Name',p=>esc(p.name)],['Price (TZS)',p=>p.priceTzs.toLocaleString()],['Minutes',p=>p.durationSeconds/60],['Devices',p=>p.maxDevices],['Status',p=>pill(p.isActive?'ACTIVE':'OFF')],['',p=>`<button class="btn ghost" data-act="pkg" data-id="${p.id}" data-on="${p.isActive}">${p.isActive?'Deactivate':'Activate'}</button>`]])+
  `<div class="card" style="margin-top:18px"><h3>Add package</h3><div class="row"><div><label>Name</label><input id="pn"></div><div><label>Price (TZS)</label><input id="pp" type="number"></div><div><label>Minutes</label><input id="pd" type="number"></div><div><label>Devices</label><input id="px" type="number" value="1"></div></div><button class="btn" data-act="addpkg">Save package</button><div id="m"></div></div>`;},
 async Payments(){return table(await api('/api/admin/payments'),[['Reference',p=>esc(p.internalReference)],['Phone',p=>esc(p.order.phone)],['Package',p=>esc(p.order.package.name)],['TZS',p=>p.amountTzs.toLocaleString()],['Status',p=>pill(p.status)],['Created',p=>when(p.createdAt)]]);},
 async Vouchers(){const [l,pk]=await Promise.all([api('/api/admin/vouchers'),api('/api/admin/packages')]);
  return `<div class="card"><h3>Issue free voucher</h3><select id="vp">${pk.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select><button class="btn" data-act="issue">Create voucher</button><div id="m"></div></div><br>`+
  table(l,[['ID',v=>v.id],['Package',v=>esc(v.package.name)],['Status',v=>pill(v.status)],['Expires',v=>when(v.expiresAt)],['',v=>v.status==='REVOKED'?'':`<button class="btn ghost" data-act="revoke" data-id="${v.id}">Revoke</button>`]]);},
 async Sessions(){return table(await api('/api/admin/sessions'),[['ID',x=>x.id],['Device',x=>esc(x.deviceId.slice(0,8))],['Started',x=>when(x.startedAt)],['Expires',x=>when(x.expiresAt)],['Status',x=>pill(x.status)],['',x=>x.status==='ACTIVE'?`<button class="btn ghost" data-act="kick" data-id="${x.id}">Disconnect</button>`:'']]);},
 async Audit(){return table(await api('/api/admin/audit'),[['When',a=>when(a.createdAt)],['Actor',a=>esc(a.actor)],['Action',a=>esc(a.action)],['Details',a=>esc(a.meta)]]);}
};
let cur='Dashboard';
async function render(t){cur=t||cur;$('#tabs').innerHTML=Object.keys(tabs).map(k=>`<button class="${k===cur?'on':''}" data-tab="${k}">${k}</button>`).join('');
 try{$('#view').innerHTML=await tabs[cur]();}catch(e){$('#view').innerHTML=note(e.message);}}
function gate(){$('#app').hidden=true;$('#out').hidden=true;$('#login').hidden=false;}
$('#in').onclick=async()=>{try{await api('/api/admin/login',{method:'POST',body:{email:$('#em').value,password:$('#pw').value}});$('#login').hidden=true;$('#app').hidden=false;$('#out').hidden=false;render('Dashboard');}catch(e){$('#lMsg').innerHTML=note(e.message);}};
$('#out').onclick=async()=>{await api('/api/admin/logout',{method:'POST'});gate();};
document.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;
 if(b.dataset.tab)return render(b.dataset.tab);
 const a=b.dataset.act;if(!a)return;const id=b.dataset.id;const m=()=>$('#m');
 try{
  if(a==='pkg')await api('/api/admin/packages/'+id,{method:'PATCH',body:{isActive:b.dataset.on!=='true'}});
  if(a==='addpkg')await api('/api/admin/packages',{method:'POST',body:{name:$('#pn').value,priceTzs:+$('#pp').value,durationSeconds:+$('#pd').value*60,maxDevices:+$('#px').value}});
  if(a==='revoke'&&confirm('Revoke this voucher and end its sessions?'))await api('/api/admin/vouchers/'+id+'/revoke',{method:'POST'});
  if(a==='kick'&&confirm('Disconnect this session?'))await api('/api/admin/sessions/'+id+'/disconnect',{method:'POST'});
  if(a==='issue'){const r=await api('/api/admin/vouchers',{method:'POST',body:{packageId:+$('#vp').value}});await render();$('#m').innerHTML=note('New voucher code (shown once): '+r.code,true);return;}
  await render();
 }catch(err){if(m())m().innerHTML=note(err.message);}});
api('/api/admin/dashboard').then(()=>{$('#app').hidden=false;$('#out').hidden=false;render('Dashboard');}).catch(()=>{});
