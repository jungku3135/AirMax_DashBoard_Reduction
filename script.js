/* ===== 설정 ===== */
const ADMIN_PASSWORD = 'airmax87'; /* 관리자 비밀번호 */
const GAS_URL        = 'https://script.google.com/macros/s/AKfycbwlcEh7wNrxgMFHJoWx_JY0aHLPVC7BR8R4soEKbNdBE9tytIYqtyAHgdzkxb_02K5lBQ/exec';
const API      = 'https://api-airmax.testonic.co.kr/api/external/reports';
const LS_EXTRA = 'airmax_extra_ids';
const LS_ENDID = 'airmax_end_id';
const LS_THEME = 'airmax_theme';
const LS_MODE  = 'airmax_mode';
const LS_PROD_LOCS    = 'airmax_product_locations';
const LS_SHEET_CACHE  = 'airmax_sheet_cache';
const CACHE_TTL       = 3600000; // 1시간 (ms)


/* ===== 상태 ===== */
let selectedZones   = new Set();
let zoneGridOpen    = false;
let adminAuthenticated = false;
let sheetZones      = [];   // [{name, ids[]}] — GAS 시트에서 로드
let productLocations    = {};   // {id: loc} — GAS 시트에서 로드
let productLocEditorOpen = false;
let peEditMode = false;
let peOriginals = {};

let results=[], currentFilter='ALL', currentView='grid', currentMode='range';
let logVisible=false, logs=[], extraIds=[];
let lastResults = [];
let singleAllItems=[], singlePage=0, singleChartDust=null, singleChartCo2=null;
const SINGLE_PAGE_SIZE=30;

const STATUS = {
  OK:   {label:'OK',  cls:'card-ok',   textVar:'--ok-text',  chipBgVar:'--ok-chip-bg',  chipBdVar:'--ok-chip-border',  chipTxVar:'--ok-chip-text'  },
  NO:   {label:'NO',  cls:'card-no',   textVar:'--no-text',  chipBgVar:'--no-chip-bg',  chipBdVar:'--no-chip-border',  chipTxVar:'--no-chip-text'  },
  EM:   {label:'EM',  cls:'card-em',   textVar:'--em-text',  chipBgVar:'--em-chip-bg',  chipBdVar:'--em-chip-border',  chipTxVar:'--em-chip-text'  },
  PM:   {label:'PM',  cls:'card-pm',   textVar:'--pm-text',  chipBgVar:'--pm-chip-bg',  chipBdVar:'--pm-chip-border',  chipTxVar:'--pm-chip-text'  },
  ERR:  {label:'ERR', cls:'card-err',  textVar:'--err-text', chipBgVar:'--err-chip-bg', chipBdVar:'--err-chip-border', chipTxVar:'--err-chip-text' },
  LOAD: {label:'···', cls:'card-load', textVar:'--text4',    chipBgVar:'--input-bg',    chipBdVar:'--border',          chipTxVar:'--text4'         },
};

/* ===== 유틸 ===== */
function lsGet(k,d){try{const v=localStorage.getItem(k);return v!==null?JSON.parse(v):d;}catch{return d;}}
function lsSet(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch{}}
function escHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

function getAllZones(){
  return sheetZones;
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
}

/* ===== 관리자 인증 ===== */
function authenticateAdmin(){
  const pw=document.getElementById('adminPwInput').value;
  const badge=document.getElementById('adminAuthBadge');
  if(pw===ADMIN_PASSWORD){
    adminAuthenticated=true;
    badge.textContent='✓ 인증됨'; badge.className='admin-auth-badge ok';
    document.getElementById('adminPwInput').value='';
    document.getElementById('adminPwInput').disabled=true;
    document.getElementById('deauthBtn').style.display='inline-block';
    updateRunBtnText();
    document.getElementById('adminActionsRow').style.display='flex';
    updateSheetBtn();
  } else {
    badge.textContent='✗ 비밀번호 오류'; badge.className='admin-auth-badge fail';
    setTimeout(()=>{badge.className='admin-auth-badge';},2500);
  }
}

function deauthAdmin(){
  adminAuthenticated=false;
  const badge=document.getElementById('adminAuthBadge');
  badge.className='admin-auth-badge';
  document.getElementById('adminPwInput').disabled=false;
  document.getElementById('deauthBtn').style.display='none';
  document.getElementById('adminActionsRow').style.display='none';
  document.getElementById('productEditorSection').style.display='none';
  productLocEditorOpen=false;
  updateRunBtnText();
  updateSheetBtn();
}

function updateRunBtnText(){
  const btn=document.getElementById('runBtn');
  const mBtn=document.getElementById('mobileRunBtn');
  if(currentMode==='dust'){
    btn.style.display='none';
    mBtn.style.display='none';
    return;
  }
  btn.style.display='';
  mBtn.style.display='';
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
function todayStr(){
  const d=new Date();
  return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function yesterdayStr(){
  const d=new Date(); d.setDate(d.getDate()-1);
  return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

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
  const fmt=x=>`${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
  return{started_at:fmt(d), finished_at:today};
}

function updateDateInfo(){
  const dr=getDateRange(currentMode);
  document.getElementById('dateInfo').textContent=`조회 기간  ${dr.started_at} ~ ${dr.finished_at}`;
}

/* ===== 모드 전환 ===== */
function switchMode(mode){
  currentMode=mode; lsSet(LS_MODE,mode);
  ['range','single','zone','dust'].forEach(m=>{
    document.getElementById('tab'+m.charAt(0).toUpperCase()+m.slice(1)).classList.toggle('active',m===mode);
    document.getElementById('panel'+m.charAt(0).toUpperCase()+m.slice(1)).style.display=m===mode?'block':'none';
  });
  if(mode==='zone') renderZoneGrid();
  updateMobileFixedBtn();
  updateRunBtnText();
  updateSheetBtn();
  if(mode==='dust') document.getElementById('dateInfo').textContent='';
  else updateDateInfo();
  if(mode!=='single'){
    document.getElementById('singleResultSection').style.display='none';
  }
  if(mode==='single'||mode==='dust'){
    document.getElementById('summary').style.display='none';
    document.getElementById('grid').style.display='none';
    document.getElementById('listView').style.display='none';
    document.getElementById('listToolbar').style.display='none';
  }
}

/* ===== 모바일 고정 버튼 ===== */
function updateMobileFixedBtn(){
  document.body.classList.toggle('zone-active', currentMode==='zone');
  updateMobileZoneInfo();
}

function updateMobileZoneInfo(){
  const infoEl=document.getElementById('mobileZoneInfo');
  const cnt=selectedZones.size;
  if(cnt===0){ infoEl.textContent='영역을 선택하세요'; return; }
  const ZONES=getAllZones();
  const total=[...selectedZones].reduce((s,i)=>s+(ZONES[i]?ZONES[i].ids.length:0),0);
  infoEl.textContent=`${cnt}개 영역 · ${total}개 제품`;
}

/* ===== 영역 그리드 접기/펼치기 ===== */
function toggleZoneGrid(){
  zoneGridOpen=!zoneGridOpen;
  const wrap=document.getElementById('zoneGridWrap');
  const arrow=document.getElementById('zoneArrow');
  const btn=document.getElementById('zoneToggleBtn');
  wrap.classList.toggle('open',zoneGridOpen);
  arrow.classList.toggle('open',zoneGridOpen);
  btn.querySelector('span').textContent=zoneGridOpen?'접기':'펼치기';
}

function filterZones(query){
  if(query && !zoneGridOpen) toggleZoneGrid();
  const q=query.trim().toLowerCase();
  let visible=0;
  document.querySelectorAll('.zone-btn').forEach(btn=>{
    const name=btn.querySelector('.zone-name').textContent.toLowerCase();
    const match=!q||name.includes(q);
    btn.classList.toggle('hidden',!match);
    if(match) visible++;
  });
  document.getElementById('zoneNoResult').style.display=visible===0?'block':'none';
}

function renderZoneGrid(){
  const ZONES=getAllZones();
  const q=document.getElementById('zoneSearchInput').value.trim().toLowerCase();
  document.getElementById('zoneGrid').innerHTML=ZONES.map((z,i)=>{
    const sel=selectedZones.has(i);
    const rangeText=z.ids.length===1?z.ids[0]:`${z.ids[0]}~${z.ids[z.ids.length-1]} (${z.ids.length}개)`;
    const hidden=q&&!z.name.toLowerCase().includes(q)?'hidden':'';
    return`<button class="zone-btn ${sel?'selected':''} ${hidden}" onclick="toggleZone(${i})">
      <span class="zone-name">${escHtml(z.name)}</span>
      <span class="zone-range">${rangeText}</span>
    </button>`;
  }).join('');
  updateZoneCount();
  if(q&&!zoneGridOpen) toggleZoneGrid();
  const allHidden=document.querySelectorAll('.zone-btn:not(.hidden)').length===0;
  document.getElementById('zoneNoResult').style.display=allHidden?'block':'none';
}

function updateZoneCount(){
  const ZONES=getAllZones();
  const cnt=selectedZones.size;
  const total=[...selectedZones].reduce((s,i)=>s+(ZONES[i]?ZONES[i].ids.length:0),0);
  document.getElementById('zoneSelectCount').textContent=
    cnt===0?'선택된 영역 없음':`${cnt}개 영역 / 총 ${total}개 제품 선택됨`;
  updateMobileZoneInfo();
}

function toggleZone(i){
  if(selectedZones.has(i)) selectedZones.delete(i);
  else selectedZones.add(i);
  renderZoneGrid();
}

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

/* ===== 추가 ID ===== */
function addExtraId(){
  const inp=document.getElementById('extraIdInput');
  inp.value.trim().split(',').map(v=>v.trim()).filter(Boolean).forEach(v=>{
    if(!extraIds.includes(v)) extraIds.push(v);
  });
  inp.value=''; lsSet(LS_EXTRA,extraIds); renderExtraTags();
}
function removeExtraId(id){
  extraIds=extraIds.filter(v=>v!==id); lsSet(LS_EXTRA,extraIds); renderExtraTags();
}
function renderExtraTags(){
  document.getElementById('extraTagsRow').innerHTML=extraIds.length===0
    ?'<span style="color:var(--text4);font-size:12px">추가된 ID 없음</span>'
    :extraIds.map(id=>`<span class="extra-id-tag">${escHtml(id)}<button onclick="removeExtraId('${escHtml(id)}')" title="삭제">×</button></span>`).join('');
}

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
  const viewHtml=`<div class="summary-right"><div class="view-tabs">
    <button class="view-tab ${currentView==='grid'?'active':''}" onclick="switchView('grid')">그리드</button>
    <button class="view-tab ${currentView==='list'?'active':''}" onclick="switchView('list')">리스트</button>
  </div></div>`;
  document.getElementById('summary').innerHTML=chipsHtml+viewHtml;
}

/* ===== Grid / List ===== */
function renderGrid(){
  const filtered=currentFilter==='ALL'?results:results.filter(r=>r.status===currentFilter);
  document.getElementById('grid').innerHTML=filtered.map(r=>{
    const cfg=STATUS[r.status]||STATUS.LOAD;
    const loc=productLocations[r.id]||'';
    const tip=r.errMsg?escHtml(r.errMsg):r.item
      ?`PM10: ${r.item.pm_10}㎍/㎥ | PM2.5: ${r.item.pm_2_5}㎍/㎥ | CO2: ${r.item.co2}ppm<br>수집: ${escHtml(r.item.format_created_time)}`
      :'데이터 없음';
    return`<div class="card ${cfg.cls}">
      <div class="card-status" style="color:var(${cfg.textVar})">${cfg.label}</div>
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

  const zones=[...new Set(sheetZones.map(z=>z.name))];
  const datalist=`<datalist id="pe-zone-dl">${zones.map(z=>`<option value="${escHtml(z)}">`).join('')}</datalist>`;

  if(peEditMode){
    el.innerHTML=datalist+filtered.map(p=>`
      <div class="pe-row" id="pe-row-${escHtml(p.id)}">
        <span class="pe-id">${escHtml(p.id)}</span>
        <input id="pe-ez-${escHtml(p.id)}" value="${escHtml(p.zone)}" list="pe-zone-dl"
          oninput="markChanged(this,'${escHtml(p.id)}')"/>
        <input id="pe-el-${escHtml(p.id)}" value="${escHtml(p.loc)}" placeholder="설치 장소"
          oninput="markChanged(this,'${escHtml(p.id)}')"/>
        <button class="pe-btn del" onclick="deleteProductFromSheet('${escHtml(p.id)}')">삭제</button>
      </div>`).join('');
  } else {
    el.innerHTML=filtered.map(p=>`
      <div class="pe-row" id="pe-row-${escHtml(p.id)}">
        <span class="pe-id">${escHtml(p.id)}</span>
        <span class="pe-zone">${escHtml(p.zone)}</span>
        <span class="pe-loc">${escHtml(p.loc)||'—'}</span>
        <button class="pe-btn del" onclick="deleteProductFromSheet('${escHtml(p.id)}')">삭제</button>
      </div>`).join('');
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

function renderList(){
  const sel=document.getElementById('listFilterSel').value;
  const filtered=sel==='ALL'?results:results.filter(r=>r.status===sel);
  document.getElementById('listBody').innerHTML=filtered.map(r=>{
    const cfg=STATUS[r.status]||STATUS.LOAD;
    const time=r.item?r.item.format_created_time:(r.errMsg?r.errMsg.slice(0,60):'—');
    return`<div class="list-row">
      <div class="list-id-cell">${escHtml(r.id)}</div>
      <div class="list-status-cell" style="color:var(${cfg.textVar})">${cfg.label}</div>
      <div class="list-time-cell">${escHtml(time||'—')}</div>
    </div>`;
  }).join('');
}
function copyListToClipboard(){
  const sel=document.getElementById('listFilterSel').value;
  const filtered=sel==='ALL'?results:results.filter(r=>r.status===sel);
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

function renderSingleDetail(id, items){
  singleAllItems=[...items].sort((a,b)=>
    new Date(b.format_created_time)-new Date(a.format_created_time));
  singlePage=0;
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
  const pageItems=singleAllItems.slice(start, start+SINGLE_PAGE_SIZE);

  document.getElementById('singlePageInfo').textContent=
    `${start+1}–${Math.min(start+SINGLE_PAGE_SIZE,total)} / ${total}건`;

  document.getElementById('singleDetailBody').innerHTML=pageItems.map(item=>`<tr>
    <td>${escHtml(fmtTime(item.format_created_time))}</td>
    <td>${item.pm_10!==undefined?item.pm_10:'—'}</td>
    <td>${item.pm_2_5!==undefined?item.pm_2_5:'—'}</td>
    <td>${item.co2!==undefined?item.co2:'—'}</td>
  </tr>`).join('');

  renderSingleChart([...pageItems].reverse());

  const pg=document.getElementById('singlePagination');
  if(totalPages<=1){pg.innerHTML='';return;}
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

function copySingleToClipboard(){
  if(!singleAllItems.length) return;
  const header='수집 시간\tPM10\tPM2.5\tCO2';
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
      {label:'CO2 (ppm)', data:items.map(d=>d.co2!==undefined?Number(d.co2):null),
       borderColor:'#f7a14e', backgroundColor:'rgba(247,161,78,0.12)',
       fill:true, tension:0.35, pointRadius:pt, pointHoverRadius:6, borderWidth:2, spanGaps:false},
    ]}, options:makeOpts(false)});
  }
}

/* ===== 공통 실행 ===== */
async function runInspection(allIds){
  const token=document.getElementById('tokenInput').value.trim();
  if(!token){document.getElementById('errorMsg').textContent='⚠ 토큰이 설정되지 않았습니다.';return;}
  document.getElementById('runBtn').disabled=true;
  document.getElementById('summary').style.display='none';
  document.getElementById('grid').innerHTML=''; document.getElementById('listBody').innerHTML='';
  currentFilter='ALL'; currentView='grid';
  const dateRange=getDateRange(currentMode),nowMs=Date.now(),total=allIds.length;
  setLoading(true,0,total);
  addLog(`총 ${total}개 전체 동시 요청 시작`,'info');
  addLog(`기간: ${dateRange.started_at} ~ ${dateRange.finished_at}`,'muted');
  const out=allIds.map(id=>({id,status:'LOAD',item:null,errMsg:''}));
  let done=0;
  await Promise.all(allIds.map(async(id,idx)=>{
    try{
      const item=await fetchReport(id,dateRange,token);
      const status=classify(item,nowMs);
      out[idx]={id,status,item,errMsg:''};
      addLog(`[${id}] ${status}`+(item?` | ${item.format_created_time}`:'  | 데이터 없음'),status==='OK'?'ok':status==='ERR'?'err':'warn');
    }catch(err){
      out[idx]={id,status:'ERR',item:null,errMsg:err.message};
      addLog(`[${id}] ERR → ${err.message}`,'err');
    }
    setLoading(true,++done,total);
  }));
  results=out; lastResults=out; setLoading(false);
  document.getElementById('summary').style.display='flex';
  document.getElementById('grid').style.display='grid';
  document.getElementById('listView').style.display='none';
  document.getElementById('listToolbar').style.display='none';
  updateMobileFixedBtn();
  if(zoneGridOpen) toggleZoneGrid();
  renderSummary(); renderGrid();
  addLog('✓ 점검 완료','ok');
  document.getElementById('runBtn').disabled=false;
  document.getElementById('logBtn').style.display='inline-block';
  if(adminAuthenticated) updateSheetBtn();
  if(logVisible)renderLog();
}

/* ===== 메인 진입 ===== */
async function startInspection(){
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
    document.getElementById('runBtn').disabled=true;
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
      document.getElementById('runBtn').disabled=false;
    }
    return;
  }

  /* 영역 점검 */
  if(currentMode==='zone'){
    if(selectedZones.size===0){errEl.textContent='⚠ 영역을 하나 이상 선택해주세요.';return;}
    const ZONES=getAllZones();
    const zoneIds=[];
    selectedZones.forEach(i=>{ if(ZONES[i]) zoneIds.push(...ZONES[i].ids); });
    await runInspection([...new Set(zoneIds)]);
    return;
  }

  /* 범위/개별 */
  const startIdRaw=document.getElementById('startIdInput').value.trim()||'A001';
  const endIdRaw=document.getElementById('endIdInput').value.trim();
  let rangeIds=[];
  if(endIdRaw){
    const s=parseId(startIdRaw),e=parseId(endIdRaw);
    if(!s||!e){errEl.textContent='⚠ ID 형식이 잘못되었습니다. 예: A001';return;}
    if(s.prefix!==e.prefix){errEl.textContent='⚠ 시작/끝 ID 접두사가 같아야 합니다.';return;}
    if(s.num>e.num){errEl.textContent='⚠ 끝 ID가 시작 ID보다 작습니다.';return;}
    const padLen=Math.max(s.padLen,e.padLen);
    for(let n=s.num;n<=e.num;n++)rangeIds.push(formatId(s.prefix,n,padLen));
    lsSet(LS_ENDID,endIdRaw);
  }
  const allIds=[...new Set([...rangeIds,...extraIds])];
  if(allIds.length===0){errEl.textContent='⚠ 점검할 ID가 없습니다.';return;}
  await runInspection(allIds);
}

/* ===== 초기화 ===== */
(function init(){
  const savedTheme=lsGet(LS_THEME,'light');
  document.documentElement.setAttribute('data-theme',savedTheme);
  document.getElementById('themeIcon').textContent=savedTheme==='dark'?'☀️':'🌙';

  productLocations=lsGet(LS_PROD_LOCS,{});

  // 단일 검색 기본 날짜+시간 (전일 00:00 ~ 금일 23:59)
  document.getElementById('singleStartDate').value=yesterdayStr()+'T00:00';
  document.getElementById('singleEndDate').value=todayStr()+'T23:59';

  extraIds=lsGet(LS_EXTRA,[]);
  const savedEnd=lsGet(LS_ENDID,'');
  if(savedEnd) document.getElementById('endIdInput').value=savedEnd;
  renderExtraTags();

  const savedMode=lsGet(LS_MODE,'range');
  switchMode(savedMode);
  updateDateInfo();

  const addRestrictedInput=(id)=>{
    const el=document.getElementById(id);
    el.addEventListener('keydown',e=>{if(e.key==='Enter'){startInspection();return;}restrictIdInput(e);});
    el.addEventListener('paste',e=>{
      e.preventDefault();
      const cleaned=(e.clipboardData||window.clipboardData).getData('text').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,4);
      el.value=cleaned;
    });
  };
  addRestrictedInput('startIdInput');
  addRestrictedInput('endIdInput');

  document.getElementById('extraIdInput').addEventListener('keydown',e=>{if(e.key==='Enter')addExtraId();});
  document.getElementById('singleIdInput').addEventListener('keydown',e=>{if(e.key==='Enter')startInspection();});
  document.getElementById('adminPwInput').addEventListener('keydown',e=>{if(e.key==='Enter')authenticateAdmin();});
  document.getElementById('peNewId').addEventListener('keydown',e=>{if(e.key==='Enter')addProductToSheet();});

  // 단일 검색 날짜 변경 시 dateInfo 업데이트
  document.getElementById('singleStartDate').addEventListener('change',updateDateInfo);
  document.getElementById('singleEndDate').addEventListener('change',updateDateInfo);

  // GAS 시트에서 영역/설치장소 로드 (캐시 사용)
  loadSheetData();
})();
