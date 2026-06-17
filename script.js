/* ===== 버전 ===== */
const APP_VERSION = 'v1.63';
const APP_DATE    = '2026.06.17';

/* ===== 설정 ===== */
const ADMIN_PASSWORD       = 'airmax87';  /* 관리자 비밀번호 */
const SUPER_ADMIN_PASSWORD = 'wjdzn';    /* 슈퍼 관리자 비밀번호 */
const GAS_URL        = 'https://script.google.com/macros/s/AKfycbwlcEh7wNrxgMFHJoWx_JY0aHLPVC7BR8R4soEKbNdBE9tytIYqtyAHgdzkxb_02K5lBQ/exec';
const API      = 'https://api-airmax.testonic.co.kr/api/external/reports';
const LS_EXTRA        = 'airmax_extra_ids';
const LS_ENDID        = 'airmax_end_id';
const LS_GLOBAL_ENDID = 'airmax_global_end_id';
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
let adminAuthenticated      = false;
let superAdminAuthenticated = false;
let sheetZones      = [];   // [{name, ids[]}] — GAS 시트에서 로드
let productLocations    = {};   // {id: loc} — GAS 시트에서 로드
let productLocEditorOpen = false;
let peEditMode = false;
let peOriginals = {};

let results=[], currentFilter='ALL', currentView='grid', currentMode='range';
let logVisible=false, logs=[], extraIds=[], dustExtraIds=[];
let isGlobalLocked=false;
let selectedDustZones=new Set();
let lastResults = [];
let lastDateRange=null, cardDetailModalOpen=false;
let singleAllItems=[], singlePage=0, singleShowAll=false, singleChartDust=null, singleChartCo2=null;
let dustDays=[], dustModalChart=null, dustModalOpen=false;
const cardDetailCache=new Map();
let cardDetailChartDust=null, cardDetailChartCo2=null;
const dustResultMap=new Map();
const SINGLE_PAGE_SIZE=30;

const STATUS = {
  OK:   {label:'OK',  icon:'✓', cls:'card-ok',   textVar:'--ok-text',  chipBgVar:'--ok-chip-bg',  chipBdVar:'--ok-chip-border',  chipTxVar:'--ok-chip-text'  },
  NO:   {label:'NO',  icon:'✗', cls:'card-no',   textVar:'--no-text',  chipBgVar:'--no-chip-bg',  chipBdVar:'--no-chip-border',  chipTxVar:'--no-chip-text'  },
  EM:   {label:'EM',  icon:'⚡', cls:'card-em',   textVar:'--em-text',  chipBgVar:'--em-chip-bg',  chipBdVar:'--em-chip-border',  chipTxVar:'--em-chip-text'  },
  PM:   {label:'PM',  icon:'🔧', cls:'card-pm',   textVar:'--pm-text',  chipBgVar:'--pm-chip-bg',  chipBdVar:'--pm-chip-border',  chipTxVar:'--pm-chip-text'  },
  ERR:  {label:'ERR', icon:'⚠', cls:'card-err',  textVar:'--err-text', chipBgVar:'--err-chip-bg', chipBdVar:'--err-chip-border', chipTxVar:'--err-chip-text' },
  LOAD: {label:'···', icon:'',  cls:'card-load', textVar:'--text4',    chipBgVar:'--input-bg',    chipBdVar:'--border',          chipTxVar:'--text4'         },
};

/* ===== 유틸 ===== */
function lsGet(k,d){try{const v=localStorage.getItem(k);return v!==null?JSON.parse(v):d;}catch{return d;}}
function lsSet(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch{}}
function escHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}


function renderSummaryDonut(counts){
  const el=document.getElementById('summaryDonut');
  if(!el) return;
  const order=['OK','NO','EM','PM','ERR'];
  const hexColors={OK:'#22c55e',NO:'#9ca3af',EM:'#3b82f6',PM:'#f43f5e',ERR:'#f59e0b'};
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
  document.getElementById('themeIcon').textContent=next==='dark'?'☀️':'🌙';
  if(singleAllItems.length){
    const start=singlePage*SINGLE_PAGE_SIZE;
    renderSingleChart([...singleAllItems.slice(start,start+SINGLE_PAGE_SIZE)].reverse());
  }
  if(dustModalOpen && dustDays.length) renderDustChart(dustDays, next==='dark', 'dustModalCanvas');
}

/* ===== 관리자 인증 ===== */
function authenticateAdmin(){
  const pw=document.getElementById('adminPwInput').value;
  const badge=document.getElementById('adminAuthBadge');
  const inp=document.getElementById('adminPwInput');

  if(pw===SUPER_ADMIN_PASSWORD){
    adminAuthenticated=true;
    superAdminAuthenticated=true;
    badge.textContent='✓ 슈퍼 관리자'; badge.className='admin-auth-badge super';
    inp.value=''; inp.disabled=true;
    document.getElementById('deauthBtn').style.display='inline-block';
    document.getElementById('adminActionsRow').style.display='flex';
    _applyDustAuthUI();
    updateRunBtnText(); updateSheetBtn();
  } else if(pw===ADMIN_PASSWORD){
    adminAuthenticated=true;
    superAdminAuthenticated=false;
    badge.textContent='✓ 일반 관리자'; badge.className='admin-auth-badge ok';
    inp.value=''; inp.disabled=true;
    document.getElementById('deauthBtn').style.display='inline-block';
    document.getElementById('adminActionsRow').style.display='flex';
    _applyDustAuthUI();
    updateRunBtnText(); updateSheetBtn();
  } else {
    badge.textContent='✗ 비밀번호 오류'; badge.className='admin-auth-badge fail';
    setTimeout(()=>{ badge.textContent=''; badge.className='admin-auth-badge'; },2500);
  }
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
  const badge=document.getElementById('adminAuthBadge');
  badge.textContent=''; badge.className='admin-auth-badge';
  document.getElementById('adminPwInput').disabled=false;
  document.getElementById('deauthBtn').style.display='none';
  document.getElementById('adminActionsRow').style.display='none';
  document.getElementById('productEditorSection').style.display='none';
  productLocEditorOpen=false;
  _applyDustAuthUI();
  updateRunBtnText(); updateSheetBtn();
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
  const label=(adminAuthenticated && currentMode==='range')?'점검 및 시트 저장':'점검 시작';
  btn.textContent=label;
  mBtn.textContent=label;
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
      body:JSON.stringify({results:lastResults, savedAt:new Date().toISOString()})
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
        lsSet(LS_SHEET_CACHE,{ts:now,zones:sheetZones,locations:json.locations||{}});
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
  // range: 2일 전 ~ 오늘
  const d=new Date(); d.setDate(d.getDate()-2);
  return{started_at:fmtDate(d), finished_at:today};
}

function updateDateInfo(){
  const dr=getDateRange(currentMode);
  document.getElementById('dateInfo').textContent=`조회 기간  ${dr.started_at} ~ ${dr.finished_at}`;
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

function _renderZoneGrid(gridId,noResultId,searchId,selSet,toggleFn,isOpen,openFn,afterFn){
  const gridEl=document.getElementById(gridId); if(!gridEl) return;
  const q=(document.getElementById(searchId)?.value||'').trim().toLowerCase();
  gridEl.innerHTML=sheetZones.map((z,i)=>{
    const sel=selSet.has(i);
    const rangeText=z.ids.length===1?z.ids[0]:`${z.ids[0]}~${z.ids[z.ids.length-1]} (${z.ids.length}개)`;
    const hidden=q&&!z.name.toLowerCase().includes(q)?'hidden':'';
    return`<button class="zone-btn ${sel?'selected':''} ${hidden}" onclick="${toggleFn}(${i})">
      <span class="zone-name">${escHtml(z.name)}</span>
      <span class="zone-range">${rangeText}</span>
    </button>`;
  }).join('');
  const noRes=document.getElementById(noResultId);
  const allHidden=!gridEl.querySelector('.zone-btn:not(.hidden)');
  if(noRes) noRes.style.display=allHidden?'block':'none';
  if(q&&!isOpen) openFn();
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
  _renderZoneGrid('zoneGrid','zoneNoResult','zoneSearchInput',selectedZones,'toggleZone',zoneGridOpen,toggleZoneGrid,updateZoneCount);
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
  if(btn){ btn.disabled=true; btn.textContent='⏳ 불러오는 중…'; }
  addLog('시트 데이터 새로고침 중…','muted');
  loadSheetData(true).finally(()=>{
    if(btn){ btn.disabled=false; btn.textContent='🔄 영역 새로고침'; }
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
function classify(item,nowMs){
  if(!item)return'NO';
  const d=parseFormatTime(item.format_created_time);
  if(!d)return'NO';
  if((nowMs-d.getTime())/3600000>=2)return'NO';
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
function setLoading(on,done=0,total=0){
  document.getElementById('loadingOverlay').classList.toggle('active',on);
  if(on){
    document.getElementById('loadingBar').style.width=(total>0?Math.round(done/total*100):0)+'%';
    document.getElementById('loadingText').textContent=total>0?`데이터 수집 중… ${done} / ${total}`:'데이터 수집 중…';
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
    document.getElementById('grid').innerHTML=`<div class="empty-inline"><span class="empty-inline-icon">🔍</span><span>${msg}</span></div>`;
    return;
  }
  document.getElementById('grid').innerHTML=filtered.map(r=>{
    const cfg=STATUS[r.status]||STATUS.LOAD;
    const loc=productLocations[r.id]||'';
    const tip=r.errMsg?escHtml(r.errMsg):r.item
      ?`PM10: ${r.item.pm_10}㎍/㎥<br>PM2.5: ${r.item.pm_2_5}㎍/㎥<br>CO₂: ${r.item.co2}ppm<br>수집: ${escHtml(r.item.format_created_time)}`
      :'데이터 없음';
    return`<div class="card ${cfg.cls}" data-id="${escHtml(r.id)}" onclick="openCardDetailModal('${escHtml(r.id)}')">
      <div class="card-status" style="color:var(${cfg.textVar})"><span class="card-icon">${cfg.icon}</span>${cfg.label}</div>
      <div class="card-id">${escHtml(r.id)}</div>
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
  document.getElementById('peEditModeBtn').textContent=peEditMode?'👁 보기 모드':'✏️ 전체 편집';
  document.getElementById('peBulkBar').style.display=peEditMode?'flex':'none';
  renderProductEditor();
}

function exitEditMode(){
  peEditMode=false;
  document.getElementById('peEditModeBtn').textContent='✏️ 전체 편집';
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
  if(saveBtn){ saveBtn.disabled=false; saveBtn.textContent='💾 일괄 저장'; }
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
  lsSet(LS_SHEET_CACHE,{ts:Date.now(),zones:sheetZones,locations:productLocations});
}

function updateGridCard(r){
  const cfg=STATUS[r.status]||STATUS.LOAD;
  const loc=productLocations[r.id]||'';
  const tip=r.errMsg?escHtml(r.errMsg):r.item
    ?`PM10: ${r.item.pm_10}㎍/㎥<br>PM2.5: ${r.item.pm_2_5}㎍/㎥<br>CO₂: ${r.item.co2}ppm<br>수집: ${escHtml(r.item.format_created_time)}`
    :'데이터 없음';
  const el=document.querySelector(`#grid .card[data-id="${CSS.escape(r.id)}"]`);
  if(!el) return;
  el.className=`card ${cfg.cls} card-updated`;
  el.innerHTML=`
    <div class="card-status" style="color:var(${cfg.textVar})"><span class="card-icon">${cfg.icon}</span>${cfg.label}</div>
    <div class="card-id">${escHtml(r.id)}</div>
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
      <div class="list-status-cell" style="color:var(${cfg.textVar})">${cfg.icon} ${cfg.label}</div>
      <div class="list-time-cell">${escHtml(time||'—')}</div>
    </div>`;
  }).join('');
}
function copyListToClipboard(){
  const sel=document.getElementById('listFilterSel').value;
  const filtered=filterByListSel(sel);
  navigator.clipboard.writeText(filtered.map(r=>`${r.id}\t${r.status}`).join('\n')).then(()=>{
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
  const m=str.match(/\d{4}[.\-](\d{2})[.\-](\d{2})\s+(\d{2}:\d{2})/);
  return m?`${m[1]}.${m[2]} ${m[3]}`:str.slice(5,16);
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
  const days=[...dayMap.entries()].map(([date,ps])=>{
    let inc=0;
    for(let i=1;i<ps.length;i++){
      const diff=ps[i].grams-ps[i-1].grams;
      if(diff>0) inc+=diff;
    }
    return{date,count:ps.length,first:ps[0].grams,last:ps[ps.length-1].grams,inc};
  });

  return{total,days,scanCount:sorted.length};
}

function renderDustChart(days,isDark,canvasId){
  if(dustModalChart){dustModalChart.destroy();dustModalChart=null;}
  const canvas=document.getElementById(canvasId||'dustModalCanvas');
  if(!canvas||!days.length) return;
  const grid=isDark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.07)';
  const tick=isDark?'#999':'#888';
  dustModalChart=new Chart(canvas,{
    type:'bar',
    data:{
      labels:days.map(d=>d.date.slice(5)),
      datasets:[{
        label:'회별 포집량 (g)',
        data:days.map(d=>d.inc),
        backgroundColor:isDark?'rgba(78,142,247,0.65)':'rgba(78,142,247,0.55)',
        borderColor:'#4e8ef7',borderWidth:1,borderRadius:4,
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
          backgroundColor:isDark?'#1e1e1e':'#fff',
          titleColor:isDark?'#ddd':'#222',bodyColor:isDark?'#ccc':'#444',
          borderColor:isDark?'#444':'#ddd',borderWidth:1,padding:10,
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
  _renderZoneGrid('dustZonePickerGrid','dustZoneNoResult','dustZoneSearchInput',selectedDustZones,'toggleDustZone',dustZoneGridOpen,toggleDustZoneGrid,updateDustZoneInfo);
}
function toggleDustZone(i){ _toggleZoneItem(selectedDustZones,i,renderDustZoneGrid); }
function filterDustZones(){ renderDustZoneGrid(); }
function selectAllDustZones(){ sheetZones.forEach((_,i)=>selectedDustZones.add(i)); renderDustZoneGrid(); }
function clearAllDustZones(){ selectedDustZones.clear(); renderDustZoneGrid(); }
function updateDustZoneInfo(){
  _updateZoneInfo(selectedDustZones,document.getElementById('dustZoneSelectInfo'),(c,t)=>`${c}개 영역 · ${t}개 제품`);
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

  const dateRange={started_at:'2026-04-01',finished_at:todayStr()};
  const resultSection=document.getElementById('dustResultSection');
  const progressEl=document.getElementById('dustProgressRow');
  const gridEl=document.getElementById('dustCardsGrid');
  dustResultMap.clear();
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
      const rawItems=await fetchAllReports(id,dateRange,token,()=>{});
      const items=rawItems.filter(it=>{
        const t=(it.report_data?.readTime||it.format_created_time||'').slice(0,10);
        return t>=dateRange.started_at;
      });
      const{total,days}=calcDust(items);
      const activeDays=days.filter(d=>d.inc>0);
      if(!card) return;
      if(!activeDays.length){
        card.className='dust-card empty';
        card.innerHTML=`<div class="dust-card-id">${escHtml(id)}</div>${loc}
          <div class="dust-card-meta" style="color:var(--text4);margin-top:4px">포집 데이터 없음</div>`;
      } else {
        dustResultMap.set(id,items);
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
  setTimeout(()=>{
    const el=document.getElementById('dustResultSection');
    if(el&&el.offsetParent!==null) el.scrollIntoView({behavior:'smooth',block:'start'});
  },150);
}

function openDustModal(id){
  const items=dustResultMap.get(id);
  if(!items) return;
  const{total,days,scanCount}=calcDust(items);
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
      <td style="font-weight:700;color:var(--ok-text)">+${d.inc.toLocaleString()}</td>
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
  document.getElementById('cardDetailSummary').innerHTML=cfg?`
    <div class="dust-stat">
      <span class="dust-stat-label">최근 상태</span>
      <span class="dust-stat-value" style="font-size:18px;color:var(${cfg.textVar})">${cfg.icon} ${cfg.label}</span>
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
function _renderCardDetailContent(sorted){
  const loadEl=document.getElementById('cardDetailLoading');
  const tableWrap=document.getElementById('cardDetailTableWrap');
  loadEl.style.display='none';
  tableWrap.style.display='block';
  document.getElementById('cardDetailCount').textContent=`총 ${sorted.length}건`;
  document.getElementById('cardDetailBody').innerHTML=sorted.length
    ?sorted.map(item=>`<tr>
        <td>${escHtml(item.format_created_time||'—')}</td>
        <td>${item.pm_10??'—'}㎍/㎥</td>
        <td>${item.pm_2_5??'—'}㎍/㎥</td>
        <td>${item.co2??'—'}ppm</td>
      </tr>`).join('')
    :'<tr><td colspan="4" class="single-detail-empty" style="text-align:center">조회된 데이터가 없습니다</td></tr>';
  _renderCardDetailChart([...sorted].reverse());
}
function _renderCardDetailChart(items){
  if(cardDetailChartDust){cardDetailChartDust.destroy();cardDetailChartDust=null;}
  if(cardDetailChartCo2){cardDetailChartCo2.destroy();cardDetailChartCo2=null;}
  if(!items.length) return;
  const isDark=document.documentElement.getAttribute('data-theme')==='dark';
  const gridColor=isDark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.07)';
  const tickColor=isDark?'#999':'#888';
  const labels=items.map(d=>fmtTime(d.format_created_time));
  const pt=items.length>15?2:4;
  const makeOpts=(showLegend)=>({
    responsive:true, maintainAspectRatio:false,
    interaction:{mode:'index',intersect:false},
    plugins:{
      legend:{display:showLegend,labels:{color:isDark?'#ccc':'#444',font:{size:10},boxWidth:10,padding:10}},
      tooltip:{backgroundColor:isDark?'#1e1e1e':'#fff',titleColor:isDark?'#ddd':'#222',
        bodyColor:isDark?'#ccc':'#444',borderColor:isDark?'#444':'#ddd',borderWidth:1,padding:8}
    },
    scales:{
      x:{ticks:{color:tickColor,font:{size:9},maxRotation:45,autoSkip:true,maxTicksLimit:8},grid:{color:gridColor}},
      y:{ticks:{color:tickColor,font:{size:9},callback:v=>Number.isInteger(v)?v:null},grid:{color:gridColor},beginAtZero:true,min:0}
    }
  });
  requestAnimationFrame(()=>setTimeout(()=>{
    const c1=document.getElementById('cardDetailChartDust');
    if(c1) cardDetailChartDust=new Chart(c1,{type:'line',data:{labels,datasets:[
      {label:'PM10 (㎍/㎥)',data:items.map(d=>d.pm_10!==undefined?Number(d.pm_10):null),
       borderColor:'#4e8ef7',backgroundColor:'rgba(78,142,247,0.08)',
       fill:false,tension:0.35,pointRadius:pt,pointHoverRadius:6,borderWidth:2,spanGaps:false},
      {label:'PM2.5 (㎍/㎥)',data:items.map(d=>d.pm_2_5!==undefined?Number(d.pm_2_5):null),
       borderColor:'#4ecf8e',backgroundColor:'rgba(78,207,142,0.08)',
       fill:false,tension:0.35,pointRadius:pt,pointHoverRadius:6,borderWidth:2,spanGaps:false},
    ]},options:makeOpts(true)});
    const c2=document.getElementById('cardDetailChartCo2');
    if(c2) cardDetailChartCo2=new Chart(c2,{type:'line',data:{labels,datasets:[
      {label:'CO₂ (ppm)',data:items.map(d=>d.co2!==undefined?Number(d.co2):null),
       borderColor:'#f7a14e',backgroundColor:'rgba(247,161,78,0.12)',
       fill:true,tension:0.35,pointRadius:pt,pointHoverRadius:6,borderWidth:2,spanGaps:false},
    ]},options:makeOpts(false)});
  },50));
}
function closeCardDetailModal(){
  cardDetailModalOpen=false;
  document.getElementById('cardDetailModal').style.display='none';
  document.body.style.overflow='';
  if(cardDetailChartDust){cardDetailChartDust.destroy();cardDetailChartDust=null;}
  if(cardDetailChartCo2){cardDetailChartCo2.destroy();cardDetailChartCo2=null;}
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
    btn.textContent='✓ 복사됨';
    setTimeout(()=>{ btn.textContent='📋 전체 복사'; }, 2000);
  }).catch(()=>{ alert('클립보드 복사에 실패했습니다.'); });
}

function renderSingleChart(items){
  if(singleChartDust){ singleChartDust.destroy(); singleChartDust=null; }
  if(singleChartCo2){ singleChartCo2.destroy(); singleChartCo2=null; }
  if(!items.length) return;

  const isDark=document.documentElement.getAttribute('data-theme')==='dark';
  const gridColor=isDark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.07)';
  const tickColor=isDark?'#999':'#888';
  const labels=items.map(d=>fmtTime(d.format_created_time));
  const pt=items.length>15?2:4;

  const makeOpts=(showLegend)=>({
    responsive:true, maintainAspectRatio:false,
    interaction:{mode:'index',intersect:false},
    plugins:{
      legend:{
        display:showLegend,
        labels:{color:isDark?'#ccc':'#444',font:{size:11},boxWidth:12,padding:14}
      },
      tooltip:{
        backgroundColor:isDark?'#1e1e1e':'#fff',
        titleColor:isDark?'#ddd':'#222',
        bodyColor:isDark?'#ccc':'#444',
        borderColor:isDark?'#444':'#ddd',
        borderWidth:1, padding:10,
      }
    },
    scales:{
      x:{ticks:{color:tickColor,font:{size:10},maxRotation:45,autoSkip:true,maxTicksLimit:10},grid:{color:gridColor}},
      y:{ticks:{color:tickColor,font:{size:10},callback:v=>Number.isInteger(v)?v:null},grid:{color:gridColor},beginAtZero:true,min:0}
    }
  });

  const canvasDust=document.getElementById('singleChartDust');
  if(canvasDust){
    singleChartDust=new Chart(canvasDust,{type:'line', data:{labels, datasets:[
      {label:'PM10 (㎍/㎥)', data:items.map(d=>d.pm_10!==undefined?Number(d.pm_10):null),
       borderColor:'#4e8ef7', backgroundColor:'rgba(78,142,247,0.08)',
       fill:false, tension:0.35, pointRadius:pt, pointHoverRadius:6, borderWidth:2, spanGaps:false},
      {label:'PM2.5 (㎍/㎥)', data:items.map(d=>d.pm_2_5!==undefined?Number(d.pm_2_5):null),
       borderColor:'#4ecf8e', backgroundColor:'rgba(78,207,142,0.08)',
       fill:false, tension:0.35, pointRadius:pt, pointHoverRadius:6, borderWidth:2, spanGaps:false},
    ]}, options:makeOpts(true)});
  }

  const canvasCo2=document.getElementById('singleChartCo2');
  if(canvasCo2){
    singleChartCo2=new Chart(canvasCo2,{type:'line', data:{labels, datasets:[
      {label:'CO₂ (ppm)', data:items.map(d=>d.co2!==undefined?Number(d.co2):null),
       borderColor:'#f7a14e', backgroundColor:'rgba(247,161,78,0.12)',
       fill:true, tension:0.35, pointRadius:pt, pointHoverRadius:6, borderWidth:2, spanGaps:false},
    ]}, options:makeOpts(false)});
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
      const status=id==='A139'?'OK':classify(item,nowMs);
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
  addLog('✓ 점검 완료','ok');
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
    const endMs=endVal?new Date(endVal).getTime():null;
    if(startMs&&endMs&&startMs>=endMs){errEl.textContent='⚠ 종료 시간이 시작 시간보다 뒤여야 합니다.';return;}
    const dateRange=getDateRange('single');
    setGlobalLock(true);
    setLoading(true);
    document.getElementById('loadingText').textContent='데이터 수집 중…';
    try{
      const allItems=await fetchAllReports(raw,dateRange,token,(pg,last)=>{
        document.getElementById('loadingText').textContent=
          last>1?`데이터 수집 중… (${pg}/${last} 페이지)`:'데이터 수집 중…';
      });
      // API는 날짜 단위로만 필터링되므로 시간 범위는 클라이언트에서 처리
      const items=allItems.filter(item=>{
        const d=parseFormatTime(item.format_created_time);
        if(!d) return false;
        if(startMs&&d.getTime()<startMs) return false;
        if(endMs&&d.getTime()>endMs) return false;
        return true;
      });
      addLog(`단일 검색 완료 — 수집 ${allItems.length}건 / 시간 필터 후 ${items.length}건`,'ok');
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

/* ===== 초기화 ===== */
(function init(){
  document.getElementById('footerVersion').textContent=APP_VERSION;
  document.getElementById('footerDate').textContent='Updated '+APP_DATE;
  setGlobalLock(false);
  const savedTheme=lsGet(LS_THEME,'light');
  document.documentElement.setAttribute('data-theme',savedTheme);
  document.getElementById('themeIcon').textContent=savedTheme==='dark'?'☀️':'🌙';

  productLocations=lsGet(LS_PROD_LOCS,{});

  // 단일 검색 기본 날짜+시간 (전일 00:00 ~ 금일 23:59)
  document.getElementById('singleStartDate').value=yesterdayStr()+'T00:00';
  document.getElementById('singleEndDate').value=todayStr()+'T23:59';

  extraIds=lsGet(LS_EXTRA,[]);
  dustExtraIds=lsGet(LS_DUST_EXTRA,[]);
  renderDustExtraTags();
  const savedDomEnd=lsGet(LS_ENDID,'');
  if(savedDomEnd) document.getElementById('domEndId').value=savedDomEnd;
  const savedGlobalEnd=lsGet(LS_GLOBAL_ENDID,'');
  if(savedGlobalEnd) document.getElementById('globalEndId').value=savedGlobalEnd;
  renderExtraTags();

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

  // 단일 검색 날짜 변경 시 dateInfo 업데이트
  document.getElementById('singleStartDate').addEventListener('change',updateDateInfo);
  document.getElementById('singleEndDate').addEventListener('change',updateDateInfo);

  // GAS 시트에서 영역/설치장소 로드 (캐시 사용)
  loadSheetData();

  // 모바일 먼지 모달 스와이프 닫기
  const modalBox=document.getElementById('dustModalBox');
  let swipeStartY=0;
  modalBox.addEventListener('touchstart',e=>{
    if(e.target.closest('.dust-modal-body')) return;
    swipeStartY=e.touches[0].clientY;
  },{passive:true});
  modalBox.addEventListener('touchmove',e=>{
    if(e.target.closest('.dust-modal-body')) return;
    const dy=Math.max(0,e.touches[0].clientY-swipeStartY);
    modalBox.style.transition='none';
    modalBox.style.transform=`translateY(${dy}px)`;
  },{passive:true});
  modalBox.addEventListener('touchend',e=>{
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
  let cdSwipeY=0;
  cardDetailBox.addEventListener('touchstart',e=>{
    if(e.target.closest('.dust-modal-body')) return;
    cdSwipeY=e.touches[0].clientY;
  },{passive:true});
  cardDetailBox.addEventListener('touchmove',e=>{
    if(e.target.closest('.dust-modal-body')) return;
    const dy=Math.max(0,e.touches[0].clientY-cdSwipeY);
    cardDetailBox.style.transition='none';
    cardDetailBox.style.transform=`translateY(${dy}px)`;
  },{passive:true});
  cardDetailBox.addEventListener('touchend',e=>{
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

