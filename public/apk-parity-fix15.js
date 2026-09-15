/* APK parity fix: inventory is the current state of the latest approved settlement per product/draw. */
(function(){
  const products=["스피또500","스피또1000","스피또2000","연금복권"];
  const n=v=>Math.max(0,Number(v||0));
  const escv=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const api2=async(path)=>{const token=localStorage.getItem("webToken")||"";const headers=token?{Authorization:"Bearer "+token}:{};const r=await fetch(path,{headers});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||"요청에 실패했습니다.");return d;};
  window.loadInventory=async function(){
    const root=document.getElementById("inventoryList");
    if(!root)return;
    root.textContent="불러오는 중...";
    try{
      const d=await api2("/v1/web/settlements?limit=500");
      const latest=new Map();
      for(const x of d.settlements||[]){
        if(x.status!=="manager_approved")continue;
        const updated=Number(x.updatedAt||0);
        for(const i of (x.payload?.lotteryItems||[])){
          if(!products.includes(i.product))continue;
          const key=String(i.product)+"|"+String(i.draw||"");
          const old=latest.get(key);
          if(!old||updated>old.updated)latest.set(key,{updated,item:i});
        }
      }
      const groups=products.map(product=>({product,rows:[...latest.values()].filter(v=>v.item.product===product).sort((a,b)=>String(a.item.draw||"").localeCompare(String(b.item.draw||""),"ko"))})).filter(g=>g.rows.length);
      root.innerHTML=groups.length?groups.map(g=>'<section class="card"><h3>'+escv(g.product)+'</h3><div class="grid">'+g.rows.map(v=>{const i=v.item;const original=n(i.originalStock),pre=n(i.preWorkReturn),restock=n(i.restock),onDuty=n(i.onDutyReturn),ending=n(i.endingStock),adjusted=Math.max(0,original-pre),available=Math.max(0,adjusted+restock-onDuty),sold=Math.max(0,available-ending);return '<div class="stock-card"><b>'+escv(i.draw||"회차 미입력")+'</b><div class="stock-summary">원재고 '+original+'장 → 근무 전 반품 '+pre+'장 → 반영 재고 <b>'+adjusted+'장</b><br>입고 '+restock+'장 · 근무 중 반품 '+onDuty+'장<br>판매가능 '+available+'장 · 마감 '+ending+'장 · 판매 '+sold+'장</div></div>'}).join('')+'</div></section>').join(''):"승인된 재고 기록이 없습니다.";
    }catch(e){root.textContent=e.message||"재고를 불러오지 못했습니다.";}
  };
})();