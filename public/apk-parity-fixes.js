(() => {
  const applyRoleParity = () => {
    const role = window.__LOTTERY_WEB_ROLE__;
    if (!role) return;
    document.querySelectorAll('[data-view="manage"]').forEach((el) => {
      el.classList.toggle('hidden', role !== 'admin');
    });
  };
  const markRole = () => {
    try {
      const text = document.getElementById('userInfo')?.textContent || '';
      window.__LOTTERY_WEB_ROLE__ = text.includes('· 관리자') ? 'admin' : text.includes('· 직원') ? 'employee' : '';
      applyRoleParity();
    } catch {}
  };
  const observer = new MutationObserver(() => markRole());
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  setTimeout(markRole, 0);
  setTimeout(markRole, 300);
  setTimeout(markRole, 1000);
})();
