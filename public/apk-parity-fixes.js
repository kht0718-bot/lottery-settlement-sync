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
  const refreshActiveSettlementView=()=>{
    try{
      const visible=id=>{const el=document.getElementById(id);return !!el&&!el.classList.contains('hidden');};
      if(visible('homeView')){
        if(typeof renderHomeDashboard==='function')void renderHomeDashboard();
        else document.querySelector('[data-view="home"]')?.click();
      }else if(visible('historyView'))document.getElementById('refreshBtn')?.click();
      else if(visible('inventoryView'))document.getElementById('refreshInventoryBtn')?.click();
      else if(visible('approvalView')&&window.__LOTTERY_WEB_ROLE__==='admin')document.getElementById('manageApprovalBtn')?.click();
    }catch{}
  };
  const observer=new MutationObserver(()=>{markRole();decorateSettlementForm();});
  observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true});
  setTimeout(()=>{markRole();decorateSettlementForm();},0);
  setTimeout(()=>{markRole();decorateSettlementForm();},300);
  setTimeout(()=>{markRole();decorateSettlementForm();},1000);
  setInterval(()=>{if(document.visibilityState==='visible'&&localStorage.getItem('webToken'))refreshActiveSettlementView();},10000);
})();
