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
  const drawNumber=v=>{const m=String(v??'').match(/\d+/);return m?Number(m[0]):Number.POSITIVE_INFINITY;};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const api=async path=>{
    const token=localStorage.getItem('webToken')||'';
    const r=await fetch(path,{headers:token?{Authorization:'Bearer '+token}:{}});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.message||'요청에 실패했습니다.');
    return d;
  };
  const addParityStyles=()=>{
    if(document.getElementById('apkParityStyles'))return;
    const s=document.createElement('style');s.id='apkParityStyles';s.textContent=`
      .apk-parity-help{margin:8px 0 12px;padding:10px 12px;border-radius:10px;background:#f4f7fb;color:#526071;font-size:13px;line-height:1.55}
      .apk-return-row{border-left:3px solid #d7dee9;padding-left:10px}
      .apk-stock-title{font-size:14px;font-weight:800;margin-bottom:5px}
      .apk-stock-current{font-size:14px;margin-top:6px}
    `;document.head.appendChild(s);
  };
  const decorateSettlementForm=()=>{
    addParityStyles();
    const stock=document.getElementById('stockItems'),pre=document.getElementById('preReturnItems'),duty=document.getElementById('dutyAdjustItems'),end=document.getElementById('endingStockItems');
    const add=(root,html)=>{if(root&&!root.querySelector('.apk-parity-help'))root.insertAdjacentHTML('afterbegin',html)};
    add(stock,'<div class="apk-parity-help">품목과 회차별로 재고를 관리합니다. 예: <b>스피또1000 / 109회</b></div>');
    add(pre,'<div class="apk-parity-help apk-return-row"><b>근무 전 반품</b><br>반품 수량은 같은 품목·회차의 재고에서 차감되며 판매금액에는 반영되지 않습니다.</div>');
    add(duty,'<div class="apk-parity-help apk-return-row"><b>근무 중 입고 / 반품</b><br>반품은 해당 품목·회차 재고만 차감합니다.</div>');
    add(end,'<div class="apk-parity-help">마감 재고도 동일한 품목·회차 기준으로 입력합니다.</div>');
  };
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
      const groups=products.map(product=>({
        product,
        rows:[...latest.values()].filter(v=>v.item.product===product).sort((a,b)=>{const an=drawNumber(a.item.draw),bn=drawNumber(b.item.draw);return an===bn?String(a.item.draw||'').localeCompare(String(b.item.draw||''),'ko'):an-bn;})
      })).filter(g=>g.rows.length);
      root.innerHTML=groups.length?groups.map(g=>'<section class="card"><h3>'+esc(g.product)+'</h3><div class="grid">'+g.rows.map(v=>{
        const i=v.item;
        const original=num(i.originalStock),pre=num(i.preWorkReturn),restock=num(i.restock),onDuty=num(i.onDutyReturn),ending=num(i.endingStock);
        const adjusted=Math.max(0,original-pre);
        const available=Math.max(0,adjusted+restock-onDuty);
        const sold=Math.max(0,available-ending);
        return '<div class="stock-card"><div class="apk-stock-title">'+esc(i.draw||'회차 미입력')+'</div><div class="stock-summary">원재고 '+original+'장 → 근무 전 반품 <b>'+pre+'장</b> → 반영 재고 <b>'+adjusted+'장</b><br>입고 '+restock+'장 · 근무 중 반품 '+onDuty+'장<br>판매가능 '+available+'장 · 마감 '+ending+'장 · 판매 '+sold+'장</div><div class="apk-stock-current"><b>현재 재고: '+ending+'장</b></div></div>'
      }).join('')+'</div></section>').join(''):'승인된 재고 기록이 없습니다.';
    }catch(e){root.textContent=e.message||'재고를 불러오지 못했습니다.';}
  };
  const observer=new MutationObserver(()=>{markRole();decorateSettlementForm();});
  observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true});
  setTimeout(()=>{markRole();decorateSettlementForm();},0);
  setTimeout(()=>{markRole();decorateSettlementForm();},300);
  setTimeout(()=>{markRole();decorateSettlementForm();},1000);
})();
