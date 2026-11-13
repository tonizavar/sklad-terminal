/* Theme catalog contains presentation metadata only; no warehouse data or credentials. */
const THEME_CATALOG = [
  {
    "id": "berry",
    "name": "Графит",
    "mode": "dark",
    "description": "Тёплый акцент, спокойный рабочий пост",
    "background": "#121416",
    "surface": "#1a1d20",
    "accent": "#e5b969"
  },
  {
    "id": "sapphire",
    "name": "Сапфир",
    "mode": "dark",
    "description": "Холодный синий, строгие панели",
    "background": "#091426",
    "surface": "#11233d",
    "accent": "#89baff"
  },
  {
    "id": "carbon",
    "name": "Контраст",
    "mode": "dark",
    "description": "Чёрный, белый и яркий жёлтый",
    "background": "#000000",
    "surface": "#101010",
    "accent": "#ffee00"
  },
  {
    "id": "quartz",
    "name": "Фарфор",
    "mode": "light",
    "description": "Белый фон и лаконичные серые панели",
    "background": "#eef0f3",
    "surface": "#ffffff",
    "accent": "#364b65"
  },
  {
    "id": "forest",
    "name": "Лес",
    "mode": "dark",
    "description": "Глубокий зелёный и мягкие скругления",
    "background": "#0b1b14",
    "surface": "#142b20",
    "accent": "#a8d887"
  },
  {
    "id": "aurora",
    "name": "Аврора",
    "mode": "dark",
    "description": "Сливовые панели с бирюзовым акцентом",
    "background": "#1b102b",
    "surface": "#2c1b40",
    "accent": "#79e2d5"
  },
  {
    "id": "paper",
    "name": "Бумага",
    "mode": "light",
    "description": "Слоновая кость, терракота, книжный шрифт",
    "background": "#eee8dc",
    "surface": "#fffaf0",
    "accent": "#9c442b"
  },
  {
    "id": "ocean",
    "name": "Океан",
    "mode": "light",
    "description": "Светлый голубой и морская бирюза",
    "background": "#e6f2f8",
    "surface": "#f8fdff",
    "accent": "#086879"
  },
  {
    "id": "rose",
    "name": "Розовый кварц",
    "mode": "light",
    "description": "Пудровый фон, винные акценты, плавные формы",
    "background": "#f6e9ee",
    "surface": "#fffbfd",
    "accent": "#993a62"
  },
  {
    "id": "cobalt",
    "name": "Кобальт",
    "mode": "dark",
    "description": "Насыщенный синий, жёлтый и моноширинный шрифт",
    "background": "#101c61",
    "surface": "#1b2c84",
    "accent": "#ffe16b"
  },
  {
    "id": "copper",
    "name": "Медь",
    "mode": "dark",
    "description": "Тёплый угольный фон и медные детали",
    "background": "#231911",
    "surface": "#32251c",
    "accent": "#ffb47e"
  },
  {
    "id": "mint",
    "name": "Мята",
    "mode": "light",
    "description": "Светло-зелёные панели и округлые карточки",
    "background": "#e7f3e9",
    "surface": "#fafffa",
    "accent": "#236943"
  }
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
