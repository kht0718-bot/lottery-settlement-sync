(() => {
  const products=['스피또500','스피또1000','스피또2000','연금복권'];
  const applyRoleParity=()=>{
    const role=window.__LOTTERY_WEB_ROLE__;
    if(!role)return;
    document.querySelectorAll('[data-view="manage"]').forEach(el=>el.classList.toggle('hidden',role!=='admin'));
  };
  const markRole=()=>{
    try{
      const text=document.getElementById('userInfo')?.textContent||'';
      window.__LOTTERY_WEB_ROLE__=text.includes('· 관리자')?'admin':text.includes('· 직원')?'employee':'';
      applyRoleParity();
    }catch{}
  };
  const num=v=>Math.max(0,Number(v||0));
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const api=async path=>{const token=localStorage.getItem('webToken')||'';const r=await fetch(path,{headers:token?{Authorization:'Bearer '+token}:{}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||'요청에 실패했습니다.');return d;};
  window.loadInventory=async()=>{
    const root=document.getElementById('inventoryList');
    if(!root)return;
    root.textContent='불러오는 중...';
    try{
      const d=await api('/v1/web/settlements?limit=500');
      const latest=new Map();
      for(const x of d.settlements||[]){
        if(x.status!=='manager_approved')continue;
        const updated=Number(x.updatedAt||0);
        for(const i of x.payload?.lotteryItems||[]){
          if(!products.includes(i.product))continue;
          const key=String(i.product)+'|'+String(i.draw||'');
          const old=latest.get(key);
          if(!old||updated>old.updated)latest.set(key,{updated,item:i});
        }
      }
      const groups=products.map(product=>({product,rows:[...latest.values()].filter(v=>v.item.product===product).sort((a,b)=>String(a.item.draw||'').localeCompare(String(b.item.draw||''),'ko'))})).filter(g=>g.rows.length);
      root.innerHTML=groups.length?groups.map(g=>'<section class="card"><h3>'+esc(g.product)+'</h3><div class="grid">'+g.rows.map(v=>{const i=v.item;const original=num(i.originalStock),pre=num(i.preWorkReturn),restock=num(i.restock),onDuty=num(i.onDutyReturn),ending=num(i.endingStock),adjusted=Math.max(0,original-pre),available=Math.max(0,adjusted+restock-onDuty),sold=Math.max(0,available-ending);return '<div class="stock-card"><b>'+esc(i.draw||'회차 미입력')+'</b><div class="stock-summary">원재고 '+original+'장 → 근무 전 반품 '+pre+'장 → 반영 재고 <b>'+adjusted+'장</b><br>입고 '+restock+'장 · 근무 중 반품 '+onDuty+'장<br>판매가능 '+available+'장 · 마감 '+ending+'장 · 판매 '+sold+'장</div></div>'}).join('')+'</div></section>').join(''):'승인된 재고 기록이 없습니다.';
    }catch(e){root.textContent=e.message||'재고를 불러오지 못했습니다.';}
  };
  const observer=new MutationObserver(()=>markRole());
  observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true});
  setTimeout(markRole,0);setTimeout(markRole,300);setTimeout(markRole,1000);
})();
