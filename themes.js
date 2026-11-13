/* Theme catalog contains presentation metadata only; no warehouse data or credentials. */
const THEME_CATALOG = [
 {id:"berry",name:"WB Berry",mode:"dark",description:"Исходная фиолетовая тема",background:"#0a0614",surface:"#130c22",accent:"#cb11ab"},
 {id:"sapphire",name:"Сапфир",mode:"dark",description:"Исходная синяя тема",background:"#050b1a",surface:"#0d1830",accent:"#3b82f6"},
 {id:"carbon",name:"Карбон",mode:"dark",description:"Исходная тёмная тема",background:"#09090b",surface:"#18181b",accent:"#a1a1aa"},
 {id:"quartz",name:"Кварц",mode:"light",description:"Исходная светлая тема",background:"#f4f4f5",surface:"#ffffff",accent:"#7c3aed"}
];
function initThemePicker() {
  $('themeGrid').innerHTML=THEME_CATALOG.map(t=>`<button type="button" class="theme-card" data-set-theme="${t.id}" data-theme-mode="${t.mode}" aria-pressed="false" style="--preview-bg:${t.background};--preview-surface:${t.surface};--preview-accent:${t.accent}"><span class="theme-preview" aria-hidden="true"><i></i><span><b></b><em></em><em></em></span></span><span class="theme-card-heading">${t.name}<span class="theme-check" aria-hidden="true">✓</span></span><small>${t.description}</small><span class="theme-mode-label">${t.mode==='light'?'Светлая':'Тёмная'}</span></button>`).join('');
  document.querySelectorAll('[data-open-themes]').forEach(button=>button.addEventListener('click',()=>{
    $('menuPop').classList.remove('show');
    document.querySelectorAll('[data-theme-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.themeFilter==='all')));
    document.querySelectorAll('.theme-card').forEach(card=>card.hidden=false);openModal('themeModal');
    setTimeout(()=>$('themeGrid').querySelector('[aria-pressed="true"]')?.focus(),0);
  }));
  document.querySelectorAll('[data-theme-filter]').forEach(button=>button.addEventListener('click',()=>{
    document.querySelectorAll('[data-theme-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
    document.querySelectorAll('.theme-card').forEach(card=>card.hidden=button.dataset.themeFilter!=='all'&&card.dataset.themeMode!==button.dataset.themeFilter);
  }));
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&$('themeModal').classList.contains('show')){event.preventDefault();event.stopImmediatePropagation();closeModal('themeModal');}
  },true);
  applyTheme(state.theme,false);
}
