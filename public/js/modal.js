export function modal(title, msg, {input = false, confirm = false, defaultVal = ''} = {}) {
  return new Promise(resolve => {
    const bg = document.getElementById('modalBg');
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalMsg').textContent = msg;
    const inp = document.getElementById('modalInput');
    const cancel = document.getElementById('modalCancel');
    const ok = document.getElementById('modalOk');
    // Usar textarea se multilinha
    if (input && defaultVal.includes('\n')) {
      inp.style.display = 'none';
      let ta = document.getElementById('modalTextarea');
      if (!ta) {
        ta = document.createElement('textarea');
        ta.id = 'modalTextarea';
        ta.style.cssText = 'width:100%;height:120px;padding:6px;margin:8px 0;background:#1a1a2e;color:#e0e0e0;border:1px solid #444;border-radius:4px;font-size:14px;resize:vertical';
        inp.after(ta);
      }
      ta.style.display = '';
      ta.value = defaultVal;
      cancel.style.display = '';
      bg.classList.add('active');
      ta.focus();
      function close(val) { bg.classList.remove('active'); ta.style.display = 'none'; ok.onclick = null; cancel.onclick = null; resolve(val); }
      ok.onclick = () => close(ta.value);
      cancel.onclick = () => close(null);
    } else {
      let ta = document.getElementById('modalTextarea');
      if (ta) ta.style.display = 'none';
      inp.style.display = input ? '' : 'none';
      inp.value = defaultVal;
      cancel.style.display = confirm || input ? '' : 'none';
      bg.classList.add('active');
      if (input) inp.focus();
      function close(val) { bg.classList.remove('active'); ok.onclick = null; cancel.onclick = null; resolve(val); }
      ok.onclick = () => close(input ? inp.value : true);
      cancel.onclick = () => close(null);
      inp.onkeydown = e => { if (e.key === 'Enter') close(inp.value); };
    }
  });
}
