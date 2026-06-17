export function modal(title, msg, {input = false, confirm = false, defaultVal = ''} = {}) {
  return new Promise(resolve => {
    const bg = document.getElementById('modalBg');
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalMsg').textContent = msg;
    const inp = document.getElementById('modalInput');
    const cancel = document.getElementById('modalCancel');
    const ok = document.getElementById('modalOk');
    inp.style.display = input ? '' : 'none';
    inp.value = defaultVal;
    cancel.style.display = confirm || input ? '' : 'none';
    bg.classList.add('active');
    if (input) inp.focus();
    function close(val) { bg.classList.remove('active'); ok.onclick = null; cancel.onclick = null; resolve(val); }
    ok.onclick = () => close(input ? inp.value : true);
    cancel.onclick = () => close(null);
    inp.onkeydown = e => { if (e.key === 'Enter') close(inp.value); };
  });
}
