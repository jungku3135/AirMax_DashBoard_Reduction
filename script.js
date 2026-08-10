/* ===== 버전 ===== */
const APP_VERSION = 'v2.5.0';
const APP_DATE    = '2026.08.10';

/* ===== 설정 ===== */
const ADMIN_PASSWORD       = 'airmax87';  /* 관리자 비밀번호 */
const SUPER_ADMIN_PASSWORD = 'wjdzn';    /* 슈퍼 관리자 비밀번호 */
const GAS_URL        = 'https://script.google.com/macros/s/AKfycbw61auB8x8HFf_lk-rxEnpjAY1e9AoIxs7yRkkttZG_wqoSHKxpy4w0YkFzjSoMc8nyNw/exec';
const API      = 'https://api-airmax.testonic.co.kr/api/external/reports';
const LS_EXTRA        = 'airmax_extra_ids';
const LS_EXCLUDE      = 'airmax_exclude_reasons';
const LS_ENDID        = 'airmax_end_id';
const LS_GLOBAL_ENDID = 'airmax_global_end_id';
const LS_ADMIN_AUTH = 'airmax_admin_auth'; // 'super' | 'admin' — 한번 인증하면 만료 없이 유지
const LS_THEME = 'airmax_theme';
const LS_MODE  = 'airmax_mode';
const LS_PROD_LOCS    = 'airmax_product_locations';
const LS_SHEET_CACHE  = 'airmax_sheet_cache';
const LS_DUST_EXTRA   = 'airmax_dust_extra_ids';
const CACHE_TTL       = 3600000; // 1시간 (ms)

const isMobile = () => window.innerWidth <= 768;

/* ===== 상태 ===== */
let selectedZones   = new Set();
let zoneGridOpen    = false;
let zoneLangFilter  = 'ALL';     // 영역 선택 패널 언어 필터 — ALL|KO|ZH|JA
let adminAuthenticated      = false;
let superAdminAuthenticated = false;
let sheetZones      = [];   // [{name, ids[]}] — GAS 시트에서 로드
let productLocations    = {};   // {id: loc} — GAS 시트에서 로드
let productLocEditorOpen = false;
let peEditMode = false;
let peOriginals = {};

/* ===== 히스토리 / 주간 점검 요청서 ===== */
const LS_REQUESTERS = 'airmax_requesters';
const LS_LAST_REQUESTER = 'airmax_last_requester';
let currentPage = 'inspection'; // 'inspection' | 'history'
let historyMonths = [];         // ["26년 7월", ...] — GAS에서 로드
let historyLoadedMonth = null;
let historyGridData = null;     // {sheetName, dates, rows}
let historyFilterQ = '';
let historyDayFilterIdx = -1;   // -1 = 전체 일자, 그 외엔 dates 배열 인덱스
let weeklyDraft = null;         // getWeeklyReportDraft 결과
let overdueBadgeItems = [];     // 30일 이상 지속오류 배지 상세 목록
let requesterList = [];

let results=[], currentFilter='ALL', currentView='grid', currentMode='range';
let logVisible=false, logs=[], extraIds=[], dustExtraIds=[];
let excludeReasons={}; // {id: reason}
let isGlobalLocked=false;
let selectedDustZones=new Set();
let dustZoneLangFilter='ALL';    // 먼지 포집 영역 선택 패널 언어 필터 — ALL|KO|ZH|JA
let lastResults = [];
let lastDateRange=null, cardDetailModalOpen=false;
let collectStartMs=null;   // 데이터 수집 시작 시각 — 소요 시간 표시용(참고용, 정확한 계측 아님)
let singleAllItems=[], singlePage=0, singleShowAll=false, singleChartDust=null, singleChartMotor=null;
let dustDays=[], dustModalChart=null, dustModalOpen=false;
const cardDetailCache=new Map();
let cardDetailChartDust=null, cardDetailChartMotor=null;
const dustResultMap=new Map();
const SINGLE_PAGE_SIZE=30;

const STATUS = {
  OK:   {label:'OK',  icon:'check_circle', cls:'card-ok',   textVar:'--ok-text',  chipBgVar:'--ok-chip-bg',  chipBdVar:'--ok-chip-border',  chipTxVar:'--ok-chip-text'  },
  NO:   {label:'NO',  icon:'cancel',       cls:'card-no',   textVar:'--no-text',  chipBgVar:'--no-chip-bg',  chipBdVar:'--no-chip-border',  chipTxVar:'--no-chip-text'  },
  EM:   {label:'EM',  icon:'bolt',         cls:'card-em',   textVar:'--em-text',  chipBgVar:'--em-chip-bg',  chipBdVar:'--em-chip-border',  chipTxVar:'--em-chip-text'  },
  PM:   {label:'PM',  icon:'build',        cls:'card-pm',   textVar:'--pm-text',  chipBgVar:'--pm-chip-bg',  chipBdVar:'--pm-chip-border',  chipTxVar:'--pm-chip-text'  },
  ERR:  {label:'ERR', icon:'warning',      cls:'card-err',  textVar:'--err-text', chipBgVar:'--err-chip-bg', chipBdVar:'--err-chip-border', chipTxVar:'--err-chip-text' },
  LOAD: {label:'···', icon:'',             cls:'card-load', textVar:'--text4',    chipBgVar:'--input-bg',    chipBdVar:'--border',          chipTxVar:'--text4'         },
};

/* ===== 유틸 ===== */
function lsGet(k,d){try{const v=localStorage.getItem(k);return v!==null?JSON.parse(v):d;}catch{return d;}}
function lsSet(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch{}}
function escHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}


function renderSummaryDonut(counts){
  const el=document.getElementById('summaryDonut');
  if(!el) return;
  const order=['OK','NO','EM','PM','ERR'];
  const isDark=document.documentElement.getAttribute('data-theme')==='dark';
  const hexColors=isDark
    ?{OK:'#a0ca92',NO:'#b8b3b0',EM:'#8ab4d6',PM:'#e08d7c',ERR:'#e0b458'}
    :{OK:'#7fa870',NO:'#a39d97',EM:'#5f8fb3',PM:'#c17262',ERR:'#c19752'};
  const total=order.reduce((s,k)=>s+(counts[k]||0),0);
  if(!total){el.innerHTML='';return;}
  const r=18,C=2*Math.PI*r;
  let cum=0;
  const segs=order.filter(k=>(counts[k]||0)>0).map(k=>{
    const pct=(counts[k]||0)/total;
    const seg=`<circle cx="22" cy="22" r="${r}" fill="none" stroke="${hexColors[k]}" stroke-width="7"
      stroke-dasharray="${(pct*C).toFixed(2)} ${((1-pct)*C).toFixed(2)}"
      stroke-dashoffset="${(-cum*C).toFixed(2)}"
      transform="rotate(-90 22 22)"/>`;
    cum+=pct;return seg;
  }).join('');
  el.innerHTML=`<svg width="44" height="44" viewBox="0 0 44 44">${segs}</svg>`;
}

/* ===== 테마 ===== */
function toggleTheme(){
  const html=document.documentElement;
  const next=html.getAttribute('data-theme')==='dark'?'light':'dark';
  html.setAttribute('data-theme',next); lsSet(LS_THEME,next);
  document.getElementById('themeIcon').textContent=next==='dark'?'light_mode':'dark_mode';
  if(results && results.length && document.getElementById('summary').style.display!=='none') renderSummary();
  if(singleAllItems.length){
    const start=singlePage*SINGLE_PAGE_SIZE;
    renderSingleChart([...singleAllItems.slice(start,start+SINGLE_PAGE_SIZE)].reverse());
  }
  if(dustModalOpen && dustDays.length) renderDustChart(dustDays, next==='dark', 'dustModalCanvas');
}

function toggleAdminPwVisibility(){
  const input=document.getElementById('adminPwInput');
  const icon=document.querySelector('#adminPwToggleBtn .material-icons-round');
  const show=input.type==='password';
  input.type=show?'text':'password';
  icon.textContent=show?'visibility_off':'visibility';
}

/* ===== 관리자 인증 ===== */
function authenticateAdmin(){
  const pw=document.getElementById('adminPwInput').value;
  const badge=document.getElementById('adminAuthBadge');

  if(pw===SUPER_ADMIN_PASSWORD){
    adminAuthenticated=true;
    superAdminAuthenticated=true;
    lsSet(LS_ADMIN_AUTH,'super');
    _applyAdminAuthedUI('super');
  } else if(pw===ADMIN_PASSWORD){
    adminAuthenticated=true;
    superAdminAuthenticated=false;
    lsSet(LS_ADMIN_AUTH,'admin');
    _applyAdminAuthedUI('admin');
  } else {
    badge.textContent='✗ 비밀번호 오류'; badge.className='admin-auth-badge fail';
    setTimeout(()=>{ badge.textContent=''; badge.className='admin-auth-badge'; },2500);
  }
}

// 인증 성공 시(또는 새로고침 후 저장된 인증 복원 시) UI 반영 — 비밀번호는 한 번만 입력하면 만료 없이 유지됨
function _applyAdminAuthedUI(level){
  const badge=document.getElementById('adminAuthBadge');
  const inp=document.getElementById('adminPwInput');
  if(level==='super'){
    badge.textContent='✓ 슈퍼 관리자'; badge.className='admin-auth-badge super';
  } else {
    badge.textContent='✓ 일반 관리자'; badge.className='admin-auth-badge ok';
  }
  inp.value=''; inp.disabled=true;
  document.getElementById('deauthBtn').style.display='inline-block';
  document.getElementById('adminActionsRow').style.display='flex';
  _applyDustAuthUI();
  updateRunBtnText(); updateSheetBtn(); updatePageTabsVisibility();
  fetchOverdueBadge();
}

/* 30일 이상 지속된 오류 건수를 관리자 로그인 시 백그라운드로 조회해 배지로 표시.
   실패해도 조용히 무시 — 부가 정보일 뿐 기존 흐름에 영향 없음 */
async function fetchOverdueBadge(){
  const badge=document.getElementById('overdueBadge');
  if(!badge||!GAS_URL) return;
  try{
    const res=await fetch(GAS_URL,{method:'POST',headers:{'Content-Type':'text/plain'},
      body:JSON.stringify({action:'getWeeklyReportDraft', asOfDate:todayStr()})});
    const json=await res.json();
    if(json.success && Array.isArray(json.overdueItems) && json.overdueItems.length){
      overdueBadgeItems=json.overdueItems;
      badge.innerHTML=`<span class="material-icons-round" style="font-size:13px;vertical-align:-2px;margin-right:3px">history_toggle_off</span>30일 이상 지속 ${json.overdueItems.length}건`;
      badge.title='클릭하면 상세 목록을 볼 수 있습니다';
      badge.style.display='inline-flex';
    } else {
      overdueBadgeItems=[];
      badge.style.display='none';
    }
  }catch(e){ overdueBadgeItems=[]; badge.style.display='none'; }
}

function openOverdueBadgeModal(){
  if(!overdueBadgeItems.length) return;
  document.getElementById('overdueBadgeTable').innerHTML=
    `<thead><tr><th>순번</th><th>오류 발생 시점</th><th>제품 ID</th><th>설치 장소</th><th>오류 코드</th></tr></thead>
     <tbody>${overdueBadgeItems.map((it,i)=>`<tr><td>${i+1}</td><td>${escHtml(it.since)}</td><td>${escHtml(it.id)}</td><td>${escHtml(wrLocText(it))}</td><td class="wr-code wr-code-${it.code.toLowerCase()}">${it.code}</td></tr>`).join('')}</tbody>`;
  document.getElementById('overdueBadgeModal').style.display='flex';
}
function closeOverdueBadgeModal(){
  document.getElementById('overdueBadgeModal').style.display='none';
}
function overdueBadgeOverlayClick(e){
  if(e.target.id==='overdueBadgeModal') closeOverdueBadgeModal();
}

function updatePageTabsVisibility(){
  const tabs=document.getElementById('pageTabs');
  if(!tabs) return;
  tabs.style.display=adminAuthenticated?'flex':'none';
  if(!adminAuthenticated && currentPage==='history') switchPage('inspection');
}

function _applyDustAuthUI(){
  const notMsg=document.getElementById('dustNotAuthMsg');
  const area=document.getElementById('dustSearchArea');
  const blocked = isMobile() && !adminAuthenticated;
  if(notMsg) notMsg.style.display=blocked?'block':'none';
  if(area) area.style.display=blocked?'none':'block';
  if(!blocked) renderDustZoneGrid();
}

function deauthAdmin(){
  adminAuthenticated=false;
  superAdminAuthenticated=false;
  lsSet(LS_ADMIN_AUTH,null);
  const badge=document.getElementById('adminAuthBadge');
  badge.textContent=''; badge.className='admin-auth-badge';
  document.getElementById('adminPwInput').disabled=false;
  document.getElementById('deauthBtn').style.display='none';
  document.getElementById('adminActionsRow').style.display='none';
  document.getElementById('productEditorSection').style.display='none';
  productLocEditorOpen=false;
  _applyDustAuthUI();
  updateRunBtnText(); updateSheetBtn(); updatePageTabsVisibility();
}

function updateRunBtnText(){
  const btn=document.getElementById('runBtn');
  const mBtn=document.getElementById('mobileRunBtn');
  const dustBtn=document.getElementById('dustRangeBtn');
  btn.style.display='';
  mBtn.style.display='';
  dustBtn.style.display='none';
  if(currentMode==='dust'){
    btn.style.display='none';
    mBtn.style.display='none';
    dustBtn.style.display='';
    return;
  }
  btn.textContent='점검 시작';
  mBtn.textContent='점검 시작';
}

function updateSheetBtn(){
  const btn=document.getElementById('saveSheetBtn');
  btn.style.display=(adminAuthenticated && currentMode==='range' && lastResults.length>0)?'inline-block':'none';
}

/* ===== GAS 저장 ===== */
async function saveToSheet(){
  if(!GAS_URL){
    alert('GAS_URL이 설정되지 않았습니다.\nscript.js 상단의 GAS_URL 변수에 배포된 Google Apps Script URL을 입력해주세요.');
    return;
  }
  if(!lastResults.length){ alert('저장할 결과가 없습니다.'); return; }
  const btn=document.getElementById('saveSheetBtn');
  btn.disabled=true; btn.textContent='저장 중…';
  try {
    const res=await fetch(GAS_URL,{
      method:'POST',
      headers:{'Content-Type':'text/plain'},
      body:JSON.stringify({results:lastResults.map(r=>({id:r.id,status:excludeReasons[r.id]||r.status})), savedAt:new Date().toISOString()})
    });
    const json=await res.json();
    if(json.success){
      btn.textContent=`✓ ${json.updated}/${json.total}개 저장 완료`;
      addLog(`시트 저장 완료 — ${json.sheet} [${json.col}] ${json.updated}/${json.total}건`,'ok');
      if(json.notFound&&json.notFound.length) addLog('미등록 ID: '+json.notFound.join(', '),'warn');
    } else {
      btn.textContent='저장 실패';
      addLog('시트 저장 실패: '+(json.error||'알 수 없는 오류'),'err');
      alert('시트 저장 실패\n\n'+(json.error||'알 수 없는 오류'));
    }
    setTimeout(()=>{ btn.textContent='시트에 저장'; btn.disabled=false; },3000);
  } catch(e) {
    addLog('시트 저장 오류: '+e.message,'err');
    alert('저장 중 오류가 발생했습니다.\n\n'+e.message+'\n\nGAS URL 또는 배포 설정을 확인해주세요.');
    btn.textContent='시트에 저장'; btn.disabled=false;
  }
}

/* ===== 시트 데이터 로드 (영역 + 설치장소, 캐시 1시간) ===== */
async function loadSheetData(force=false){
  const cached=lsGet(LS_SHEET_CACHE,null);
  const now=Date.now();
  const expired=!cached||(now-cached.ts)>CACHE_TTL;

  if(cached&&cached.zones){
    sheetZones=cached.zones;
    productLocations=Object.assign({},cached.locations||{});
    historyMonths=cached.monthSheets||[];
    renderZoneGrid();
    renderDustZoneGrid();
  }

  if((expired||force)&&GAS_URL){
    try{
      const res=await fetch(GAS_URL);
      const json=await res.json();
      if(json.success){
        sheetZones=json.zones||[];
        productLocations=Object.assign({},json.locations||{});
        historyMonths=json.monthSheets||[];
        lsSet(LS_SHEET_CACHE,{ts:now,zones:sheetZones,locations:json.locations||{},monthSheets:historyMonths});
        renderZoneGrid();
        renderDustZoneGrid();
        const msg=force?'시트 데이터 새로고침 완료'
          :(cached?'시트 데이터 갱신':'시트 데이터 로드');
        addLog(`${msg} — 영역 ${sheetZones.length}개, 설치 장소 ${Object.keys(json.locations||{}).length}건`,'ok');
        if(force) alert(`영역 새로고침 완료\n\n영역 ${sheetZones.length}개, 설치 장소 ${Object.keys(json.locations||{}).length}건 로드됨`);
      }
    }catch(e){
      if(!cached) addLog('시트 데이터 로드 실패 (GAS 미설정 또는 오류): '+e.message,'warn');
    }
  }
}

/* ===== 날짜 ===== */
function fmtDate(d){ return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function todayStr(){ return fmtDate(new Date()); }
function yesterdayStr(){ const d=new Date(); d.setDate(d.getDate()-1); return fmtDate(d); }

function getDateRange(mode){
  const today=todayStr(), yest=yesterdayStr();
  if(mode==='single'){
    const s=document.getElementById('singleStartDate').value||(yest+'T00:00');
    const e=document.getElementById('singleEndDate').value||(today+'T23:59');
    return{started_at:s.split('T')[0], finished_at:e.split('T')[0]};
  }
  if(mode==='zone'){
    return{started_at:yest, finished_at:today};
  }
  // range: 금일 00:00 ~ 현재
  return{started_at:today, finished_at:today};
}

function updateDateInfo(){
  const dr=getDateRange(currentMode);
  const txt=dr.started_at===dr.finished_at
    ? `조회 기간  ${dr.started_at}${dr.started_at===todayStr()?' (금일)':''}`
    : `조회 기간  ${dr.started_at} ~ ${dr.finished_at}`;
  document.getElementById('dateInfo').textContent=txt;
}

/* ===== 모드 전환 ===== */
function switchMode(mode){
  currentMode=mode; lsSet(LS_MODE,mode);
  ['range','single','zone','dust'].forEach(m=>{
    const cap=m.charAt(0).toUpperCase()+m.slice(1);
    const tabEl=document.getElementById('tab'+cap);
    const panelEl=document.getElementById('panel'+cap);
    if(tabEl) tabEl.classList.toggle('active',m===mode);
    if(panelEl) panelEl.style.display=m===mode?'block':'none';
  });
  if(mode==='zone') renderZoneGrid();
  updateMobileFixedBtn();
  updateRunBtnText();
  updateSheetBtn();
  if(mode==='dust'){
    document.getElementById('dateInfo').textContent='조회 기간  2026-04 ~';
    _applyDustAuthUI();
  } else {
    updateDateInfo();
  }
  if(mode!=='single'){
    document.getElementById('singleResultSection').style.display='none';
  }
  if(mode!=='dust'){
    document.getElementById('dustResultSection').style.display='none';
  }
  if(mode==='single'||mode==='dust'){
    document.getElementById('summary').style.display='none';
    document.getElementById('grid').style.display='none';
    document.getElementById('listView').style.display='none';
    document.getElementById('listToolbar').style.display='none';
  } else {
    if(results.length){
      document.getElementById('grid').style.display=currentView==='grid'?'grid':'none';
      document.getElementById('listView').style.display=currentView==='list'?'block':'none';
      document.getElementById('listToolbar').style.display=currentView==='list'?'flex':'none';
      document.getElementById('summary').style.display='flex';
    }
  }
  const psh=document.getElementById('preSearchHint');
  if(psh) psh.style.display=(mode!=='single'&&mode!=='dust'&&!results.length)?'':'none';
}

/* ===== 모바일 고정 버튼 ===== */
function updateMobileFixedBtn(){
  document.body.classList.toggle('zone-active', currentMode==='zone' && selectedZones.size>0);
  updateMobileZoneInfo();
}

function updateMobileZoneInfo(){
  const infoEl=document.getElementById('mobileZoneInfo');
  const cnt=selectedZones.size;
  if(cnt===0){ infoEl.textContent='영역을 선택하세요'; return; }
  const total=[...selectedZones].reduce((s,i)=>s+(sheetZones[i]?sheetZones[i].ids.length:0),0);
  infoEl.textContent=`${cnt}개 영역 · ${total}개 제품`;
}

/* ===== 영역 그리드 접기/펼치기 ===== */
function _applyZoneGridUI(open,wrapId,arrowId,btnId){
  const wrap=document.getElementById(wrapId);
  const arrow=document.getElementById(arrowId);
  const btn=document.getElementById(btnId);
  if(wrap) wrap.classList.toggle('open',open);
  if(arrow) arrow.classList.toggle('open',open);
  if(btn) btn.querySelector('span').textContent=open?'접기':'펼치기';
}
function toggleZoneGrid(){
  zoneGridOpen=!zoneGridOpen;
  _applyZoneGridUI(zoneGridOpen,'zoneGridWrap','zoneArrow','zoneToggleBtn');
}

function filterZones(){ renderZoneGrid(); }

/* 영역명에 쓰인 문자 체계로 언어 추정 — 한글 > 가나(일본어 고유) > 그 외 한자(중국어로 간주).
   순수 한자만 쓰인 일본 지명은 중국어로 분류될 수 있는 한계는 있음(휴리스틱) */
function detectZoneLang(name){
  if(/[가-힣ᄀ-ᇿ㄰-㆏]/.test(name)) return 'KO';
  if(/[぀-ゟ゠-ヿ]/.test(name)) return 'JA';
  if(/[一-鿿]/.test(name)) return 'ZH';
  return 'OTHER';
}

function _renderZoneGrid(gridId,noResultId,searchId,selSet,toggleFn,isOpen,openFn,afterFn,langFilter){
  const gridEl=document.getElementById(gridId); if(!gridEl) return;
  const q=(document.getElementById(searchId)?.value||'').trim().toLowerCase();
  const hasLangFilter=langFilter&&langFilter!=='ALL';
  gridEl.innerHTML=sheetZones.map((z,i)=>{
    const sel=selSet.has(i);
    const rangeText=z.ids.length===1?z.ids[0]:`${z.ids[0]}~${z.ids[z.ids.length-1]} (${z.ids.length}개)`;
    const matchesQuery=!q||z.name.toLowerCase().includes(q);
    const matchesLang=!hasLangFilter||detectZoneLang(z.name)===langFilter;
    const hidden=(!matchesQuery||!matchesLang)?'hidden':'';
    return`<button class="zone-btn ${sel?'selected':''} ${hidden}" onclick="${toggleFn}(${i})">
      <span class="zone-name">${escHtml(z.name)}</span>
      <span class="zone-range">${rangeText}</span>
    </button>`;
  }).join('');
  const noRes=document.getElementById(noResultId);
  const allHidden=!gridEl.querySelector('.zone-btn:not(.hidden)');
  if(noRes) noRes.style.display=allHidden?'block':'none';
  if((q||hasLangFilter)&&!isOpen) openFn();
  afterFn();
}
function _updateZoneInfo(selSet,el,fmt){
  if(!el) return;
  const cnt=selSet.size;
  const total=[...selSet].reduce((s,i)=>s+(sheetZones[i]?sheetZones[i].ids.length:0),0);
  el.textContent=cnt===0?'선택된 영역 없음':fmt(cnt,total);
}
function _toggleZoneItem(selSet,i,renderFn){ if(selSet.has(i)) selSet.delete(i); else selSet.add(i); renderFn(); }

function renderZoneGrid(){
  _renderZoneGrid('zoneGrid','zoneNoResult','zoneSearchInput',selectedZones,'toggleZone',zoneGridOpen,toggleZoneGrid,updateZoneCount,zoneLangFilter);
}
function setZoneLangFilter(lang){
  zoneLangFilter=lang;
  document.querySelectorAll('#zoneLangFilter .zone-lang-btn').forEach(b=>b.classList.toggle('active',b.dataset.lang===lang));
  renderZoneGrid();
}
function updateZoneCount(){
  _updateZoneInfo(selectedZones,document.getElementById('zoneSelectCount'),(c,t)=>`${c}개 영역 / 총 ${t}개 제품 선택됨`);
  updateMobileFixedBtn();
}
function toggleZone(i){ _toggleZoneItem(selectedZones,i,renderZoneGrid); }

function clearZones(){
  selectedZones.clear();
  renderZoneGrid();
}

/* ===== 시트 데이터 강제 새로고침 (관리자) ===== */
function refreshSheetData(){
  const btn=document.getElementById('zoneRefreshBtn');
  if(btn){ btn.disabled=true; btn.innerHTML='<span class="material-icons-round ico">hourglass_empty</span>불러오는 중…'; }
  addLog('시트 데이터 새로고침 중…','muted');
  loadSheetData(true).finally(()=>{
    if(btn){ btn.disabled=false; btn.innerHTML='<span class="material-icons-round ico">refresh</span>영역 새로고침'; }
  });
}

/* ===== ID 입력 제한 ===== */
function restrictIdInput(e){
  const allowed=['Backspace','Delete','ArrowLeft','ArrowRight','Tab','Enter'];
  if(allowed.includes(e.key))return;
  if(/^[a-zA-Z0-9]$/.test(e.key)){
    if(e.target.value.length>=4){e.preventDefault();return;}
    if(/^[a-z]$/.test(e.key)){
      e.preventDefault();
      const pos=e.target.selectionStart;
      e.target.value=e.target.value.slice(0,pos)+e.key.toUpperCase()+e.target.value.slice(e.target.selectionEnd);
      e.target.setSelectionRange(pos+1,pos+1);
    }
    return;
  }
  e.preventDefault();
}

/* ===== 전역 잠금 ===== */
function setGlobalLock(locked){
  isGlobalLocked=locked;
  ['runBtn','mobileRunBtn','dustRangeBtn','tabRange','tabSingle','tabZone','tabDust'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.disabled=locked;
  });
}

/* ===== 추가 ID ===== */
function _addExtraId(arr,lsKey,inputId,renderFn){
  const inp=document.getElementById(inputId);
  inp.value.trim().split(',').map(v=>v.trim()).filter(Boolean).forEach(v=>{if(!arr.includes(v))arr.push(v);});
  inp.value=''; lsSet(lsKey,arr); renderFn();
}
function _renderExtraTags(arr,rowId,removeFn){
  const row=document.getElementById(rowId); if(!row) return;
  row.style.display=arr.length?'flex':'none';
  row.innerHTML=arr.map(id=>`<span class="extra-id-tag">${escHtml(id)}<button onclick="${removeFn}('${escHtml(id)}')" title="삭제">×</button></span>`).join('');
}
function addExtraId(){ _addExtraId(extraIds,LS_EXTRA,'extraIdInput',renderExtraTags); }
function removeExtraId(id){ extraIds=extraIds.filter(v=>v!==id); lsSet(LS_EXTRA,extraIds); renderExtraTags(); }
function renderExtraTags(){ _renderExtraTags(extraIds,'extraTagsRow','removeExtraId'); }

function addExcludeId(){
  const inp=document.getElementById('excludeIdInput');
  const sel=document.getElementById('excludeReasonSel');
  if(!inp||!sel) return;
  const ids=inp.value.split(',').map(s=>s.trim().toUpperCase()).filter(Boolean);
  const reason=sel.value;
  if(!ids.length||!reason) return;
  ids.forEach(id=>{ excludeReasons[id]=reason; });
  lsSet(LS_EXCLUDE,excludeReasons);
  inp.value='';
  renderExcludeTags();
}
function removeExcludeId(id){
  delete excludeReasons[id];
  lsSet(LS_EXCLUDE,excludeReasons);
  renderExcludeTags();
}
function renderExcludeTags(){
  const row=document.getElementById('excludeTagsRow');
  if(!row) return;
  row.innerHTML=Object.entries(excludeReasons).map(([id,reason])=>
    `<span class="extra-id-tag">${escHtml(id)}<span class="exclude-tag-reason"> — ${escHtml(reason)}</span><button onclick="removeExcludeId('${escHtml(id)}')" title="삭제">×</button></span>`
  ).join('');
}
function addDustExtraId(){ _addExtraId(dustExtraIds,LS_DUST_EXTRA,'dustExtraIdInput',renderDustExtraTags); }
function removeDustExtraId(id){ dustExtraIds=dustExtraIds.filter(v=>v!==id); lsSet(LS_DUST_EXTRA,dustExtraIds); renderDustExtraTags(); }
function renderDustExtraTags(){ _renderExtraTags(dustExtraIds,'dustExtraTagsRow','removeDustExtraId'); }

/* ===== ID 유틸 ===== */
function parseId(id){
  const m=id.trim().toUpperCase().match(/^([A-Z]*)(\d+)$/);
  if(!m)return null;
  return{prefix:m[1],num:parseInt(m[2],10),padLen:m[2].length};
}
function formatId(prefix,num,padLen){return prefix+String(num).padStart(padLen,'0');}

/* ===== 시간/분류 ===== */
function parseFormatTime(str){
  if(!str)return null;
  const d=new Date(str.replace(/\./g,'-').replace(' ','T'));
  return isNaN(d.getTime())?null:d;
}
function classify(item,nowMs,id){
  if(!item)return'NO';
  const d=parseFormatTime(item.format_created_time);
  if(!d)return'NO';
  // 전 제품 통신 주기가 10분으로 변경돼 최근 30분 이내 통신 기록이 없으면 NO로 판정 (G004/G005 포함, 예외 없음)
  if((nowMs-d.getTime())/60000>=30)return'NO';
  // G004/G005는 통신(전원) 확인용 제품 — 30분 이내 통신만 확인되면 판독값(pm/co2)과 무관하게 OK
  if(id==='G004'||id==='G005')return'OK';
  const{pm_2_5,pm_10,co2}=item;
  if(pm_2_5===0&&pm_10===0&&co2===0)return'EM';
  if(pm_2_5===0&&pm_10===0&&co2!==0)return'PM';
  return'OK';
}

/* ===== API ===== */
async function fetchReport(controllerId,dateRange,token){
  const p=new URLSearchParams({controller_id:controllerId,started_at:dateRange.started_at,finished_at:dateRange.finished_at,per_page:'100'});
  const res=await fetch(`${API}?${p}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'}});
  if(!res.ok){const body=await res.text().catch(()=>'');throw new Error(`HTTP ${res.status}: ${body.slice(0,80)}`);}
  const json=await res.json();
  const data=json.data;
  if(!Array.isArray(data)||data.length===0)return null;
  return data[0];
}

async function fetchAllReports(controllerId,dateRange,token,onProgress){
  const PER=100;
  const hdrs={Authorization:`Bearer ${token}`,Accept:'application/json'};
  const base={controller_id:controllerId,started_at:dateRange.started_at,finished_at:dateRange.finished_at,per_page:String(PER)};

  const r1=await fetch(`${API}?${new URLSearchParams({...base,page:'1'})}`,{headers:hdrs});
  if(!r1.ok){const b=await r1.text().catch(()=>'');throw new Error(`HTTP ${r1.status}: ${b.slice(0,80)}`);}
  const j1=await r1.json();
  const all=Array.isArray(j1.data)?[...j1.data]:[];
  const lastPage=j1.meta?.last_page??j1.last_page??1;
  if(onProgress) onProgress(1,lastPage);

  if(lastPage>1){
    const pages=Array.from({length:lastPage-1},(_,i)=>i+2);
    const rest=await Promise.all(pages.map(async pg=>{
      const r=await fetch(`${API}?${new URLSearchParams({...base,page:String(pg)})}`,{headers:hdrs});
      if(!r.ok) return [];
      const j=await r.json();
      if(onProgress) onProgress(pg,lastPage);
      return Array.isArray(j.data)?j.data:[];
    }));
    rest.forEach(d=>all.push(...d));
  }
  return all;
}

/* ===== 로그 ===== */
function addLog(msg,type='muted'){
  logs.push({t:new Date().toLocaleTimeString('ko-KR'),msg,type});
  if(logVisible)renderLog();
}
function renderLog(){
  const box=document.getElementById('debugBox');
  box.innerHTML=logs.map(l=>`<div class="log-${l.type}">[${l.t}] ${escHtml(l.msg)}</div>`).join('');
  box.scrollTop=box.scrollHeight;
}
function toggleLog(){
  logVisible=!logVisible;
  document.getElementById('debugBox').style.display=logVisible?'block':'none';
  document.getElementById('logBtn').textContent=logVisible?'로그 닫기':'로그 보기';
  if(logVisible)renderLog();
}

/* ===== 로딩 ===== */
// 참고용 경과 시간 문자열(예: "3.2초") — 정확한 계측이 아닌 대략적인 표시용
function elapsedText(){
  if(!collectStartMs) return '';
  return `${((Date.now()-collectStartMs)/1000).toFixed(1)}초`;
}
function setLoading(on,done=0,total=0){
  document.getElementById('loadingOverlay').classList.toggle('active',on);
  if(on){
    if(done===0) collectStartMs=Date.now();
    document.getElementById('loadingBar').style.width=(total>0?Math.round(done/total*100):0)+'%';
    const base=total>0?`데이터 수집 중… ${done} / ${total}`:'데이터 수집 중…';
    const et=elapsedText();
    document.getElementById('loadingText').textContent=et?`${base}  (${et})`:base;
  }
}

/* ===== Summary ===== */
function renderSummary(){
  const counts={};
  results.forEach(r=>{counts[r.status]=(counts[r.status]||0)+1;});
  const chipsHtml=['ALL','OK','NO','EM','PM','ERR'].map(s=>{
    const isAll=s==='ALL', cfg=isAll?null:STATUS[s];
    const cnt=isAll?results.length:(counts[s]||0);
    const active=currentFilter===s;
    let bg,bd,tx;
    if(active){
      bg=isAll?'var(--input-bg)':`var(${cfg.chipBgVar})`;
      bd=isAll?'var(--text3)':`var(${cfg.chipBdVar})`;
      tx=isAll?'var(--text2)':`var(${cfg.chipTxVar})`;
    }else{bg='transparent';bd='var(--chip-def-border)';tx='var(--chip-def-text)';}
    return`<button class="chip" onclick="setFilter('${s}')" style="border-color:${bd};background:${bg}">
      <span class="chip-label" style="color:${tx}">${isAll?'전체':cfg.label}</span>
      <span class="chip-count" style="color:${active?tx:'var(--chip-def-count)'};">${cnt}</span>
    </button>`;
  }).join('');
  const viewHtml=`<div class="summary-right">
    <div id="summaryDonut" class="summary-donut"></div>
    <div class="view-tabs">
      <button class="view-tab ${currentView==='grid'?'active':''}" onclick="switchView('grid')">그리드</button>
      <button class="view-tab ${currentView==='list'?'active':''}" onclick="switchView('list')">리스트</button>
    </div>
  </div>`;
  document.getElementById('summary').innerHTML=chipsHtml+viewHtml;
  renderSummaryDonut(counts);
}

/* ===== Grid / List ===== */
function renderGrid(){
  const filtered=currentFilter==='ALL'?results:results.filter(r=>r.status===currentFilter);
  if(!filtered.length){
    const msg=currentFilter==='ALL'?'검색 결과가 없습니다':'해당 상태의 결과가 없습니다';
    document.getElementById('grid').innerHTML=`<div class="empty-inline"><span class="material-icons-round empty-inline-icon">search_off</span><span>${msg}</span></div>`;
    return;
  }
  document.getElementById('grid').innerHTML=filtered.map(r=>{
    const cfg=STATUS[r.status]||STATUS.LOAD;
    const loc=productLocations[r.id]||'';
    const tip=r.errMsg?escHtml(r.errMsg):r.item
      ?`PM10: ${r.item.pm_10}㎍/㎥<br>PM2.5: ${r.item.pm_2_5}㎍/㎥<br>CO₂: ${r.item.co2}ppm<br><span class="tooltip-time">수집: ${escHtml(r.item.format_created_time)}</span>`
      :'<span style="display:block;text-align:center">데이터 없음</span>';
    const exReason=excludeReasons[r.id]||'';
    return`<div class="card ${cfg.cls}" data-id="${escHtml(r.id)}" onclick="openCardDetailModal('${escHtml(r.id)}')">
      <div class="card-status" style="color:var(${cfg.textVar})">${cfg.icon?`<span class="material-icons-round card-icon">${cfg.icon}</span>`:''}${cfg.label}</div>
      <div class="card-id">${escHtml(r.id)}</div>
      ${exReason?`<div class="exclude-reason-badge">${escHtml(exReason)}</div>`:''}
      ${loc?`<div class="card-location">${escHtml(loc)}</div>`:''}
      ${r.item?`<div class="card-meta">${r.item.pm_10}㎍/㎥ | ${r.item.pm_2_5}㎍/㎥ | ${r.item.co2}ppm</div>`:''}
      ${r.status==='ERR'&&r.errMsg?`<div class="card-err-text">${escHtml(r.errMsg.slice(0,50))}</div>`:''}
      <div class="tooltip">${tip}</div>
    </div>`;
  }).join('');
}

/* ===== 제품 편집 (시트 연동) ===== */
function toggleProductEditor(){
  productLocEditorOpen=!productLocEditorOpen;
  const sec=document.getElementById('productEditorSection');
  sec.style.display=productLocEditorOpen?'block':'none';
  if(productLocEditorOpen) refreshProductEditorDropdowns(), renderProductEditor();
}

function refreshProductEditorDropdowns(){
  const zones=[...new Set(sheetZones.map(z=>z.name))];
  const filterSel=document.getElementById('peZoneFilter');
  const newZoneSel=document.getElementById('peNewZone');
  const curFilter=filterSel.value;
  filterSel.innerHTML='<option value="">전체 영역</option>'+zones.map(z=>`<option value="${escHtml(z)}"${z===curFilter?'selected':''}>${escHtml(z)}</option>`).join('');
  newZoneSel.innerHTML='<option value="">영역 선택</option>'+zones.map(z=>`<option value="${escHtml(z)}">${escHtml(z)}</option>`).join('');
}

function toggleNewZoneCustom(){
  const custom=document.getElementById('peNewZoneCustomToggle').checked;
  document.getElementById('peNewZone').style.display=custom?'none':'block';
  document.getElementById('peNewZoneCustom').style.display=custom?'block':'none';
}

function renderProductEditor(){
  const zoneFilter=document.getElementById('peZoneFilter').value;
  const q=document.getElementById('peSearch').value.trim().toLowerCase();
  const allProducts=[];
  sheetZones.forEach(z=>z.ids.forEach(id=>{
    allProducts.push({id, zone:z.name, loc:productLocations[id]||''});
  }));
  allProducts.sort((a,b)=>a.id.localeCompare(b.id));
  const filtered=allProducts.filter(p=>{
    if(zoneFilter && p.zone!==zoneFilter) return false;
    if(q && !p.id.toLowerCase().includes(q) && !p.zone.toLowerCase().includes(q) && !p.loc.toLowerCase().includes(q)) return false;
    return true;
  });
  const el=document.getElementById('peList');
  if(!filtered.length){
    el.innerHTML=`<div class="pe-empty">${sheetZones.length?'검색 결과 없음':'시트 데이터 없음 — GAS URL 확인 또는 영역 새로고침'}</div>`;
    return;
  }
  peOriginals={};
  filtered.forEach(p=>{ peOriginals[p.id]={zone:p.zone, loc:p.loc}; });

  const allZoneNames=[...new Set(sheetZones.map(z=>z.name))];
  const datalist=`<datalist id="pe-zone-dl">${allZoneNames.map(z=>`<option value="${escHtml(z)}">`).join('')}</datalist>`;

  // 각 존의 첫 제품 ID 기준으로 정렬
  const groupedZones=[...new Set(filtered.map(p=>p.zone))]
    .sort((a,b)=>{
      const fa=filtered.filter(p=>p.zone===a).map(p=>p.id).sort()[0]||'';
      const fb=filtered.filter(p=>p.zone===b).map(p=>p.id).sort()[0]||'';
      return fa.localeCompare(fb);
    });

  const viewCard=p=>`<div class="pe-card" id="pe-row-${escHtml(p.id)}" onclick="toggleCardEdit('${escHtml(p.id)}')">
    <div class="pe-card-id">${escHtml(p.id)}</div>
    <div class="pe-card-loc">${escHtml(p.loc)||'—'}</div>
  </div>`;
  const editCard=p=>`<div class="pe-card editing" id="pe-row-${escHtml(p.id)}">
    <div class="pe-card-id">${escHtml(p.id)}</div>
    <div class="pe-card-edit-form">
      <input id="pe-ez-${escHtml(p.id)}" value="${escHtml(p.zone)}" list="pe-zone-dl"
        placeholder="영역" oninput="markChanged(this,'${escHtml(p.id)}')"/>
      <input id="pe-el-${escHtml(p.id)}" value="${escHtml(p.loc)}" placeholder="설치 장소"
        oninput="markChanged(this,'${escHtml(p.id)}')"/>
    </div>
    <div class="pe-card-actions">
      <button class="pe-btn del" onclick="deleteProductFromSheet('${escHtml(p.id)}')">삭제</button>
    </div>
  </div>`;
  const cardFn=peEditMode?editCard:viewCard;

  let html=datalist;
  let compactBuf=[];
  const flushCompact=()=>{
    if(!compactBuf.length) return;
    html+=`<div class="pe-compact-row">${compactBuf.map(({zone,ps})=>`
      <div class="pe-compact-zone">
        <div class="pe-zone-header mini">${escHtml(zone)}</div>
        ${ps.map(cardFn).join('')}
      </div>`).join('')}</div>`;
    compactBuf=[];
  };

  groupedZones.forEach(zone=>{
    const ps=filtered.filter(p=>p.zone===zone);
    if(ps.length<=2){
      compactBuf.push({zone,ps});
    } else {
      flushCompact();
      html+=`<div class="pe-zone-group">
        <div class="pe-zone-header">${escHtml(zone)}<span class="pe-zone-count">${ps.length}</span></div>
        <div class="pe-grid">${ps.map(cardFn).join('')}</div>
      </div>`;
    }
  });
  flushCompact();
  el.innerHTML=html;
}

function toggleCardEdit(id){
  const card=document.getElementById('pe-row-'+id);
  const orig=peOriginals[id];
  if(!card||!orig) return;
  if(card.classList.contains('editing')){
    cancelCardEdit(id); return;
  }
  card.classList.add('editing');
  card.removeAttribute('onclick');
  card.innerHTML=`
    <div class="pe-card-id">${escHtml(id)}</div>
    <div class="pe-card-edit-form">
      <input id="pe-ez-${escHtml(id)}" value="${escHtml(orig.zone)}" list="pe-zone-dl" placeholder="영역"/>
      <input id="pe-el-${escHtml(id)}" value="${escHtml(orig.loc)}" placeholder="설치 장소"/>
    </div>
    <div class="pe-card-actions">
      <button class="pe-btn save" onclick="event.stopPropagation();saveCardEdit('${escHtml(id)}')">저장</button>
      <button class="pe-btn" onclick="event.stopPropagation();cancelCardEdit('${escHtml(id)}')">취소</button>
      <button class="pe-btn del" onclick="event.stopPropagation();deleteProductFromSheet('${escHtml(id)}')">삭제</button>
    </div>`;
  document.getElementById('pe-el-'+id)?.focus();
}

function cancelCardEdit(id){
  const orig=peOriginals[id];
  const card=document.getElementById('pe-row-'+id);
  if(!card||!orig) return;
  card.classList.remove('editing');
  card.innerHTML=`
    <div class="pe-card-id">${escHtml(id)}</div>
    <div class="pe-card-loc">${escHtml(orig.loc)||'—'}</div>`;
  card.setAttribute('onclick',`toggleCardEdit('${escHtml(id)}')`);
}

async function saveCardEdit(id){
  if(!GAS_URL){ alert('GAS_URL이 설정되지 않았습니다.'); return; }
  const zEl=document.getElementById('pe-ez-'+id);
  const lEl=document.getElementById('pe-el-'+id);
  const zone=zEl?.value.trim(), loc=lEl?.value.trim()||'';
  if(!zone){ alert('영역을 입력해주세요.'); return; }
  const card=document.getElementById('pe-row-'+id);
  const saveBtn=card?.querySelector('.pe-btn.save');
  if(saveBtn){ saveBtn.disabled=true; saveBtn.textContent='저장 중…'; }
  try{
    const res=await fetch(GAS_URL,{method:'POST',headers:{'Content-Type':'text/plain'},
      body:JSON.stringify({action:'updateProduct',id,zone,location:loc})});
    const json=await res.json();
    if(json.success){
      sheetZones.forEach(z=>{ z.ids=z.ids.filter(i=>i!==id); });
      sheetZones=sheetZones.filter(z=>z.ids.length>0);
      let zoneObj=sheetZones.find(z=>z.name===zone);
      if(!zoneObj){ zoneObj={name:zone,ids:[]}; sheetZones.push(zoneObj); }
      if(!zoneObj.ids.includes(id)) zoneObj.ids.push(id);
      if(loc) productLocations[id]=loc; else delete productLocations[id];
      updateSheetCache();
      refreshProductEditorDropdowns();
      addLog(`[${id}] 저장 완료`,'ok');
      renderProductEditor();
    } else {
      alert('저장 실패: '+(json.error||'오류'));
      if(saveBtn){ saveBtn.disabled=false; saveBtn.textContent='저장'; }
    }
  }catch(e){
    alert('오류: '+e.message);
    if(saveBtn){ saveBtn.disabled=false; saveBtn.textContent='저장'; }
  }
}

function markChanged(input, id){
  const orig=peOriginals[id];
  if(!orig) return;
  const zEl=document.getElementById('pe-ez-'+id);
  const lEl=document.getElementById('pe-el-'+id);
  if(zEl) zEl.classList.toggle('changed', zEl.value.trim()!==orig.zone);
  if(lEl) lEl.classList.toggle('changed', lEl.value.trim()!==orig.loc);
  const changedCount=Object.keys(peOriginals).filter(i=>{
    const z=document.getElementById('pe-ez-'+i), l=document.getElementById('pe-el-'+i);
    return (z&&z.value.trim()!==peOriginals[i].zone)||(l&&l.value.trim()!==peOriginals[i].loc);
  }).length;
  const statusEl=document.getElementById('peBulkStatus');
  if(statusEl) statusEl.textContent=changedCount>0?`${changedCount}개 변경됨 — 일괄 저장으로 반영`:'편집 모드 — 수정 후 일괄 저장';
}

function toggleEditMode(){
  peEditMode=!peEditMode;
  document.getElementById('peEditModeBtn').innerHTML=peEditMode?'<span class="material-icons-round ico">visibility</span>보기 모드':'<span class="material-icons-round ico">edit</span>전체 편집';
  document.getElementById('peBulkBar').style.display=peEditMode?'flex':'none';
  renderProductEditor();
}

function exitEditMode(){
  peEditMode=false;
  document.getElementById('peEditModeBtn').innerHTML='<span class="material-icons-round ico">edit</span>전체 편집';
  document.getElementById('peBulkBar').style.display='none';
  renderProductEditor();
}

async function bulkSaveProducts(){
  if(!GAS_URL){ alert('GAS_URL이 설정되지 않았습니다.'); return; }
  const changed=[];
  Object.keys(peOriginals).forEach(id=>{
    const zEl=document.getElementById('pe-ez-'+id);
    const lEl=document.getElementById('pe-el-'+id);
    if(!zEl) return;
    const zone=zEl.value.trim(), loc=lEl?lEl.value.trim():'';
    if(zone!==peOriginals[id].zone || loc!==peOriginals[id].loc){
      if(!zone){ return; }
      changed.push({id, zone, location:loc});
    }
  });
  if(!changed.length){ alert('변경된 항목이 없습니다.'); return; }
  const saveBtn=document.querySelector('#peBulkBar .pe-btn.save');
  if(saveBtn){ saveBtn.disabled=true; saveBtn.textContent='저장 중…'; }
  try{
    const results=await Promise.all(changed.map(item=>
      fetch(GAS_URL,{method:'POST',headers:{'Content-Type':'text/plain'},
        body:JSON.stringify({action:'updateProduct',...item})})
        .then(r=>r.json())
    ));
    const ok=results.filter(r=>r.success).length;
    const fail=results.filter(r=>!r.success);
    changed.forEach(({id,zone,location})=>{
      const res=results[changed.findIndex(c=>c.id===id)];
      if(!res||!res.success) return;
      sheetZones.forEach(z=>{ z.ids=z.ids.filter(i=>i!==id); });
      sheetZones=sheetZones.filter(z=>z.ids.length>0);
      let zoneObj=sheetZones.find(z=>z.name===zone);
      if(!zoneObj){ zoneObj={name:zone,ids:[]}; sheetZones.push(zoneObj); }
      if(!zoneObj.ids.includes(id)) zoneObj.ids.push(id);
      if(location) productLocations[id]=location; else delete productLocations[id];
    });
    updateSheetCache();
    refreshProductEditorDropdowns();
    addLog(`일괄 저장 완료: ${ok}개 성공${fail.length?` / ${fail.length}개 실패`:''}`, 'ok');
    alert(`일괄 저장 완료\n\n${ok}개 저장됨${fail.length?`\n실패 ${fail.length}개: ${fail.map((_,i)=>changed[i]?.id).join(', ')}`:``}`);
    exitEditMode();
  }catch(e){
    alert('저장 중 오류: '+e.message);
  }
  if(saveBtn){ saveBtn.disabled=false; saveBtn.innerHTML='<span class="material-icons-round ico">save</span>일괄 저장'; }
}

async function deleteProductFromSheet(id){
  if(!confirm(`[${id}] 제품을 시트에서 삭제하시겠습니까?`)) return;
  if(!GAS_URL){ alert('GAS_URL이 설정되지 않았습니다.'); return; }
  const row=document.getElementById('pe-row-'+id);
  if(row) row.style.opacity='0.4';
  try{
    const res=await fetch(GAS_URL,{method:'POST',headers:{'Content-Type':'text/plain'},
      body:JSON.stringify({action:'deleteProduct',id})});
    const json=await res.json();
    if(json.success){
      sheetZones.forEach(z=>{ z.ids=z.ids.filter(i=>i!==id); });
      sheetZones=sheetZones.filter(z=>z.ids.length>0);
      delete productLocations[id];
      updateSheetCache();
      refreshProductEditorDropdowns();
      renderProductEditor();
      addLog(`[${id}] 삭제 완료`,'ok');
      alert(`[${id}] 삭제 완료`);
    } else {
      alert('삭제 실패: '+(json.error||'오류'));
      if(row) row.style.opacity='1';
    }
  }catch(e){ alert('오류: '+e.message); if(row) row.style.opacity='1'; }
}

async function addProductToSheet(){
  const id=document.getElementById('peNewId').value.trim().toUpperCase();
  const custom=document.getElementById('peNewZoneCustomToggle').checked;
  const zone=custom
    ? document.getElementById('peNewZoneCustom').value.trim()
    : document.getElementById('peNewZone').value.trim();
  const loc=document.getElementById('peNewLoc').value.trim();
  if(!id||id.length<2){ alert('제품 ID를 입력해주세요.'); return; }
  if(!zone){ alert('영역을 선택하거나 입력해주세요.'); return; }
  if(!GAS_URL){ alert('GAS_URL이 설정되지 않았습니다.'); return; }
  const btn=document.querySelector('.pe-add-form .btn-add');
  btn.disabled=true; btn.textContent='추가 중…';
  try{
    const res=await fetch(GAS_URL,{method:'POST',headers:{'Content-Type':'text/plain'},
      body:JSON.stringify({action:'addProduct',id,zone,location:loc})});
    const json=await res.json();
    if(json.success){
      let zoneObj=sheetZones.find(z=>z.name===zone);
      if(!zoneObj){ zoneObj={name:zone,ids:[]}; sheetZones.push(zoneObj); }
      if(!zoneObj.ids.includes(id)) zoneObj.ids.push(id);
      if(loc) productLocations[id]=loc;
      updateSheetCache();
      document.getElementById('peNewId').value='';
      document.getElementById('peNewLoc').value='';
      refreshProductEditorDropdowns();
      renderProductEditor();
      addLog(`[${id}] 추가 완료 (${zone})`,'ok');
      alert(`[${id}] 추가 완료\n영역: ${zone}${loc?'\n설치 장소: '+loc:''}`);
    } else {
      alert('추가 실패: '+(json.error||'오류'));
    }
  }catch(e){ alert('오류: '+e.message); }
  btn.disabled=false; btn.textContent='+ 추가';
}

function updateSheetCache(){
  lsSet(LS_SHEET_CACHE,{ts:Date.now(),zones:sheetZones,locations:productLocations,monthSheets:historyMonths});
}

function updateGridCard(r){
  const cfg=STATUS[r.status]||STATUS.LOAD;
  const loc=productLocations[r.id]||'';
  const tip=r.errMsg?escHtml(r.errMsg):r.item
    ?`PM10: ${r.item.pm_10}㎍/㎥<br>PM2.5: ${r.item.pm_2_5}㎍/㎥<br>CO₂: ${r.item.co2}ppm<br><span class="tooltip-time">수집: ${escHtml(r.item.format_created_time)}</span>`
    :'<span style="display:block;text-align:center">데이터 없음</span>';
  const el=document.querySelector(`#grid .card[data-id="${CSS.escape(r.id)}"]`);
  if(!el) return;
  const exReason=excludeReasons[r.id]||'';
  el.className=`card ${cfg.cls} card-updated`;
  el.innerHTML=`
    <div class="card-status" style="color:var(${cfg.textVar})">${cfg.icon?`<span class="material-icons-round card-icon">${cfg.icon}</span>`:''}${cfg.label}</div>
    <div class="card-id">${escHtml(r.id)}</div>
    ${exReason?`<div class="exclude-reason-badge">${escHtml(exReason)}</div>`:''}
    ${loc?`<div class="card-location">${escHtml(loc)}</div>`:''}
    ${r.item?`<div class="card-meta">${r.item.pm_10}㎍/㎥ | ${r.item.pm_2_5}㎍/㎥ | ${r.item.co2}ppm</div>`:''}
    ${r.status==='ERR'&&r.errMsg?`<div class="card-err-text">${escHtml(r.errMsg.slice(0,50))}</div>`:''}
    <div class="tooltip">${tip}</div>`;
  requestAnimationFrame(()=>requestAnimationFrame(()=>el.classList.remove('card-updated')));
}

function getZoneAndLoc(id){
  const zone=(sheetZones.find(z=>z.ids.includes(id))||{}).name||'';
  const loc=productLocations[id]||'';
  return [zone,loc].filter(Boolean).join(' · ')||'—';
}
function filterByListSel(sel){
  if(sel==='ALL') return results;
  if(sel==='EM_PM') return results.filter(r=>r.status==='EM'||r.status==='PM');
  return results.filter(r=>r.status===sel);
}
function renderList(){
  const sel=document.getElementById('listFilterSel').value;
  const filtered=filterByListSel(sel);
  document.getElementById('listBody').innerHTML=filtered.map(r=>{
    const cfg=STATUS[r.status]||STATUS.LOAD;
    const loc=getZoneAndLoc(r.id);
    const time=r.item?r.item.format_created_time:(r.errMsg?r.errMsg.slice(0,60):'—');
    return`<div class="list-row" onclick="openCardDetailModal('${escHtml(r.id)}')">
      <div class="list-id-cell">${escHtml(r.id)}</div>
      <div class="list-loc-cell">${escHtml(loc)}</div>
      <div class="list-status-cell" style="color:var(${cfg.textVar})">${cfg.icon?`<span class="material-icons-round" style="font-size:13px;vertical-align:-2px;margin-right:2px">${cfg.icon}</span>`:''}${cfg.label}</div>
      <div class="list-time-cell">${escHtml(time||'—')}</div>
    </div>`;
  }).join('');
}
function copyListToClipboard(){
  const sel=document.getElementById('listFilterSel').value;
  const filtered=filterByListSel(sel);
  navigator.clipboard.writeText(filtered.map(r=>`${r.id}\t${getZoneAndLoc(r.id)}\t${r.status}`).join('\n')).then(()=>{
    const msg=document.getElementById('copyMsg');
    msg.style.display='inline';
    setTimeout(()=>{msg.style.display='none';},2000);
  });
}
function switchView(v){
  currentView=v;
  document.getElementById('grid').style.display       =v==='grid'?'grid':'none';
  document.getElementById('listView').style.display   =v==='list'?'block':'none';
  document.getElementById('listToolbar').style.display=v==='list'?'flex':'none';
  renderSummary(); if(v==='list')renderList();
}
function setFilter(f){currentFilter=f;renderSummary();renderGrid();}

/* ===== 단일 검색 결과 렌더 ===== */
function fmtTime(str){
  if(!str) return '—';
  const m=str.match(/\d{4}[.\-](\d{2})[.\-](\d{2})\s+(\d{2}:\d{2}|\d{2}시)/);
  return m?`${m[1]}.${m[2]} ${m[3]}`:str.slice(5,16);
}

/* 가동시간(HH:MM:SS) <-> 초 변환 — 단일점검/카드상세 가동 차트에서 공용으로 사용 */
function hmsToSec(str){
  if(str==null) return null;
  const p=String(str).trim().split(':');
  if(p.length!==3) return null;
  const [h,m,s]=p.map(Number);
  return (isNaN(h)||isNaN(m)||isNaN(s))?null:h*3600+m*60+s;
}
function secToHms(s){
  if(s==null||isNaN(s)) return '—';
  const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sec=s%60;
  const parts=[];
  if(h>0) parts.push(`${h}시간`);
  if(m>0) parts.push(`${m}분`);
  if(sec>0||parts.length===0) parts.push(`${sec}초`);
  return parts.join(' ');
}
/* 차트 좌/우 Y축 단위 라벨 — 차트 상단 모서리에 수평 표시 */
function yLabelPlugin(lText,lColor,rText,rColor){
  return {
    id:'yLabels',
    afterDraw(chart){
      const{ctx,chartArea:{top,left,right}}=chart;
      ctx.save();
      ctx.font='bold 12px system-ui,sans-serif';
      ctx.textBaseline='bottom';
      ctx.fillStyle=lColor; ctx.textAlign='left';
      ctx.fillText(lText,left+6,top-6);
      ctx.fillStyle=rColor; ctx.textAlign='right';
      ctx.fillText(rText,right-6,top-6);
      ctx.restore();
    }
  };
}

/* ===== 먼지 포집 데이터 렌더 ===== */
// 스파이크 감지 배수: 직전값 대비 이 배수 이상 증가 후 다음값이 내려오면 오류로 판정
const DUST_SPIKE_RATIO = 5;

function isSpike(prev, cur, next){
  if(prev==null||next==null) return false;
  // 직전값 대비 SPIKE_RATIO배 이상 튀어오르고, 다음값이 cur보다 낮게 내려오면 스파이크
  return (cur - prev) > Math.max(prev * (DUST_SPIKE_RATIO - 1), 10000) && next < cur;
}

const DUST_BASELINE_THRESHOLD = 150000; // 최초 입력값이 이 값 초과면 기준점(baseline)으로 정규화

function calcDust(items){
  const sorted=[...items]
    .filter(it=>it.report_data?.dustTotal!==undefined&&it.report_data?.dustTotal!==null)
    .sort((a,b)=>{
      const ta=new Date((a.report_data.readTime||a.format_created_time||'').replace(' ','T'));
      const tb=new Date((b.report_data.readTime||b.format_created_time||'').replace(' ','T'));
      return ta-tb;
    });

  if(!sorted.length) return{total:0, days:[], scanCount:0};

  // grams 변환
  const raw=sorted.map(it=>{
    const rd=it.report_data;
    const time=rd.readTime||it.format_created_time||'';
    const grams=(Number(rd.dustTotal)||0)*1000+(Number(rd.dustTotal1)||0);
    return{time, grams, date:time.slice(0,10)};
  });

  // 스파이크 레코드 제외
  const noSpike=raw.filter((p,i)=>{
    const prev=i>0?raw[i-1].grams:null;
    const next=i<raw.length-1?raw[i+1].grams:null;
    return !isSpike(prev, p.grams, next);
  });

  if(!noSpike.length) return{total:0, days:[], scanCount:sorted.length};

  // 최초 입력값이 15만g 초과면 그 값을 기준(0점)으로 정규화
  // 15만 이하 레코드(리셋 후 소량값 등)는 그대로 유지
  const baseline = noSpike[0].grams > DUST_BASELINE_THRESHOLD ? noSpike[0].grams : 0;
  const pts = baseline === 0 ? noSpike : noSpike.map(p=>({
    ...p,
    grams: p.grams > DUST_BASELINE_THRESHOLD ? p.grams - baseline : p.grams
  }));

  // 증가분만 합산 (리셋 시 음수 diff는 무시)
  let total=0;
  for(let i=1;i<pts.length;i++){
    const diff=pts[i].grams-pts[i-1].grams;
    if(diff>0) total+=diff;
  }

  // 일별 집계
  const dayMap=new Map();
  pts.forEach(p=>{
    if(!dayMap.has(p.date)) dayMap.set(p.date,[]);
    dayMap.get(p.date).push(p);
  });
  const dayEntries=[...dayMap.entries()].sort((a,b)=>a[0]<b[0]?-1:1);
  const days=dayEntries.map(([date,ps],idx)=>{
    let inc=0;
    for(let i=1;i<ps.length;i++){
      const diff=ps[i].grams-ps[i-1].grams;
      if(diff>0) inc+=diff;
    }
    let displayFirst=ps[0].grams;
    if(idx>0){
      const prevPs=dayEntries[idx-1][1];
      const prevLast=prevPs[prevPs.length-1].grams;
      const crossDiff=ps[0].grams-prevLast;
      if(crossDiff>0){ inc+=crossDiff; displayFirst=prevLast; }
    }
    return{date,count:ps.length,first:displayFirst,last:ps[ps.length-1].grams,inc};
  });

  return{total,days,scanCount:sorted.length};
}

function renderDustChart(days,isDark,canvasId){
  if(dustModalChart){dustModalChart.destroy();dustModalChart=null;}
  const canvas=document.getElementById(canvasId||'dustModalCanvas');
  if(!canvas||!days.length) return;
  const grid=isDark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.07)';
  const tick=isDark?'#8a8380':'#6b6560';
  dustModalChart=new Chart(canvas,{
    type:'bar',
    data:{
      labels:days.map(d=>d.date.slice(5)),
      datasets:[{
        label:'회별 포집량 (g)',
        data:days.map(d=>d.inc),
        backgroundColor:isDark?'rgba(95,143,179,0.65)':'rgba(95,143,179,0.55)',
        borderColor:'#5f8fb3',borderWidth:1,borderRadius:4,
      }]
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      animation:{
        duration:600,
        easing:'easeOutCubic',
        delay:ctx=>ctx.type==='data'&&ctx.mode==='default'?ctx.dataIndex*40:0
      },
      plugins:{
        legend:{display:false},
        tooltip:{
          backgroundColor:isDark?'#1d1a18':'#ffffff',
          titleColor:isDark?'#eeeeee':'#171514',bodyColor:isDark?'#b8b3b0':'#433f3d',
          borderColor:isDark?'#3d3a39':'#ddd9d5',borderWidth:1,padding:10,
          callbacks:{label:ctx=>`${ctx.parsed.y.toLocaleString()}g`}
        }
      },
      scales:{
        x:{ticks:{color:tick,font:{size:10}},grid:{color:grid}},
        y:{ticks:{color:tick,font:{size:10},callback:v=>Number.isInteger(v)?v:null},
           grid:{color:grid},beginAtZero:true,min:0}
      }
    }
  });
}

/* ===== 먼지 포집 범위 검색 ===== */
/* ===== 먼지 포집 영역 선택기 ===== */
let dustZoneGridOpen=false;

function toggleDustZoneGrid(){
  dustZoneGridOpen=!dustZoneGridOpen;
  _applyZoneGridUI(dustZoneGridOpen,'dustZoneGridWrap','dustZoneArrow','dustZoneToggleBtn');
}

function renderDustZoneGrid(){
  _renderZoneGrid('dustZonePickerGrid','dustZoneNoResult','dustZoneSearchInput',selectedDustZones,'toggleDustZone',dustZoneGridOpen,toggleDustZoneGrid,updateDustZoneInfo,dustZoneLangFilter);
}
function setDustZoneLangFilter(lang){
  dustZoneLangFilter=lang;
  document.querySelectorAll('#dustZoneLangFilter .zone-lang-btn').forEach(b=>b.classList.toggle('active',b.dataset.lang===lang));
  renderDustZoneGrid();
}
function toggleDustZone(i){ _toggleZoneItem(selectedDustZones,i,renderDustZoneGrid); }
function filterDustZones(){ renderDustZoneGrid(); }
function selectAllDustZones(){ sheetZones.forEach((_,i)=>selectedDustZones.add(i)); renderDustZoneGrid(); }
function clearAllDustZones(){ selectedDustZones.clear(); renderDustZoneGrid(); }
function updateDustZoneInfo(){
  _updateZoneInfo(selectedDustZones,document.getElementById('dustZoneSelectInfo'),(c,t)=>`${c}개 영역 · ${t}개 제품`);
}

/* ===== 먼지 포집 localStorage 캐시 ===== */
function dustCacheKey(startYm,endYm){
  const today=todayStr(), curYm=today.slice(0,7);
  const range=`${startYm}_${endYm}`;
  return endYm>=curYm?`dustCache_${range}_${today}`:`dustCache_${range}`;
}
function getDustCache(id,startYm,endYm){
  try{
    const raw=localStorage.getItem(dustCacheKey(startYm,endYm));
    if(!raw) return null;
    return JSON.parse(raw)[id]||null;
  }catch{return null;}
}
function setDustCache(id,result,startYm,endYm){
  try{
    const key=dustCacheKey(startYm,endYm);
    const cache=JSON.parse(localStorage.getItem(key)||'{}');
    cache[id]=result;
    localStorage.setItem(key,JSON.stringify(cache));
  }catch{}
}
function cleanOldDustCache(){
  const today=todayStr();
  for(let i=localStorage.length-1;i>=0;i--){
    const k=localStorage.key(i);
    if(!k||!k.startsWith('dustCache_')) continue;
    // 오늘 날짜 포함 캐시 중 날짜 다른 것 삭제
    const dateMatch=k.match(/_(\d{4}-\d{2}-\d{2})$/);
    if(dateMatch&&dateMatch[1]!==today) localStorage.removeItem(k);
  }
}
function initDustMonthPicker(){
  const startSel=document.getElementById('dustStartMonth');
  const endSel=document.getElementById('dustEndMonth');
  if(!startSel||!endSel) return;
  const curYm=todayStr().slice(0,7);
  const minDate=new Date(2025,11,1); // 2025-12
  const opts=[];
  const d=new Date(new Date().getFullYear(),new Date().getMonth(),1);
  while(d>=minDate){
    const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), ym=`${y}-${m}`;
    opts.push(`<option value="${ym}">${y}년 ${parseInt(m)}월${ym===curYm?' (이번 달)':''}</option>`);
    d.setMonth(d.getMonth()-1);
  }
  const html=opts.join('');
  startSel.innerHTML=html;
  endSel.innerHTML=html;
  startSel.value='2026-04'; // 수집 시작 기본값
  endSel.value=curYm;
}
function onDustStartMonthChange(){
  const startSel=document.getElementById('dustStartMonth');
  const endSel=document.getElementById('dustEndMonth');
  if(startSel.value>endSel.value) endSel.value=startSel.value;
}

async function startDustSearch(){
  if(isGlobalLocked) return;
  if(isMobile() && !adminAuthenticated){
    document.getElementById('errorMsg').textContent='⚠ 모바일에서는 관리자 인증이 필요합니다.';
    return;
  }
  if(dustZoneGridOpen) toggleDustZoneGrid();
  const errEl=document.getElementById('errorMsg');
  errEl.textContent='';
  const token=document.getElementById('tokenInput').value.trim();
  const added=new Set();
  const ids=[];
  [...selectedDustZones].forEach(i=>{
    if(sheetZones[i]) sheetZones[i].ids.forEach(id=>{ if(!added.has(id)){added.add(id);ids.push(id);} });
  });
  dustExtraIds.forEach(id=>{ if(!added.has(id)){added.add(id);ids.push(id);} });
  if(!ids.length){errEl.textContent='⚠ 조회할 영역을 선택해주세요.';return;}

  const startYm=document.getElementById('dustStartMonth')?.value||'2026-04';
  const endYm=document.getElementById('dustEndMonth')?.value||todayStr().slice(0,7);
  if(startYm>endYm){errEl.textContent='⚠ 시작 월이 종료 월보다 클 수 없습니다.';return;}
  const curYm=todayStr().slice(0,7);
  const [eY,eM]=endYm.split('-').map(Number);
  const lastDay=new Date(eY,eM,0).getDate();
  const dateRange={started_at:`${startYm}-01`,finished_at:endYm===curYm?todayStr():`${endYm}-${String(lastDay).padStart(2,'0')}`};
  const resultSection=document.getElementById('dustResultSection');
  const progressEl=document.getElementById('dustProgressRow');
  const gridEl=document.getElementById('dustCardsGrid');
  dustResultMap.clear();
  const monthBar=document.getElementById('dustMonthCopyBar');
  if(monthBar) monthBar.style.display='none';
  const srchEl=document.getElementById('dustResultSearch');
  if(srchEl) srchEl.value='';
  const cntEl=document.getElementById('dustResultCount');
  if(cntEl) cntEl.textContent='';
  resultSection.style.display='block';
  gridEl.innerHTML='';

  // 영역별 그룹핑
  const idSet=new Set(ids);
  const zoneGroups=new Map();
  sheetZones.forEach(z=>{
    const zIds=z.ids.filter(zid=>idSet.has(zid));
    if(zIds.length) zoneGroups.set(z.name,zIds);
  });
  const zonedIds=new Set([...zoneGroups.values()].flat());
  const unzoned=ids.filter(id=>!zonedIds.has(id));
  if(unzoned.length) zoneGroups.set('미분류',unzoned);

  const cardHtmlLoading=id=>`
    <div class="dust-card loading" id="dust-card-${escHtml(id)}">
      <div class="dust-card-id">${escHtml(id)}</div>
      <div class="dust-card-meta">로딩 중…</div>
    </div>`;

  zoneGroups.forEach((zIds,zoneName)=>{
    gridEl.insertAdjacentHTML('beforeend',`
      <div class="dust-zone-group">
        <div class="dust-zone-header">${escHtml(zoneName)}<span class="dust-zone-count">${zIds.length}개</span></div>
        <div class="dust-zone-cards">${zIds.map(cardHtmlLoading).join('')}</div>
      </div>`);
  });

  setGlobalLock(true);
  let done=0;
  progressEl.textContent=`조회 중 0 / ${ids.length}`;
  progressEl.style.display='block';

  await Promise.all(ids.map(async id=>{
    const card=document.getElementById('dust-card-'+id);
    const loc=productLocations[id]?`<div class="dust-card-loc">${escHtml(productLocations[id])}</div>`:'';
    try{
      let dustResult=getDustCache(id,startYm,endYm);
      if(!dustResult){
        const rawItems=await fetchAllReports(id,dateRange,token,()=>{});
        const items=rawItems.filter(it=>{
          const t=(it.report_data?.readTime||it.format_created_time||'').slice(0,10);
          return t>=dateRange.started_at;
        });
        dustResult=calcDust(items);
        setDustCache(id,dustResult,startYm,endYm);
      }
      const{total,days,scanCount}=dustResult;
      const activeDays=days.filter(d=>d.inc>0);
      if(!card) return;
      if(!activeDays.length){
        card.className='dust-card empty';
        card.innerHTML=`<div class="dust-card-id">${escHtml(id)}</div>${loc}
          <div class="dust-card-meta" style="color:var(--text4);margin-top:4px">포집 데이터 없음</div>`;
      } else {
        dustResultMap.set(id,dustResult);
        const lastDate=activeDays[activeDays.length-1].date;
        card.className='dust-card';
        card.innerHTML=`<div class="dust-card-id">${escHtml(id)}</div>${loc}
          <div class="dust-card-total">${total.toLocaleString()}g</div>
          <div class="dust-card-meta">${activeDays.length}회 포집 · 최근 ${lastDate}</div>`;
        card.addEventListener('click',()=>openDustModal(id));
      }
    }catch(e){
      if(card){
        card.className='dust-card empty';
        card.innerHTML=`<div class="dust-card-id">${escHtml(id)}</div>${loc}
          <div class="dust-card-meta" style="color:var(--pm-text);margin-top:4px">조회 오류</div>`;
      }
    }
    progressEl.textContent=`조회 중 ${++done} / ${ids.length}`;
  }));

  progressEl.style.display='none';
  setGlobalLock(false);
  updateDustMonthBar();
  setTimeout(()=>{
    const el=document.getElementById('dustResultSection');
    if(el&&el.offsetParent!==null) el.scrollIntoView({behavior:'smooth',block:'start'});
  },150);
}


function updateDustMonthBar(){
  const months=new Set();
  dustResultMap.forEach(({days})=>{
    days.filter(d=>d.inc>0).forEach(d=>months.add(d.date.slice(0,7)));
  });
  const bar=document.getElementById('dustMonthCopyBar');
  const sel=document.getElementById('dustMonthSelect');
  if(!months.size){bar.style.display='none';return;}
  const sorted=[...months].sort().reverse();
  sel.innerHTML=sorted.map(ym=>{
    const[y,m]=ym.split('-');
    return`<option value="${ym}">${y}년 ${parseInt(m)}월</option>`;
  }).join('');
  bar.style.display='flex';
}

function copyDustByMonth(){
  const sel=document.getElementById('dustMonthSelect');
  const ym=sel.value;
  if(!ym||!dustResultMap.size) return;
  const[y,m]=ym.split('-');
  const lines=[`=== ${y}년 ${parseInt(m)}월 포집 데이터 ===`];
  dustResultMap.forEach(({days},id)=>{
    const monthDays=days.filter(d=>d.inc>0&&d.date.startsWith(ym));
    if(!monthDays.length) return;
    const loc=productLocations[id]||'';
    lines.push('');
    lines.push(loc?`${id} (${loc})`:id);
    monthDays.forEach(d=>lines.push(`${d.date} : ${d.inc}g`));
  });
  const btn=document.getElementById('dustMonthCopyBtn');
  navigator.clipboard.writeText(lines.join('\n'))
    .then(()=>{btn.innerHTML='<span class="material-icons-round ico">check</span>복사됨';setTimeout(()=>{btn.innerHTML='<span class="material-icons-round ico">content_copy</span>월별 복사';},2000);})
    .catch(()=>{alert('클립보드 복사에 실패했습니다.');});
}

function openDustModal(id){
  const dustResult=dustResultMap.get(id);
  if(!dustResult) return;
  const{total,days,scanCount}=dustResult;
  const activeDays=days.filter(d=>d.inc>0);
  dustDays=activeDays;

  document.getElementById('dustModalTitle').textContent=`${id} — 먼지 포집 상세`;
  document.getElementById('dustModalSummary').innerHTML=`
    <div class="dust-stat"><span class="dust-stat-label">총 포집량</span>
      <span class="dust-stat-value">${total.toLocaleString()}g</span></div>
    <div class="dust-stat"><span class="dust-stat-label">포집 발생 수</span>
      <span class="dust-stat-value">${activeDays.length}회</span></div>
    <div class="dust-stat"><span class="dust-stat-label">리포트 데이터 수</span>
      <span class="dust-stat-value">${scanCount}건</span></div>`;

  const headEl=document.getElementById('dustModalHead');
  const bodyEl=document.getElementById('dustModalBody');
  const chartWrap=document.getElementById('dustModalChartWrap');

  if(activeDays.length){
    headEl.innerHTML='<th>날짜</th><th>시작 (g)</th><th>마지막 (g)</th><th>회별 포집 (g)</th>';
    bodyEl.innerHTML=activeDays.map(d=>`<tr>
      <td>${escHtml(d.date)}</td>
      <td>${d.first.toLocaleString()}</td><td>${d.last.toLocaleString()}</td>
      <td style="font-weight:500;color:var(--ok-text)">+${d.inc.toLocaleString()}</td>
    </tr>`).join('');
    chartWrap.style.display='block';
  } else {
    headEl.innerHTML='';
    bodyEl.innerHTML='<tr><td style="padding:16px;color:var(--text3)">포집량 변화가 없습니다</td></tr>';
    chartWrap.style.display='none';
  }

  dustModalOpen=true;
  document.getElementById('dustModal').style.display='flex';
  document.body.style.overflow='hidden';

  if(activeDays.length){
    requestAnimationFrame(()=>setTimeout(()=>{
      const isDark=document.documentElement.getAttribute('data-theme')==='dark';
      renderDustChart(activeDays,isDark,'dustModalCanvas');
    },50));
  }
}

function filterDustResults(q){
  const lower=q.trim().toLowerCase();
  const grid=document.getElementById('dustCardsGrid');
  if(!grid) return;
  let visible=0;
  grid.querySelectorAll('.dust-zone-group').forEach(group=>{
    const zoneHeader=group.querySelector('.dust-zone-header');
    const zoneName=(zoneHeader?.textContent||'').toLowerCase();
    const zoneNameMatch=!lower||zoneName.includes(lower);
    let groupVisible=0;
    group.querySelectorAll('.dust-card').forEach(card=>{
      const id=(card.querySelector('.dust-card-id')?.textContent||'').toLowerCase();
      const loc=(card.querySelector('.dust-card-loc')?.textContent||'').toLowerCase();
      const match=!lower||zoneNameMatch||id.includes(lower)||loc.includes(lower);
      card.classList.toggle('result-hidden',!match);
      if(match) groupVisible++;
    });
    const groupMatch=!lower||groupVisible>0;
    group.classList.toggle('result-hidden',!groupMatch);
    visible+=groupVisible;
  });
  const countEl=document.getElementById('dustResultCount');
  if(countEl) countEl.textContent=lower?`${visible}개 표시`:'';
}

function closeDustModal(){
  dustModalOpen=false;
  const modal=document.getElementById('dustModal');
  if(modal) modal.style.display='none';
  document.body.style.overflow='';
  if(dustModalChart){dustModalChart.destroy();dustModalChart=null;}
}

function dustModalOverlayClick(e){
  if(e.target===document.getElementById('dustModal')) closeDustModal();
}

/* ===== 카드 상세 모달 (범위/영역 점검 결과 클릭) ===== */
async function openCardDetailModal(id){
  const token=document.getElementById('tokenInput').value.trim();
  if(!token||!lastDateRange) return;
  const r=results.find(x=>x.id===id);
  const cfg=r?(STATUS[r.status]||STATUS.LOAD):null;
  const loc=getZoneAndLoc(id);
  const period=`${lastDateRange.started_at} ~ ${lastDateRange.finished_at}`;

  document.getElementById('cardDetailTitle').textContent=id;
  document.getElementById('cardDetailSubtitle').textContent=loc!=='—'?`${loc}  ·  ${period}`:period;
  const tabsEl=document.getElementById('cardDetailIdTabs');
  if(tabsEl&&results.length>1){
    tabsEl.innerHTML=results.map(rx=>{
      const c=STATUS[rx.status]||STATUS.LOAD;
      return`<button class="card-detail-id-tab${rx.id===id?' active':''}" style="color:var(${c.textVar});border-color:var(${c.textVar})" onclick="openCardDetailModal('${escHtml(rx.id)}')">${escHtml(rx.id)}</button>`;
    }).join('');
    tabsEl.style.display='flex';
    const activeTab=tabsEl.querySelector('.card-detail-id-tab.active');
    if(activeTab) activeTab.scrollIntoView({block:'nearest',inline:'center'});
  } else if(tabsEl){ tabsEl.style.display='none'; }
  document.getElementById('cardDetailSummary').innerHTML=cfg?`
    <div class="dust-stat">
      <span class="dust-stat-label">최근 상태</span>
      <span class="dust-stat-value" style="font-size:18px;color:var(${cfg.textVar})">${cfg.icon?`<span class="material-icons-round" style="font-size:18px;vertical-align:-3px;margin-right:2px">${cfg.icon}</span>`:''}${cfg.label}</span>
    </div>
    ${r.item?`<div class="dust-stat">
      <span class="dust-stat-label">PM10</span>
      <span class="dust-stat-value">${r.item.pm_10}<span class="dust-stat-sub">㎍/㎥</span></span>
    </div>
    <div class="dust-stat">
      <span class="dust-stat-label">PM2.5</span>
      <span class="dust-stat-value">${r.item.pm_2_5}<span class="dust-stat-sub">㎍/㎥</span></span>
    </div>
    <div class="dust-stat">
      <span class="dust-stat-label">CO₂</span>
      <span class="dust-stat-value">${r.item.co2}<span class="dust-stat-sub">ppm</span></span>
    </div>
    <div style="width:100%;font-size:11px;color:var(--text3);font-weight:500;text-align:right;margin-top:4px">마지막 수집: ${escHtml(r.item.format_created_time)}</div>`:''}
  `:'';

  cardDetailModalOpen=true;
  document.getElementById('cardDetailModal').style.display='flex';
  document.body.style.overflow='hidden';

  if(cardDetailCache.has(id)){
    _renderCardDetailContent(cardDetailCache.get(id));
    return;
  }

  const loadEl=document.getElementById('cardDetailLoading');
  const tableWrap=document.getElementById('cardDetailTableWrap');
  loadEl.textContent='데이터 불러오는 중…';
  loadEl.style.display='block';
  tableWrap.style.display='none';

  try{
    const items=await fetchAllReports(id,lastDateRange,token);
    const sorted=[...items].sort((a,b)=>new Date(b.format_created_time)-new Date(a.format_created_time));
    cardDetailCache.set(id,sorted);
    if(!cardDetailModalOpen) return;
    _renderCardDetailContent(sorted);
  }catch(e){
    loadEl.textContent='⚠ 오류: '+e.message;
  }
}
// 분단위 원본 수집 데이터를 정시(시간대) 단위로 묶어 PM10/PM2.5/CO2 평균을 냄
// — 예: 09:09~09:59 사이 6건이 있으면 "09시" 한 행으로 합쳐 평균값을 보여줌
// rawItems엔 그 시간대에 실제 수집된 원본 항목들을 시간순으로 담아둠 (행 클릭 시 상세 표시용)
function aggregateHourlyReadings(items){
  const buckets=new Map(); // 시간대(getTime) -> {date, count, pm10Sum, pm25Sum, co2Sum, rawItems}
  items.forEach(item=>{
    const d=new Date(item.format_created_time);
    if(isNaN(d.getTime())) return;
    const hourDate=new Date(d.getFullYear(),d.getMonth(),d.getDate(),d.getHours());
    const key=hourDate.getTime();
    if(!buckets.has(key)) buckets.set(key,{date:hourDate,count:0,pm10Sum:0,pm25Sum:0,co2Sum:0,rawItems:[]});
    const b=buckets.get(key);
    b.count++;
    b.pm10Sum+=Number(item.pm_10)||0;
    b.pm25Sum+=Number(item.pm_2_5)||0;
    b.co2Sum +=Number(item.co2)||0;
    b.rawItems.push(item);
  });
  const p2=n=>String(n).padStart(2,'0');
  const round1=n=>Math.round(n*10)/10; // 소수점 한 자리까지 반올림
  return [...buckets.values()]
    .sort((a,b)=>b.date-a.date) // 최신 시간대 먼저 — 기존 정렬 방향과 동일
    .map(b=>({
      format_created_time:`${b.date.getFullYear()}.${p2(b.date.getMonth()+1)}.${p2(b.date.getDate())} ${p2(b.date.getHours())}시`,
      pm_10:round1(b.pm10Sum/b.count),
      pm_2_5:round1(b.pm25Sum/b.count),
      co2:round1(b.co2Sum/b.count),
      sampleCount:b.count,
      rawItems:[...b.rawItems].sort((x,y)=>new Date(y.format_created_time)-new Date(x.format_created_time)) // 최신 먼저 — 바깥 표와 정렬 방향 통일
    }));
}

let cardDetailHourlyData=[]; // 현재 열린 카드 상세 모달의 시간대별 집계 결과 (행 클릭 시 원본 breakdown 조회용)

function _renderCardDetailContent(sorted){
  const loadEl=document.getElementById('cardDetailLoading');
  const tableWrap=document.getElementById('cardDetailTableWrap');
  if(!sorted.length){
    loadEl.innerHTML='<div style="padding:40px 0 20px;text-align:center"><span class="material-icons-round" style="font-size:28px;line-height:1;color:var(--text4);margin-bottom:10px;display:inline-block">inbox</span><div style="font-size:13px;font-weight:500;color:var(--text2);margin-bottom:4px">수집 데이터 없음</div><div style="font-size:11px;color:var(--text3)">해당 기간에 수집된 데이터가 없습니다</div></div>';
    loadEl.style.display='block';
    tableWrap.style.display='none';
    return;
  }
  loadEl.style.display='none';
  tableWrap.style.display='block';
  const hourly=aggregateHourlyReadings(sorted);
  cardDetailHourlyData=hourly;
  document.getElementById('cardDetailCount').textContent=`시간대 ${hourly.length}개 (원본 ${sorted.length}건 평균) — 행을 누르면 원본 상세가 펼쳐집니다`;
  document.getElementById('cardDetailBody').innerHTML=hourly.map((item,idx)=>`<tr class="card-detail-hour-row" onclick="toggleCardDetailHourRow(${idx})">
      <td title="${item.sampleCount}건 평균 — 눌러서 원본 보기">${escHtml(item.format_created_time||'—')}</td>
      <td>${item.pm_10??'—'}</td>
      <td>${item.pm_2_5??'—'}</td>
      <td>${item.co2??'—'}</td>
    </tr>`).join('');
  _renderCardDetailChart([...hourly].reverse(), [...sorted].reverse());
}

// 시간대별 평균 행을 클릭하면 그 시간대에 실제 수집된 원본 데이터를 작은 표로 펼쳐 보여줌 (아코디언)
function toggleCardDetailHourRow(idx){
  const body=document.getElementById('cardDetailBody');
  const row=body.querySelectorAll('tr.card-detail-hour-row')[idx];
  if(!row) return;
  const next=row.nextElementSibling;
  if(next&&next.classList.contains('card-detail-hour-expand')){
    next.remove();
    row.classList.remove('expanded');
    return;
  }
  body.querySelectorAll('tr.card-detail-hour-expand').forEach(el=>el.remove());
  body.querySelectorAll('tr.card-detail-hour-row.expanded').forEach(el=>el.classList.remove('expanded'));

  const item=cardDetailHourlyData[idx];
  if(!item||!item.rawItems.length) return;
  row.classList.add('expanded');
  const expandRow=document.createElement('tr');
  expandRow.className='card-detail-hour-expand';
  expandRow.innerHTML=`<td colspan="4">
    <div class="card-detail-hour-raw-wrap">
      <table class="card-detail-hour-raw-table">
        <thead><tr><th>수집 시간</th><th>PM10</th><th>PM2.5</th><th>CO₂</th></tr></thead>
        <tbody>${item.rawItems.map(r=>`<tr>
          <td>${escHtml(r.format_created_time||'—')}</td>
          <td>${r.pm_10??'—'}</td>
          <td>${r.pm_2_5??'—'}</td>
          <td>${r.co2??'—'}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
  </td>`;
  row.after(expandRow);
}
// items: 시간대별 평균(오름차순) — 공기질 차트/최소·최대 요약용
// rawItems: 원본 미집계 데이터(오름차순) — 가동횟수/가동시간은 누적값이라 평균이 아닌 diff로 계산해야 해서 별도로 받음
function _renderCardDetailChart(items, rawItems){
  if(cardDetailChartDust){cardDetailChartDust.destroy();cardDetailChartDust=null;}
  if(cardDetailChartMotor){cardDetailChartMotor.destroy();cardDetailChartMotor=null;}
  const dustEl=document.getElementById('cardDetailDustMinMax');
  const co2El=document.getElementById('cardDetailCo2MinMax');
  if(dustEl) dustEl.innerHTML='';
  if(co2El)  co2El.innerHTML='';
  if(!items.length) return;

  const isDark=document.documentElement.getAttribute('data-theme')==='dark';
  const gridColor=isDark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.07)';
  const tickColor=isDark?'#8a8380':'#6b6560';
  const tooltipBase={
    backgroundColor:isDark?'#1d1a18':'#ffffff',
    titleColor:isDark?'#eeeeee':'#171514',
    bodyColor:isDark?'#b8b3b0':'#433f3d',
    borderColor:isDark?'#3d3a39':'#ddd9d5',
    borderWidth:1, padding:10,
  };
  const labels=items.map(d=>fmtTime(d.format_created_time));
  const pt=items.length>15?2:4;

  const pm10Vals=items.map(d=>d.pm_10!==undefined?Number(d.pm_10):null);
  const pm25Vals=items.map(d=>d.pm_2_5!==undefined?Number(d.pm_2_5):null);
  const co2Vals =items.map(d=>d.co2!==undefined?Number(d.co2):null);
  const allZeroMask=items.map(d=>Number(d.pm_10)===0&&Number(d.pm_2_5)===0&&Number(d.co2)===0);
  const safeMinMax=vals=>{const v=vals.filter((x,i)=>x!==null&&!allZeroMask[i]);return v.length?[Math.min(...v),Math.max(...v)]:[null,null];};
  const [minPm10,maxPm10]=safeMinMax(pm10Vals);
  const [minPm25,maxPm25]=safeMinMax(pm25Vals);
  const [minCo2, maxCo2 ]=safeMinMax(co2Vals);

  const minMaxRow=(items2)=>items2.filter(([,mn])=>mn!==null).map(([label,mn,mx,unit])=>
    `<span>${label} <b style="color:#a0ca92">${mn}${unit}</b> · <b style="color:#c17262">${mx}${unit}</b></span>`
  ).join('<span style="color:var(--border2)">|</span>');

  const rowStyle='display:flex;gap:10px;align-items:center;font-size:11px;color:var(--text3);padding:4px 0 10px;flex-wrap:wrap';
  if(dustEl) dustEl.innerHTML=`<div style="${rowStyle}">${minMaxRow([['PM10 ',minPm10,maxPm10,'㎍/㎥'],['PM2.5 ',minPm25,maxPm25,'㎍/㎥']])}</div>`;
  if(co2El)  co2El.innerHTML=`<div style="${rowStyle}">${minMaxRow([['CO₂ ',minCo2,maxCo2,'ppm']])}</div>`;

  requestAnimationFrame(()=>setTimeout(()=>{
    /* ── 공기질 차트: PM10·PM2.5(좌) + CO₂(우) 하나로 통합 — 단일점검과 동일 스타일 ── */
    const canvasDust=document.getElementById('cardDetailChartDust');
    if(canvasDust){
      cardDetailChartDust=new Chart(canvasDust,{type:'line', data:{labels, datasets:[
        {label:'PM10 (㎍/㎥)', data:pm10Vals,
         yAxisID:'y', borderColor:'#5f8fb3', backgroundColor:'rgba(95,143,179,0.12)',
         fill:true, tension:0.4, pointRadius:pt, pointHoverRadius:7,
         pointBackgroundColor:'#5f8fb3', borderWidth:2.5, spanGaps:false},
        {label:'PM2.5 (㎍/㎥)', data:pm25Vals,
         yAxisID:'y', borderColor:'#a0ca92', backgroundColor:'rgba(160,202,146,0.07)',
         fill:true, tension:0.4, pointRadius:pt, pointHoverRadius:7,
         pointBackgroundColor:'#a0ca92', borderWidth:2.5, spanGaps:false},
        {label:'CO₂ (ppm)', data:co2Vals,
         yAxisID:'y1', borderColor:'#ee6018', backgroundColor:'rgba(238,96,24,0.10)',
         fill:true, tension:0.4, pointRadius:pt, pointHoverRadius:7,
         pointBackgroundColor:'#ee6018', borderWidth:2.5, spanGaps:false},
      ]}, options:{
        responsive:true, maintainAspectRatio:false,
        animation:{duration:400},
        layout:{padding:{top:22}},
        interaction:{mode:'index',intersect:false},
        plugins:{
          legend:{display:false},
          tooltip:{
            ...tooltipBase,
            callbacks:{
              label:ctx=>{
                const v=ctx.parsed.y;
                if(v===null||v===undefined) return null;
                const u=ctx.dataset.yAxisID==='y1'?' ppm':' ㎍/㎥';
                return ` ${ctx.dataset.label.split(' ')[0]}: ${v}${u}`;
              }
            }
          }
        },
        scales:{
          x:{ticks:{color:tickColor,font:{size:9},maxRotation:45,autoSkip:true,maxTicksLimit:10},
             grid:{color:gridColor},border:{display:false}},
          y:{position:'left',
             ticks:{color:'#5f8fb3',font:{size:9},maxTicksLimit:6,callback:v=>Number.isInteger(v)?v:null},
             grid:{color:gridColor},border:{display:false},beginAtZero:true,min:0},
          y1:{position:'right',
              ticks:{color:'#ee6018',font:{size:9},maxTicksLimit:6,callback:v=>Number.isInteger(v)?v:null},
              grid:{drawOnChartArea:false},border:{display:false},beginAtZero:true,min:0},
        }
      }, plugins:[yLabelPlugin('㎍/㎥','#5f8fb3','ppm','#ee6018')]});
      injectChartLegend(canvasDust,[
        {borderColor:'#5f8fb3', label:'PM10 (㎍/㎥)'},
        {borderColor:'#a0ca92', label:'PM2.5 (㎍/㎥)'},
        {borderColor:'#ee6018', label:'CO₂ (ppm)'},
      ]);
    }

    /* ── 가동 횟수/시간 차트: 시간대 평균이 아닌 원본 데이터로 diff 계산 — 단일점검과 동일 ── */
    const canvasMotor=document.getElementById('cardDetailChartMotor');
    if(canvasMotor){
      const motorItems=rawItems.slice(1);
      const motorLabels=motorItems.map(d=>fmtTime(d.format_created_time));
      const motorPt=motorItems.length>15?2:4;
      const countDiffs=motorItems.map((d,i)=>{
        const cur=d.report_data?.motorRunningCount;
        const prv=rawItems[i].report_data?.motorRunningCount;
        if(cur==null||prv==null) return null;
        const diff=Number(cur)-Number(prv);
        return diff>=0?diff:null;
      });
      const timeDiffs=motorItems.map((d,i)=>{
        const cur=hmsToSec(d.report_data?.motorRunningTime);
        const prv=hmsToSec(rawItems[i].report_data?.motorRunningTime);
        if(cur==null||prv==null) return null;
        const diff=cur-prv;
        return diff>=0?diff:null;
      });
      cardDetailChartMotor=new Chart(canvasMotor,{type:'bar', data:{labels:motorLabels, datasets:[
        {label:'가동 횟수 (회)', data:countDiffs,
         yAxisID:'y', backgroundColor:'rgba(193,114,98,0.55)', borderColor:'#c17262',
         borderWidth:1.5, borderRadius:3, type:'bar'},
        {label:'가동 시간 (초)', data:timeDiffs,
         yAxisID:'y1', borderColor:'#ee6018', backgroundColor:'rgba(238,96,24,0.15)',
         fill:true, tension:0.4, pointRadius:motorPt, pointHoverRadius:7,
         pointBackgroundColor:'#ee6018', borderWidth:2.5, type:'line', spanGaps:false},
      ]}, options:{
        responsive:true, maintainAspectRatio:false,
        animation:{duration:400},
        layout:{padding:{top:22}},
        interaction:{mode:'index',intersect:false},
        plugins:{
          legend:{display:false},
          tooltip:{
            ...tooltipBase,
            callbacks:{
              label:ctx=>{
                const v=ctx.parsed.y;
                if(v===null||v===undefined) return null;
                if(ctx.dataset.yAxisID==='y1') return ` 가동 시간: ${secToHms(v)}`;
                return ` 가동 횟수: ${v}회`;
              }
            }
          }
        },
        scales:{
          x:{ticks:{color:tickColor,font:{size:9},maxRotation:45,autoSkip:true,maxTicksLimit:10},
             grid:{color:gridColor},border:{display:false}},
          y:{position:'left',
             ticks:{color:'#c17262',font:{size:9},callback:v=>Number.isInteger(v)?v:null,maxTicksLimit:6},
             grid:{color:gridColor},border:{display:false},beginAtZero:true,min:0},
          y1:{position:'right',
              ticks:{color:'#ee6018',font:{size:9},callback:v=>Number.isInteger(v)?v:null,maxTicksLimit:6},
              grid:{drawOnChartArea:false},border:{display:false},beginAtZero:true,min:0},
        }
      }, plugins:[yLabelPlugin('회','#c17262','초','#ee6018')]});

      const firstItem=rawItems[0], lastItem=rawItems[rawItems.length-1];
      const rawFirst=firstItem?.report_data?.motorRunningCount;
      const rawLast=lastItem?.report_data?.motorRunningCount;
      const totalCount=(rawFirst!=null&&rawLast!=null)?Math.max(0,Number(rawLast)-Number(rawFirst)):null;
      const firstTimeSec=hmsToSec(firstItem?.report_data?.motorRunningTime);
      const lastTimeSec=hmsToSec(lastItem?.report_data?.motorRunningTime);
      const totalTimeSec=(firstTimeSec!=null&&lastTimeSec!=null)?Math.max(0,lastTimeSec-firstTimeSec):null;

      injectChartLegend(canvasMotor,[
        {type:'bar', borderColor:'#c17262', label:'가동 횟수 (회)'},
        {borderColor:'#ee6018', label:'가동 시간 (초)'},
      ]);
      const panel=canvasMotor.closest('.single-chart-panel');
      const legendBar=panel?.querySelector('.chart-legend-bar');
      if(legendBar){
        const statWrap=document.createElement('span');
        statWrap.style.cssText='display:inline-flex;gap:6px;margin-left:auto';
        statWrap.innerHTML=
          `<span class="chart-legend-chip motor-stat-chip" style="color:#c17262;border-color:rgba(193,114,98,0.4)"><span class="clc-bar" style="background:#c17262"></span>${totalCount!=null?Number(totalCount).toLocaleString()+'회':'—'}</span>`+
          `<span class="chart-legend-chip motor-stat-chip" style="color:#ee6018;border-color:rgba(238,96,24,0.4)"><span class="clc-dot" style="background:#ee6018"></span>${secToHms(totalTimeSec)}</span>`;
        legendBar.appendChild(statWrap);
      }
    }
  },50));
}
function closeCardDetailModal(){
  cardDetailModalOpen=false;
  document.getElementById('cardDetailModal').style.display='none';
  document.body.style.overflow='';
  if(cardDetailChartDust){cardDetailChartDust.destroy();cardDetailChartDust=null;}
  if(cardDetailChartMotor){cardDetailChartMotor.destroy();cardDetailChartMotor=null;}
}
function cardDetailOverlayClick(e){
  if(e.target===document.getElementById('cardDetailModal')) closeCardDetailModal();
}

function renderSingleDetail(id, items){
  singleAllItems=[...items].sort((a,b)=>
    new Date(b.format_created_time)-new Date(a.format_created_time));
  singlePage=0; singleShowAll=false;
  const showAllBtn=document.getElementById('singleShowAllBtn');
  if(showAllBtn) showAllBtn.classList.remove('active');
  document.getElementById('singleDetailTitle').textContent=`${id} — 총 ${items.length}건`;
  document.getElementById('singleResultSection').style.display='block';
  const copyBtn=document.getElementById('singleCopyBtn');
  if(!items.length){
    document.getElementById('singleDetailBody').innerHTML=
      `<tr><td colspan="4" class="single-detail-empty" style="text-align:center">조회된 데이터가 없습니다</td></tr>`;
    document.getElementById('singlePagination').innerHTML='';
    document.getElementById('singlePageInfo').textContent='';
    copyBtn.style.display='none';
    renderSingleChart([]);
    return;
  }
  copyBtn.style.display='inline-block';
  renderSinglePage();
}

function renderSinglePage(){
  const total=singleAllItems.length;
  const totalPages=Math.ceil(total/SINGLE_PAGE_SIZE);
  const start=singlePage*SINGLE_PAGE_SIZE;
  const pageItems=singleShowAll ? singleAllItems : singleAllItems.slice(start, start+SINGLE_PAGE_SIZE);

  document.getElementById('singlePageInfo').textContent= singleShowAll
    ? `전체 ${total}건`
    : `${start+1}–${Math.min(start+SINGLE_PAGE_SIZE,total)} / ${total}건`;

  document.getElementById('singleDetailBody').innerHTML=pageItems.map(item=>`<tr>
    <td>${escHtml(fmtTime(item.format_created_time))}</td>
    <td>${item.pm_10!==undefined?item.pm_10:'—'}</td>
    <td>${item.pm_2_5!==undefined?item.pm_2_5:'—'}</td>
    <td>${item.co2!==undefined?item.co2:'—'}</td>
  </tr>`).join('');

  renderSingleChart([...pageItems].reverse());

  const pg=document.getElementById('singlePagination');
  if(singleShowAll||totalPages<=1){pg.innerHTML='';return;}
  let html=`<button class="pg-btn" onclick="goSinglePage(${singlePage-1})" ${singlePage===0?'disabled':''}>← 이전</button>`;
  const range=3, start2=Math.max(0,singlePage-range), end2=Math.min(totalPages-1,singlePage+range);
  if(start2>0) html+=`<button class="pg-btn" onclick="goSinglePage(0)">1</button>${start2>1?'<span class="pg-info">…</span>':''}`;
  for(let i=start2;i<=end2;i++)
    html+=`<button class="pg-btn${i===singlePage?' active':''}" onclick="goSinglePage(${i})">${i+1}</button>`;
  if(end2<totalPages-1) html+=`${end2<totalPages-2?'<span class="pg-info">…</span>':''}<button class="pg-btn" onclick="goSinglePage(${totalPages-1})">${totalPages}</button>`;
  html+=`<button class="pg-btn" onclick="goSinglePage(${singlePage+1})" ${singlePage===totalPages-1?'disabled':''}>다음 →</button>`;
  pg.innerHTML=html;
}

function goSinglePage(p){
  const totalPages=Math.ceil(singleAllItems.length/SINGLE_PAGE_SIZE);
  if(p<0||p>=totalPages) return;
  singlePage=p;
  renderSinglePage();
  document.getElementById('singleResultSection').scrollIntoView({behavior:'smooth',block:'start'});
}
function toggleSingleShowAll(){
  singleShowAll=!singleShowAll;
  document.getElementById('singleShowAllBtn').classList.toggle('active',singleShowAll);
  singlePage=0;
  if(singleAllItems.length) renderSinglePage();
}

function copySingleToClipboard(){
  if(!singleAllItems.length) return;
  const header='수집 시간\tPM10\tPM2.5\tCO₂';
  const rows=singleAllItems.map(d=>
    [fmtTime(d.format_created_time),
     d.pm_10!==undefined?d.pm_10:'',
     d.pm_2_5!==undefined?d.pm_2_5:'',
     d.co2!==undefined?d.co2:''].join('\t')
  );
  const text=[header,...rows].join('\n');
  navigator.clipboard.writeText(text).then(()=>{
    const btn=document.getElementById('singleCopyBtn');
    btn.innerHTML='<span class="material-icons-round ico">check</span>복사됨';
    setTimeout(()=>{ btn.innerHTML='<span class="material-icons-round ico">content_copy</span>전체 복사'; }, 2000);
  }).catch(()=>{ alert('클립보드 복사에 실패했습니다.'); });
}

function injectChartLegend(canvasEl, datasets){
  const panel=canvasEl.closest('.single-chart-panel');
  if(!panel) return;
  let bar=panel.querySelector('.chart-legend-bar');
  if(bar) bar.remove();
  bar=document.createElement('div');
  bar.className='chart-legend-bar';
  panel.querySelector('.single-chart-wrap').before(bar);
  bar.innerHTML=datasets.map(ds=>{
    const dot=ds.type==='bar'
      ?`<span class="clc-bar" style="background:${ds.borderColor};opacity:0.8"></span>`
      :`<span class="clc-dot" style="background:${ds.borderColor}"></span>`;
    return `<span class="chart-legend-chip">${dot}${escHtml(ds.label)}</span>`;
  }).join('');
}

function renderSingleChart(items){
  if(singleChartDust){ singleChartDust.destroy(); singleChartDust=null; }
  if(singleChartMotor){ singleChartMotor.destroy(); singleChartMotor=null; }
  if(!items.length) return;

  const isDark=document.documentElement.getAttribute('data-theme')==='dark';
  const gridColor=isDark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.07)';
  const tickColor=isDark?'#8a8380':'#6b6560';
  const tooltipBase={
    backgroundColor:isDark?'#1d1a18':'#ffffff',
    titleColor:isDark?'#eeeeee':'#171514',
    bodyColor:isDark?'#b8b3b0':'#433f3d',
    borderColor:isDark?'#3d3a39':'#ddd9d5',
    borderWidth:1, padding:10,
  };
  const labels=items.map(d=>fmtTime(d.format_created_time));
  const pt=items.length>15?2:4;

  /* ── Chart 1: PM10 · PM2.5 (좌/㎍/㎥) + CO₂ (우/ppm) ── */
  const canvasDust=document.getElementById('singleChartDust');
  if(canvasDust){
    singleChartDust=new Chart(canvasDust,{type:'line', data:{labels, datasets:[
      {label:'PM10 (㎍/㎥)', data:items.map(d=>d.pm_10!==undefined?Number(d.pm_10):null),
       yAxisID:'y', borderColor:'#5f8fb3', backgroundColor:'rgba(95,143,179,0.12)',
       fill:true, tension:0.4, pointRadius:pt, pointHoverRadius:7,
       pointBackgroundColor:'#5f8fb3', borderWidth:2.5, spanGaps:false},
      {label:'PM2.5 (㎍/㎥)', data:items.map(d=>d.pm_2_5!==undefined?Number(d.pm_2_5):null),
       yAxisID:'y', borderColor:'#a0ca92', backgroundColor:'rgba(160,202,146,0.07)',
       fill:true, tension:0.4, pointRadius:pt, pointHoverRadius:7,
       pointBackgroundColor:'#a0ca92', borderWidth:2.5, spanGaps:false},
      {label:'CO₂ (ppm)', data:items.map(d=>d.co2!==undefined?Number(d.co2):null),
       yAxisID:'y1', borderColor:'#ee6018', backgroundColor:'rgba(238,96,24,0.10)',
       fill:true, tension:0.4, pointRadius:pt, pointHoverRadius:7,
       pointBackgroundColor:'#ee6018', borderWidth:2.5, spanGaps:false},
    ]}, options:{
      responsive:true, maintainAspectRatio:false,
      animation:{duration:400},
      layout:{padding:{top:22}},
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{display:false},
        tooltip:{
          ...tooltipBase,
          callbacks:{
            label:ctx=>{
              const v=ctx.parsed.y;
              if(v===null||v===undefined) return null;
              const u=ctx.dataset.yAxisID==='y1'?' ppm':' ㎍/㎥';
              return ` ${ctx.dataset.label.split(' ')[0]}: ${v}${u}`;
            }
          }
        }
      },
      scales:{
        x:{ticks:{color:tickColor,font:{size:10},maxRotation:45,autoSkip:true,maxTicksLimit:12},
           grid:{color:gridColor},border:{display:false}},
        y:{position:'left',
           ticks:{color:'#5f8fb3',font:{size:10},maxTicksLimit:6,callback:v=>Number.isInteger(v)?v:null},
           grid:{color:gridColor},border:{display:false},beginAtZero:true,min:0},
        y1:{position:'right',
            ticks:{color:'#ee6018',font:{size:10},maxTicksLimit:6,callback:v=>Number.isInteger(v)?v:null},
            grid:{drawOnChartArea:false},border:{display:false},beginAtZero:true,min:0},
      }
    }, plugins:[yLabelPlugin('㎍/㎥','#5f8fb3','ppm','#ee6018')]});
    injectChartLegend(canvasDust,[
      {borderColor:'#5f8fb3', label:'PM10 (㎍/㎥)'},
      {borderColor:'#a0ca92', label:'PM2.5 (㎍/㎥)'},
      {borderColor:'#ee6018', label:'CO₂ (ppm)'},
    ]);
  }

  /* ── Chart 2: 가동 횟수(좌/회) + 가동 시간(우/초) — 첫 항목 제외 후 diff ── */
  const motorItems=items.slice(1);
  const motorLabels=motorItems.map(d=>fmtTime(d.format_created_time));
  const motorPt=motorItems.length>15?2:4;
  const countDiffs=motorItems.map((d,i)=>{
    const cur=d.report_data?.motorRunningCount;
    const prv=items[i].report_data?.motorRunningCount;
    if(cur==null||prv==null) return null;
    const diff=Number(cur)-Number(prv);
    return diff>=0?diff:null;
  });
  const timeDiffs=motorItems.map((d,i)=>{
    const cur=hmsToSec(d.report_data?.motorRunningTime);
    const prv=hmsToSec(items[i].report_data?.motorRunningTime);
    if(cur==null||prv==null) return null;
    const diff=cur-prv;
    return diff>=0?diff:null;
  });

  const canvasMotor=document.getElementById('singleChartMotor');
  if(canvasMotor){
    singleChartMotor=new Chart(canvasMotor,{type:'bar', data:{labels:motorLabels, datasets:[
      {label:'가동 횟수 (회)', data:countDiffs,
       yAxisID:'y', backgroundColor:'rgba(193,114,98,0.55)', borderColor:'#c17262',
       borderWidth:1.5, borderRadius:3, type:'bar'},
      {label:'가동 시간 (초)', data:timeDiffs,
       yAxisID:'y1', borderColor:'#ee6018', backgroundColor:'rgba(238,96,24,0.15)',
       fill:true, tension:0.4, pointRadius:motorPt, pointHoverRadius:7,
       pointBackgroundColor:'#ee6018', borderWidth:2.5, type:'line', spanGaps:false},
    ]}, options:{
      responsive:true, maintainAspectRatio:false,
      animation:{duration:400},
      layout:{padding:{top:22}},
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{display:false},
        tooltip:{
          ...tooltipBase,
          callbacks:{
            label:ctx=>{
              const v=ctx.parsed.y;
              if(v===null||v===undefined) return null;
              if(ctx.dataset.yAxisID==='y1') return ` 가동 시간: ${secToHms(v)}`;
              return ` 가동 횟수: ${v}회`;
            }
          }
        }
      },
      scales:{
        x:{ticks:{color:tickColor,font:{size:10},maxRotation:45,autoSkip:true,maxTicksLimit:12},
           grid:{color:gridColor},border:{display:false}},
        y:{position:'left',
           ticks:{color:'#c17262',font:{size:10},callback:v=>Number.isInteger(v)?v:null,maxTicksLimit:6},
           grid:{color:gridColor},border:{display:false},beginAtZero:true,min:0},
        y1:{position:'right',
            ticks:{color:'#ee6018',font:{size:10},callback:v=>Number.isInteger(v)?v:null,maxTicksLimit:6},
            grid:{drawOnChartArea:false},border:{display:false},beginAtZero:true,min:0},
      }
    }, plugins:[yLabelPlugin('회','#c17262','초','#ee6018')]});
    /* 총 가동 횟수 / 시간 — 기간 내 총량 = 마지막 - 첫번째 */
    const firstItem=items[0], lastItem=items[items.length-1];
    const rawFirst=firstItem?.report_data?.motorRunningCount;
    const rawLast=lastItem?.report_data?.motorRunningCount;
    const totalCount=(rawFirst!=null&&rawLast!=null)?Math.max(0,Number(rawLast)-Number(rawFirst)):null;
    const firstTimeSec=hmsToSec(firstItem?.report_data?.motorRunningTime);
    const lastTimeSec=hmsToSec(lastItem?.report_data?.motorRunningTime);
    const totalTimeSec=(firstTimeSec!=null&&lastTimeSec!=null)?Math.max(0,lastTimeSec-firstTimeSec):null;

    injectChartLegend(canvasMotor,[
      {type:'bar', borderColor:'#c17262', label:'가동 횟수 (회)'},
      {borderColor:'#ee6018', label:'가동 시간 (초)'},
    ]);

    /* 합산 칩을 범례 바 오른쪽에 추가 */
    const panel=canvasMotor.closest('.single-chart-panel');
    const legendBar=panel?.querySelector('.chart-legend-bar');
    if(legendBar){
      const statWrap=document.createElement('span');
      statWrap.style.cssText='display:inline-flex;gap:5px;margin-left:auto;flex-shrink:0;';
      statWrap.innerHTML=
        `<span class="chart-legend-chip motor-stat-chip" style="color:#c17262;border-color:rgba(193,114,98,0.4)"><span class="clc-bar" style="background:#c17262"></span>${totalCount!=null?Number(totalCount).toLocaleString()+'회':'—'}</span>`+
        `<span class="chart-legend-chip motor-stat-chip" style="color:#ee6018;border-color:rgba(238,96,24,0.4)"><span class="clc-dot" style="background:#ee6018"></span>${secToHms(totalTimeSec)}</span>`;
      legendBar.appendChild(statWrap);
    }
  }
}

/* ===== 공통 실행 ===== */
async function runInspection(allIds){
  const token=document.getElementById('tokenInput').value.trim();
  if(!token){document.getElementById('errorMsg').textContent='⚠ 토큰이 설정되지 않았습니다.';return;}
  setGlobalLock(true);
  cardDetailCache.clear();
  document.body.classList.remove('zone-active');
  const psh=document.getElementById('preSearchHint');
  if(psh) psh.style.display='none';
  document.getElementById('summary').style.display='none';
  document.getElementById('grid').innerHTML=''; document.getElementById('listBody').innerHTML='';
  currentFilter='ALL'; currentView='grid';
  const dateRange=getDateRange(currentMode); lastDateRange=dateRange;
  const nowMs=Date.now(),total=allIds.length;
  setLoading(true,0,total);
  addLog(`총 ${total}개 점검 시작`,'info');
  addLog(`기간: ${dateRange.started_at} ~ ${dateRange.finished_at}`,'muted');

  // LOAD 카드 선렌더
  results=allIds.map(id=>({id,status:'LOAD',item:null,errMsg:''}));
  lastResults=results;
  document.getElementById('summary').style.display='flex';
  document.getElementById('grid').style.display='grid';
  document.getElementById('listView').style.display='none';
  document.getElementById('listToolbar').style.display='none';
  renderSummary(); renderGrid();

  let done=0;
  await Promise.all(allIds.map(async(id,idx)=>{
    try{
      const item=await fetchReport(id,dateRange,token);
      const status=id==='A139'?'OK':classify(item,nowMs,id);
      results[idx]={id,status,item,errMsg:''};
      addLog(`[${id}] ${status}`+(item?` | ${item.format_created_time}`:'  | 데이터 없음'),status==='OK'?'ok':status==='ERR'?'err':'warn');
    }catch(err){
      results[idx]={id,status:'ERR',item:null,errMsg:err.message};
      addLog(`[${id}] ERR → ${err.message}`,'err');
    }
    updateGridCard(results[idx]);
    renderSummary();
    setLoading(true,++done,total);
  }));

  lastResults=[...results];
  setLoading(false);
  setGlobalLock(false);
  if(zoneGridOpen) toggleZoneGrid();
  selectedZones.clear();
  renderZoneGrid();
  updateZoneCount();
  document.body.classList.remove('zone-active');
  addLog(`✓ 점검 완료 (${elapsedText()} 소요)`,'ok');
  document.getElementById('logBtn').style.display='inline-block';
  if(adminAuthenticated) updateSheetBtn();
  if(logVisible)renderLog();
  setTimeout(()=>{
    const s=document.getElementById('summary');
    if(s&&s.offsetParent!==null) s.scrollIntoView({behavior:'smooth',block:'start'});
  },150);
}

/* ===== 메인 진입 ===== */
async function startInspection(){
  if(isGlobalLocked) return;
  const errEl=document.getElementById('errorMsg');
  errEl.textContent=''; logs=[];
  const token=document.getElementById('tokenInput').value.trim();

  /* 단일 검색 */
  if(currentMode==='single'){
    const raw=document.getElementById('singleIdInput').value.trim();
    if(!raw){errEl.textContent='⚠ 제품 ID를 입력해주세요.';return;}
    const startVal=document.getElementById('singleStartDate').value;
    const endVal=document.getElementById('singleEndDate').value;
    const startMs=startVal?new Date(startVal).getTime():null;
    const endMs=endVal?new Date(endVal).getTime()+59999:null;
    if(startMs&&endMs&&startMs>=endMs){errEl.textContent='⚠ 종료 시간이 시작 시간보다 뒤여야 합니다.';return;}
    const dateRange=getDateRange('single');
    setGlobalLock(true);
    setLoading(true);
    document.getElementById('loadingText').textContent='데이터 수집 중…';
    try{
      const allItems=await fetchAllReports(raw,dateRange,token,(pg,last)=>{
        const base=last>1?`데이터 수집 중… (${pg}/${last} 페이지)`:'데이터 수집 중…';
        const et=elapsedText();
        document.getElementById('loadingText').textContent=et?`${base}  (${et})`:base;
      });
      // API는 날짜 단위로만 필터링되므로 시간 범위는 클라이언트에서 처리
      const items=allItems.filter(item=>{
        const d=parseFormatTime(item.format_created_time);
        if(!d) return false;
        if(startMs&&d.getTime()<startMs) return false;
        if(endMs&&d.getTime()>endMs) return false;
        return true;
      });
      addLog(`단일 검색 완료 — 수집 ${allItems.length}건 / 시간 필터 후 ${items.length}건 (${elapsedText()} 소요)`,'ok');
      renderSingleDetail(raw,items);
    }catch(e){
      errEl.textContent='⚠ 오류: '+e.message;
    }finally{
      setLoading(false);
      setGlobalLock(false);
    }
    return;
  }

  /* 영역 점검 */
  if(currentMode==='zone'){
    if(selectedZones.size===0){errEl.textContent='⚠ 영역을 하나 이상 선택해주세요.';return;}
    const zoneIds=[];
    selectedZones.forEach(i=>{ if(sheetZones[i]) zoneIds.push(...sheetZones[i].ids); });
    await runInspection([...new Set(zoneIds)]);
    return;
  }

  /* 범위 검색 */
  const domStartRaw    = document.getElementById('domStartId').value.trim()||'A001';
  const domEndRaw      = document.getElementById('domEndId').value.trim();
  const globalStartRaw = document.getElementById('globalStartId').value.trim()||'G001';
  const globalEndRaw   = document.getElementById('globalEndId').value.trim();

  function buildRange(startRaw, endRaw, label){
    const s=parseId(startRaw), e=parseId(endRaw);
    if(!s||!e){errEl.textContent=`⚠ ${label} ID 형식이 잘못되었습니다.`;return null;}
    if(s.prefix!==e.prefix){errEl.textContent=`⚠ ${label} 시작/끝 ID 접두사가 같아야 합니다.`;return null;}
    if(s.num>e.num){errEl.textContent=`⚠ ${label} 끝 ID가 시작 ID보다 작습니다.`;return null;}
    const padLen=Math.max(s.padLen,e.padLen);
    const ids=[];
    for(let n=s.num;n<=e.num;n++) ids.push(formatId(s.prefix,n,padLen));
    return ids;
  }

  let rangeIds=[];
  if(domEndRaw){
    const ids=buildRange(domStartRaw, domEndRaw, '국내');
    if(ids===null) return;
    rangeIds.push(...ids);
    lsSet(LS_ENDID, domEndRaw);
  }
  if(globalEndRaw){
    const ids=buildRange(globalStartRaw, globalEndRaw, '글로벌');
    if(ids===null) return;
    rangeIds.push(...ids);
    lsSet(LS_GLOBAL_ENDID, globalEndRaw);
  }

  const allIds=[...new Set([...rangeIds,...extraIds])];
  if(allIds.length===0){errEl.textContent='⚠ 점검할 ID가 없습니다.';return;}
  await runInspection(allIds);
}

/* ===== 페이지 전환 (점검 / 히스토리) ===== */
function switchPage(page){
  currentPage=page;
  document.getElementById('pageTabInspection').classList.toggle('active', page==='inspection');
  document.getElementById('pageTabHistory').classList.toggle('active', page==='history');
  document.getElementById('inspectionPage').style.display = page==='inspection' ? '' : 'none';
  document.getElementById('historyPage').style.display = page==='history' ? '' : 'none';
  // 히스토리 페이지는 모바일 고정 버튼이 없어 body의 넉넉한 padding-bottom(80px)이 불필요 —
  // 그대로 두면 그리드 높이를 아무리 정확히 맞춰도 그 여유분만큼 페이지 자체 스크롤(더블 스크롤)이 남음
  document.body.classList.toggle('history-page-active', page==='history');
  // 히스토리 탭에 들어올 때마다 최신 데이터로 동기화 (당일 점검 후 바로 확인 못했을 수 있으므로 캐시된 월도 강제 재조회)
  if(page==='history') loadHistoryMonths(true);
}

/* ===== 점검 히스토리 ===== */
function loadHistoryMonths(forceReload){
  const sel=document.getElementById('historyMonthSel');
  if(!historyMonths.length){
    sel.innerHTML='<option value="">(월 데이터 없음)</option>';
    document.getElementById('historyEmptyMsg').style.display='block';
    document.getElementById('historyEmptyMsg').textContent='표시할 데이터가 없습니다. 월을 선택하거나 시트 데이터를 새로고침 해주세요.';
    document.getElementById('historyGridScroll').style.display='none';
    return;
  }
  const ordered=[...historyMonths].reverse(); // 최신 월 먼저
  const prevVal=sel.value;
  sel.innerHTML=ordered.map(m=>`<option value="${escHtml(m)}">${escHtml(m)}</option>`).join('');
  const target=ordered.includes(prevVal)?prevVal:ordered[0];
  sel.value=target;
  if(forceReload || historyLoadedMonth!==target) loadHistoryGrid(target);
}

async function loadHistoryGrid(sheetName){
  if(!sheetName) return;
  if(!GAS_URL){ alert('GAS_URL이 설정되지 않았습니다.'); return; }
  const scrollEl=document.getElementById('historyGridScroll');
  const emptyEl=document.getElementById('historyEmptyMsg');
  scrollEl.style.display='none'; emptyEl.style.display='block'; emptyEl.textContent='불러오는 중…';
  try{
    const res=await fetch(GAS_URL,{method:'POST',headers:{'Content-Type':'text/plain'},
      body:JSON.stringify({action:'getMonthGrid', sheetName})});
    const json=await res.json();
    if(!json.success){ emptyEl.textContent='불러오기 실패: '+(json.error||'오류'); return; }
    historyGridData=json;
    historyLoadedMonth=sheetName;
    historyFilterQ='';
    historyDayFilterIdx=-1;
    document.getElementById('historySearchInput').value='';
    populateHistoryDaySelect();
    renderHistoryGrid();
  }catch(e){
    emptyEl.textContent='오류: '+e.message;
  }
}

// "07.13(월)" 형식의 시트 원본 헤더를 "07/13(월)" 표기로 변환
function formatHistHeader(raw){
  return String(raw==null?'':raw).replace(/^(\d{1,2})\.(\d{1,2})/, '$1/$2');
}

function populateHistoryDaySelect(){
  const sel=document.getElementById('historyDaySel');
  if(!sel) return;
  const dates=historyGridData?historyGridData.dates:[];
  sel.innerHTML='<option value="">전체 일자</option>'+
    dates.map((d,i)=>`<option value="${i}">${escHtml(formatHistHeader(d))}</option>`).join('');
  sel.value='';
}

function filterHistoryDay(val){
  historyDayFilterIdx=(val===''||val==null)?-1:parseInt(val,10);
  renderHistoryGrid();
}

function historyCellInfo(raw){
  const v=String(raw==null?'':raw).trim();
  if(!v) return {cls:'hist-blank', label:''};
  const up=v.toUpperCase();
  if(up==='OK') return {cls:'hist-ok', label:'OK'};
  if(up==='NO') return {cls:'hist-no', label:'NO'};
  if(up==='EM') return {cls:'hist-em', label:'EM'};
  if(up==='PM') return {cls:'hist-pm', label:'PM'};
  return {cls:'hist-excl', label:v}; // 유지보수X / 설치X 등 제외 사유
}

// 일자별 OK/NO/EM/PM/제외 개수 통계 — 현재 검색/일자 필터가 적용된 행·열 기준으로 집계
const HIST_STAT_ROWS=[
  {key:'ok',   label:'정상(OK)',  cls:'ok'},
  {key:'no',   label:'통신오류(NO)', cls:'no'},
  {key:'em',   label:'센서오류(EM)', cls:'em'},
  {key:'pm',   label:'먼지오류(PM)', cls:'pm'},
  {key:'excl', label:'제외',      cls:'excl'},
  {key:'problem', label:'문제 합(NO+EM+PM)', cls:'problem'}
];
const HIST_STAT_ROW_H=28; // px — 아래 통계 행 top 오프셋 계산과 CSS의 고정 높이가 반드시 일치해야 함

function computeHistoryStats(rows, colIdxs){
  return colIdxs.map(colIdx=>{
    const c={ok:0,no:0,em:0,pm:0,excl:0};
    rows.forEach(r=>{
      const info=historyCellInfo(r.values[colIdx]);
      if(info.cls==='hist-ok') c.ok++;
      else if(info.cls==='hist-no') c.no++;
      else if(info.cls==='hist-em') c.em++;
      else if(info.cls==='hist-pm') c.pm++;
      else if(info.cls==='hist-excl') c.excl++;
    });
    c.problem=c.no+c.em+c.pm;
    return c;
  });
}

function renderHistoryGrid(){
  const scrollEl=document.getElementById('historyGridScroll');
  const emptyEl=document.getElementById('historyEmptyMsg');
  const table=document.getElementById('historyGridTable');
  if(!historyGridData){ scrollEl.style.display='none'; emptyEl.style.display='block'; return; }
  const q=historyFilterQ.trim().toLowerCase();
  const rows=historyGridData.rows.filter(r=>{
    if(!q) return true;
    const zone=(sheetZones.find(z=>z.ids.includes(r.id))||{}).name||'';
    const loc=productLocations[r.id]||'';
    return r.id.toLowerCase().includes(q)||zone.toLowerCase().includes(q)||loc.toLowerCase().includes(q);
  }).sort((a,b)=>a.id.localeCompare(b.id));
  if(!rows.length){
    scrollEl.style.display='none'; emptyEl.style.display='block'; emptyEl.textContent='표시할 데이터가 없습니다.';
    return;
  }
  emptyEl.style.display='none'; scrollEl.style.display='block';
  const allDates=historyGridData.dates;
  const colIdxs=historyDayFilterIdx>=0 && historyDayFilterIdx<allDates.length
    ? [historyDayFilterIdx] : allDates.map((_,i)=>i);

  // 통계 행(일자별 OK/NO/EM/PM/제외/문제합) — 아래 제품 그리드와 열이 정확히 같은 폭으로 시작하도록
  // 같은 table 안에 sticky 헤더 행으로 쌓는다. 각 행이 HIST_STAT_ROW_H(px) 고정 높이이므로
  // top 오프셋을 행 인덱스 × 높이로 직접 계산해 인라인으로 지정한다.
  const stats=computeHistoryStats(rows, colIdxs);
  // "문제 합" 열 중 최댓값(1건 이상)이 있는 날짜를 한눈에 짚을 수 있게 강조 — 행 높이는 그대로 유지
  const maxProblem=Math.max(0,...stats.map(s=>s.problem));
  const statRowsHtml=HIST_STAT_ROWS.map((sr,ri)=>{
    const top=ri*HIST_STAT_ROW_H;
    const cells=stats.map(s=>{
      const isPeak=sr.key==='problem'&&maxProblem>0&&s[sr.key]===maxProblem;
      return `<th class="hist-stat-th hist-stat-${sr.cls}${isPeak?' hist-stat-peak':''}" style="top:${top}px">${s[sr.key]}</th>`;
    }).join('');
    return `<tr class="hist-stat-row"><th class="hist-th-id hist-stat-label-th" style="top:${top}px">${escHtml(sr.label)}</th>${cells}</tr>`;
  }).join('');
  const headerTop=HIST_STAT_ROWS.length*HIST_STAT_ROW_H;
  const dateHeaderHtml=`<tr><th class="hist-th-id" style="top:${headerTop}px">제품 ID</th>${colIdxs.map(i=>`<th style="top:${headerTop}px">${escHtml(formatHistHeader(allDates[i]))}</th>`).join('')}</tr>`;
  const thead=`<thead>${statRowsHtml}${dateHeaderHtml}</thead>`;

  const tbody='<tbody>'+rows.map(r=>{
    const zone=(sheetZones.find(z=>z.ids.includes(r.id))||{}).name||'';
    const loc=[zone,productLocations[r.id]||''].filter(Boolean).join(' · ');
    const cells=colIdxs.map(i=>{
      const info=historyCellInfo(r.values[i]);
      return `<td class="hist-td ${info.cls}" title="${escHtml(info.label)}">${escHtml(info.label)}</td>`;
    }).join('');
    return `<tr><td class="hist-td-id"><div class="hist-id">${escHtml(r.id)}</div><div class="hist-loc">${escHtml(loc)||'—'}</div></td>${cells}</tr>`;
  }).join('')+'</tbody>';
  table.innerHTML=thead+tbody;
}

function filterHistoryGrid(q){
  historyFilterQ=q||'';
  renderHistoryGrid();
}

/* ===== 주간 점검 요청서 ===== */
function populateRequesterSelect(){
  requesterList=lsGet(LS_REQUESTERS,[]);
  const sel=document.getElementById('wrRequesterSel');
  const last=lsGet(LS_LAST_REQUESTER,'');
  if(!requesterList.length){
    sel.innerHTML='<option value="">(등록된 요청자 없음 — 아래에서 추가)</option>';
    return;
  }
  sel.innerHTML=requesterList.map(n=>`<option value="${escHtml(n)}">${escHtml(n)}</option>`).join('');
  sel.value=requesterList.includes(last)?last:requesterList[0];
}

function addRequester(){
  const input=document.getElementById('wrRequesterInput');
  const name=input.value.trim();
  if(!name) return;
  if(!requesterList.includes(name)) requesterList.push(name);
  lsSet(LS_REQUESTERS, requesterList);
  input.value='';
  populateRequesterSelect();
  document.getElementById('wrRequesterSel').value=name;
}

function removeSelectedRequester(){
  const sel=document.getElementById('wrRequesterSel');
  const name=sel.value;
  if(!name) return;
  if(!confirm(`'${name}' 요청자를 목록에서 삭제하시겠습니까?`)) return;
  requesterList=requesterList.filter(n=>n!==name);
  lsSet(LS_REQUESTERS, requesterList);
  populateRequesterSelect();
}

async function openWeeklyReportModal(){
  if(window.innerWidth<=768){ alert('점검 요청서 생성은 PC 환경에서만 지원됩니다.'); return; }
  if(!adminAuthenticated){ alert('관리자 인증이 필요합니다.'); return; }
  if(new Date().getDay()!==1){ alert('점검 요청서는 매주 월요일에만 생성할 수 있습니다.'); return; }
  if(!GAS_URL){ alert('GAS_URL이 설정되지 않았습니다.'); return; }
  populateRequesterSelect();
  document.getElementById('weeklyReportModal').style.display='flex';
  document.getElementById('wrLoading').style.display='block';
  document.getElementById('wrContent').style.display='none';
  weeklyDraft=null;
  try{
    const asOfDate=todayStr();
    const res=await fetch(GAS_URL,{method:'POST',headers:{'Content-Type':'text/plain'},
      body:JSON.stringify({action:'getWeeklyReportDraft', asOfDate})});
    const json=await res.json();
    if(!json.success){ alert('요청서 초안 조회 실패: '+(json.error||'오류')); closeWeeklyReportModal(); return; }
    weeklyDraft=json;
    renderWeeklyReportPreview();
  }catch(e){
    alert('오류: '+e.message);
    closeWeeklyReportModal();
  }
}

function closeWeeklyReportModal(){
  document.getElementById('weeklyReportModal').style.display='none';
}
function weeklyReportOverlayClick(e){
  if(e.target.id==='weeklyReportModal') closeWeeklyReportModal();
}

function wrLocText(it){
  return [it.zone, it.loc].filter(Boolean).join(' · ')||'—';
}

function wrRowHtml(it, idx){
  return `<tr class="${it.isNew?'wr-new-row':''}">
    <td>${idx+1}</td>
    <td>${escHtml(it.since)}</td>
    <td>${escHtml(it.id)}</td>
    <td>${escHtml(wrLocText(it))}</td>
    <td class="wr-code wr-code-${it.code.toLowerCase()}">${it.code}</td>
    <td>${it.isNew?'<span class="wr-new-badge">신규</span> ':''}
      <input type="text" class="wr-remark-input" data-id="${escHtml(it.id)}" placeholder="비고"/></td>
  </tr>`;
}

function renderWeeklyReportPreview(){
  document.getElementById('wrLoading').style.display='none';
  document.getElementById('wrContent').style.display='block';
  const items=weeklyDraft.items||[];
  const overdue=weeklyDraft.overdueItems||[];
  const newCount=items.filter(i=>i.isNew).length;
  document.getElementById('wrSummary').innerHTML=
    `<b>${escHtml(weeklyDraft.asOfDate)}</b> 기준 · 총 <b>${items.length}</b>건 (오늘 신규 <b>${newCount}</b>건) — 30일 이상 지속 <b>${overdue.length}</b>건은 하단에 별도 표시`;
  document.getElementById('wrTable').innerHTML=
    `<thead><tr><th>순번</th><th>오류 발생 시점</th><th>제품 ID</th><th>설치 장소</th><th>오류 코드</th><th>비고</th></tr></thead>
     <tbody>${items.length?items.map((it,i)=>wrRowHtml(it,i)).join(''):'<tr><td colspan="6" style="text-align:center;color:var(--text4)">현재 문제 상태인 제품이 없습니다.</td></tr>'}</tbody>`;
  const overdueSection=document.getElementById('wrOverdueSection');
  if(overdue.length){
    overdueSection.style.display='block';
    document.getElementById('wrOverdueTitle').textContent=`${weeklyDraft.asOfDate} 기준 한달 이상된 항목 리스트`;
    document.getElementById('wrOverdueTable').innerHTML=
      `<thead><tr><th>순번</th><th>오류 발생 시점</th><th>제품 ID</th><th>설치 장소</th><th>오류 코드</th></tr></thead>
       <tbody>${overdue.map((it,i)=>`<tr><td>${i+1}</td><td>${escHtml(it.since)}</td><td>${escHtml(it.id)}</td><td>${escHtml(wrLocText(it))}</td><td class="wr-code wr-code-${it.code.toLowerCase()}">${it.code}</td></tr>`).join('')}</tbody>`;
  } else {
    overdueSection.style.display='none';
  }
}

// ex.xlsx 샘플 서식(글꼴/테두리/열너비/행높이/병합)을 최대한 그대로 재현
async function exportWeeklyReportXlsx(){
  if(!weeklyDraft) return;
  const requester=document.getElementById('wrRequesterSel').value;
  if(!requester){ alert('요청자를 선택하거나 추가해주세요.'); return; }
  if(typeof ExcelJS==='undefined'){ alert('ExcelJS 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인해주세요.'); return; }
  lsSet(LS_LAST_REQUESTER, requester);

  const remarkMap={};
  document.querySelectorAll('.wr-remark-input').forEach(inp=>{ remarkMap[inp.dataset.id]=inp.value.trim(); });
  const items=(weeklyDraft.items||[]).map(it=>({...it, remark: remarkMap[it.id]||''}));
  const overdue=(weeklyDraft.overdueItems||[]).map(it=>({...it, remark: remarkMap[it.id]||''}));
  const CODE_COLOR={EM:'FF0070C0', PM:'FFFF0000'};
  const HILITE={type:'pattern', pattern:'solid', fgColor:{argb:'FFFFFFCC'}};
  const FONT='함초롬돋움';
  const center={horizontal:'center',vertical:'middle'};
  const border=(cell,t,b,l,r)=>{ cell.border={
    top:t?{style:t}:undefined, bottom:b?{style:b}:undefined,
    left:l?{style:l}:undefined, right:r?{style:r}:undefined
  };};
  const dataRow=(ws,vals,isLastInBox)=>{
    const row=ws.addRow(vals);
    const bStyle=isLastInBox?'medium':'thin';
    const cB=row.getCell('B'); cB.font={name:FONT,bold:true,size:12}; cB.alignment=center;
    border(cB,'thin',bStyle,'medium','thin');
    const cC=row.getCell('C'); cC.font={name:FONT,size:11}; cC.alignment=center;
    border(cC,'thin',bStyle,'thin','thin');
    const cD=row.getCell('D'); cD.font={name:FONT,size:12}; cD.alignment=center;
    border(cD,'thin',bStyle,'thin','thin');
    const cE=row.getCell('E'); cE.font={name:FONT,size:12}; cE.alignment=center;
    border(cE,'thin',bStyle,'thin','thin');
    const cF=row.getCell('F');
    const codeFont={name:FONT,bold:true,size:12};
    if(CODE_COLOR[vals[5]]) codeFont.color={argb:CODE_COLOR[vals[5]]};
    cF.font=codeFont; cF.alignment=center;
    border(cF,'thin',bStyle,'thin','thin');
    const cG=row.getCell('G'); cG.font={name:FONT,size:12}; cG.alignment={horizontal:'center',vertical:'middle',wrapText:true};
    border(cG,'thin',bStyle,'thin','medium');
    row.height=30;
    return row;
  };

  const btn=document.getElementById('wrExportBtn');
  btn.disabled=true; btn.textContent='생성 중…';
  try{
    const wb=new ExcelJS.Workbook();
    const ws=wb.addWorksheet('점검 요청서');
    ws.columns=[{width:1.6},{width:5.6},{width:15.6},{width:8.6},{width:45.6},{width:10.6},{width:25.6}];

    const r0=ws.addRow([]); r0.height=10; // 최상단 여백

    const r1=ws.addRow(['','집진기 점검 요청서']);
    r1.getCell('B').font={name:FONT,bold:true,size:24};
    r1.getCell('B').alignment=center;
    r1.height=20;
    const r1b=ws.addRow([]); r1b.height=40;
    ws.mergeCells(`B${r1.number}:G${r1b.number}`);

    const r2=ws.addRow(['', `요청일 : ${weeklyDraft.asOfDate}\n요청자 : ${requester}`]);
    ws.mergeCells(`B${r2.number}:D${r2.number}`);
    const infoCell=r2.getCell('B');
    infoCell.font={name:FONT,bold:true,size:12};
    infoCell.alignment={horizontal:'left',vertical:'middle',wrapText:true};
    const legendCell=r2.getCell('E');
    legendCell.value='NO - 통신 오류 or 전원 꺼짐\nEM - 먼지 센서 오류\nPM - 먼지 농도 오류';
    legendCell.font={name:FONT,bold:true,size:11};
    legendCell.alignment={horizontal:'center',vertical:'middle',wrapText:true};
    legendCell.fill=HILITE;
    border(legendCell,'thin','thin','thin','thin');
    r2.height=50;

    const r3=ws.addRow(['', '점검   제품   목록', '', '', '', '점검 제품 합', items.length]);
    ws.mergeCells(`B${r3.number}:E${r3.number}`);
    const labelCell=r3.getCell('B');
    labelCell.font={name:FONT,bold:true,size:14}; labelCell.alignment=center;
    border(labelCell,'medium','thin','medium','thin');
    const sumLabelCell=r3.getCell('F');
    sumLabelCell.font={name:FONT,bold:true,size:10}; sumLabelCell.alignment=center;
    border(sumLabelCell,'medium','thin','thin','thin');
    const sumValCell=r3.getCell('G');
    sumValCell.font={name:FONT,bold:true,size:12}; sumValCell.alignment=center;
    border(sumValCell,'medium','thin','thin','medium');
    r3.height=30;

    const r4=ws.addRow(['', '순번','오류 발생 시점','제품 ID','설치 장소','오류 코드','비고']);
    ['B','C','D','E','F','G'].forEach(col=>{
      const c=r4.getCell(col);
      c.font={name:FONT,bold:true,size:12}; c.alignment=center;
      border(c,null,'thin', col==='B'?'medium':'thin', col==='G'?'medium':'thin');
    });
    r4.height=25;

    if(items.length){
      items.forEach((it,idx)=>{
        const row=dataRow(ws, ['', idx+1, it.since, it.id, wrLocText(it), it.code, (it.isNew?'[신규] ':'')+it.remark], idx===items.length-1);
        if(it.isNew){
          ['B','C','D','E','F','G'].forEach(col=>{ row.getCell(col).fill=HILITE; });
        }
      });
    } else {
      const row=ws.addRow(['','','','현재 문제 상태인 제품이 없습니다.']);
      ws.mergeCells(`B${row.number}:G${row.number}`);
      row.getCell('B').font={name:FONT,size:11}; row.getCell('B').alignment=center;
      border(row.getCell('B'),'thin','medium','medium','medium');
    }

    if(overdue.length){
      const spacer=ws.addRow([]); spacer.height=10;
      const rt=ws.addRow(['', `${weeklyDraft.asOfDate} 기준 한달 이상된 항목 리스트`]);
      ws.mergeCells(`B${rt.number}:G${rt.number}`);
      const titleCell=rt.getCell('B');
      titleCell.font={name:FONT,size:12}; titleCell.alignment=center;
      border(titleCell,'medium','medium','medium','medium');
      rt.height=30;

      overdue.forEach((it,idx)=>{
        dataRow(ws, ['', idx+1, it.since, it.id, wrLocText(it), it.code, it.remark], idx===overdue.length-1);
      });

      const rs=ws.addRow(['','','','','','한달 이상 합',overdue.length]);
      rs.getCell('F').font={name:FONT,bold:true,size:10}; rs.getCell('F').alignment=center;
      rs.getCell('G').font={name:FONT,bold:true,size:12}; rs.getCell('G').alignment=center;
    }

    const buf=await wb.xlsx.writeBuffer();
    const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url; a.download=`집진기_점검요청서_${weeklyDraft.asOfDate.replace(/-/g,'.')}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);

    const saveRes=await fetch(GAS_URL,{method:'POST',headers:{'Content-Type':'text/plain'},
      body:JSON.stringify({action:'saveWeeklyReport', date:weeklyDraft.asOfDate, requester, items:[...items,...overdue]})});
    const saveJson=await saveRes.json();
    if(saveJson.success){
      addLog(`주간 점검 요청서 생성 및 이력 저장 완료 (${saveJson.saved}건)`,'ok');
    } else {
      addLog('요청서는 다운로드됐지만 이력 저장에 실패했습니다: '+(saveJson.error||'오류'),'warn');
    }
    closeWeeklyReportModal();
  }catch(e){
    alert('요청서 생성 중 오류: '+e.message);
  }
  btn.disabled=false; btn.innerHTML='<span class="material-icons-round ico">file_download</span>다운로드 + 저장';
}

/* ===== 초기화 ===== */
(function init(){
  cleanOldDustCache();
  initDustMonthPicker();
  document.getElementById('footerVersion').textContent=APP_VERSION;
  document.getElementById('footerDate').textContent='Updated '+APP_DATE;
  setGlobalLock(false);
  const storedTheme=lsGet(LS_THEME,null);
  const systemPrefersDark=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;
  const savedTheme=storedTheme||(systemPrefersDark?'dark':'light');
  document.documentElement.setAttribute('data-theme',savedTheme);
  document.getElementById('themeIcon').textContent=savedTheme==='dark'?'light_mode':'dark_mode';

  const savedAuthLevel=lsGet(LS_ADMIN_AUTH,null);
  if(savedAuthLevel==='super'||savedAuthLevel==='admin'){
    adminAuthenticated=true;
    superAdminAuthenticated=(savedAuthLevel==='super');
    _applyAdminAuthedUI(savedAuthLevel);
  }

  productLocations=lsGet(LS_PROD_LOCS,{});

  // 단일 검색 기본 날짜+시간 (전일 00:00 ~ 금일 23:59)
  document.getElementById('singleStartDate').value=yesterdayStr()+'T00:00';
  document.getElementById('singleEndDate').value=todayStr()+'T23:59';

  extraIds=lsGet(LS_EXTRA,[]);
  dustExtraIds=lsGet(LS_DUST_EXTRA,[]);
  excludeReasons=lsGet(LS_EXCLUDE,{});
  renderDustExtraTags();
  const savedDomEnd=lsGet(LS_ENDID,'');
  if(savedDomEnd) document.getElementById('domEndId').value=savedDomEnd;
  const savedGlobalEnd=lsGet(LS_GLOBAL_ENDID,'');
  if(savedGlobalEnd) document.getElementById('globalEndId').value=savedGlobalEnd;
  renderExtraTags();
  renderExcludeTags();

  const savedMode=lsGet(LS_MODE,'range');
  switchMode(savedMode);

  const addRestrictedInput=(id)=>{
    const el=document.getElementById(id);
    el.addEventListener('keydown',e=>{if(e.key==='Enter'){startInspection();return;}restrictIdInput(e);});
    el.addEventListener('paste',e=>{
      e.preventDefault();
      const cleaned=(e.clipboardData||window.clipboardData).getData('text').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,4);
      el.value=cleaned;
    });
  };
  addRestrictedInput('domStartId');
  addRestrictedInput('domEndId');
  addRestrictedInput('globalStartId');
  addRestrictedInput('globalEndId');

  document.getElementById('extraIdInput').addEventListener('keydown',e=>{if(e.key==='Enter')addExtraId();});
  document.getElementById('dustExtraIdInput').addEventListener('keydown',e=>{if(e.key==='Enter')addDustExtraId();});
  document.getElementById('singleIdInput').addEventListener('keydown',e=>{if(e.key==='Enter')startInspection();});
  document.getElementById('dustZoneSearchInput')?.addEventListener('keydown',e=>{if(e.key==='Escape'){e.target.value='';filterDustZones();}});
  document.getElementById('adminPwInput').addEventListener('keydown',e=>{if(e.key==='Enter')authenticateAdmin();});
  document.getElementById('peNewId').addEventListener('keydown',e=>{if(e.key==='Enter')addProductToSheet();});
  document.getElementById('wrRequesterInput').addEventListener('keydown',e=>{if(e.key==='Enter')addRequester();});
  document.getElementById('historySearchInput').addEventListener('keydown',e=>{if(e.key==='Escape'){e.target.value='';filterHistoryGrid('');}});

  requesterList=lsGet(LS_REQUESTERS,[]);

  // 단일 검색 날짜 변경 시 dateInfo 업데이트
  document.getElementById('singleStartDate').addEventListener('change',updateDateInfo);
  document.getElementById('singleEndDate').addEventListener('change',updateDateInfo);

  // GAS 시트에서 영역/설치장소 로드 (캐시 사용)
  loadSheetData();

  // 모바일 먼지 모달 스와이프 닫기
  const modalBox=document.getElementById('dustModalBox');
  let swipeStartY=-1;
  modalBox.addEventListener('touchstart',e=>{
    if(e.target.closest('.dust-modal-body')){swipeStartY=-1;return;}
    swipeStartY=e.touches[0].clientY;
  },{passive:true});
  modalBox.addEventListener('touchmove',e=>{
    if(swipeStartY<0) return;
    const dy=Math.max(0,e.touches[0].clientY-swipeStartY);
    modalBox.style.transition='none';
    modalBox.style.transform=`translateY(${dy}px)`;
  },{passive:true});
  modalBox.addEventListener('touchend',e=>{
    if(swipeStartY<0) return;
    const dy=e.changedTouches[0].clientY-swipeStartY;
    modalBox.style.transition='transform 0.25s cubic-bezier(0.32,0.72,0,1)';
    if(dy>80){
      modalBox.style.transform='translateY(100%)';
      setTimeout(()=>{closeDustModal();modalBox.style.transform='';modalBox.style.transition='';},260);
    } else {
      modalBox.style.transform='';
      setTimeout(()=>{modalBox.style.transition='';},260);
    }
  });

  // 카드 상세 모달 스와이프 닫기
  const cardDetailBox=document.getElementById('cardDetailModalBox');
  let cdSwipeY=-1;
  cardDetailBox.addEventListener('touchstart',e=>{
    if(e.target.closest('.dust-modal-body')){cdSwipeY=-1;return;}
    cdSwipeY=e.touches[0].clientY;
  },{passive:true});
  cardDetailBox.addEventListener('touchmove',e=>{
    if(cdSwipeY<0) return;
    const dy=Math.max(0,e.touches[0].clientY-cdSwipeY);
    cardDetailBox.style.transition='none';
    cardDetailBox.style.transform=`translateY(${dy}px)`;
  },{passive:true});
  cardDetailBox.addEventListener('touchend',e=>{
    if(cdSwipeY<0) return;
    const dy=e.changedTouches[0].clientY-cdSwipeY;
    cardDetailBox.style.transition='transform 0.25s cubic-bezier(0.32,0.72,0,1)';
    if(dy>80){
      cardDetailBox.style.transform='translateY(100%)';
      setTimeout(()=>{closeCardDetailModal();cardDetailBox.style.transform='';cardDetailBox.style.transition='';},260);
    } else {
      cardDetailBox.style.transform='';
      setTimeout(()=>{cardDetailBox.style.transition='';},260);
    }
  });

  // 맨 위로 FAB 스크롤 감지
  const fab=document.getElementById('scrollTopFab');
  window.addEventListener('scroll',()=>{
    fab.style.display=window.scrollY>280?'flex':'none';
  },{passive:true});
})();

