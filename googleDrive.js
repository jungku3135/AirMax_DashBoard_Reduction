/*
================================================================================
Google Apps Script 코드 — 아래 코드를 복사하여 GAS 프로젝트에 붙여넣고
[배포 > 새 배포 > 웹앱] 으로 배포 후 URL을 아래 GAS_URL 변수에 입력하세요.
액세스 권한: "모든 사용자"로 설정해야 합니다.

시트 구조:
    점검 결과 시트 (예: "26년 4월")
        - 8행  : 날짜 헤더 (예: "04.27(일)") — D열부터 오른쪽으로 날짜 순
        - B열  : 제품 ID (9행부터)

    제품 리스트 시트 ("제품 리스트")
        - 3행  : 헤더 (B=제품ID, C=영역명, D=설치장소)
        - 4행~ : 데이터

    점검요청이력 시트 ("점검요청이력") — 주간 점검 요청서 생성 시 자동 기록됨.
    시트가 없으면 직접 만들어두세요 — 1행 공백, 2행에 헤더(B열부터), 3행부터 데이터:
        B          C     D      E       F      G         H    I      J     K
        생성일     제품ID 오류코드 오류발생일 신규여부 한달이상여부 영역 설치장소 요청자 비고
================================================================================
*/
// GET 요청 — 제품 리스트 시트에서 영역/설치장소 + 월별 점검 시트 목록 반환
// 반환 형식: { success, zones:[{name,ids[]}], locations:{id:loc}, monthSheets:[name,...] }
function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var productMap = getProductList(ss);
    var zoneMap = {}, zoneOrder = [], locations = {};
    Object.keys(productMap).forEach(function(id) {
      var p = productMap[id];
      if (p.zone) {
        if (!zoneMap[p.zone]) { zoneMap[p.zone] = []; zoneOrder.push(p.zone); }
        zoneMap[p.zone].push(id);
      }
      if (p.loc) locations[id] = p.loc;
    });
    var zones = zoneOrder.map(function(name) { return { name: name, ids: zoneMap[name] }; });
    var monthSheets = listMonthSheetsAsc(ss).map(function(m) { return m.name; });
    return buildJson({ success: true, zones: zones, locations: locations, monthSheets: monthSheets });
  } catch(err) {
    return buildJson({ success: false, error: err.message });
  }
}

// POST 요청 — action에 따라 처리
function doPost(e) {
try {
    var data = JSON.parse(e.postData.contents);
    var action = data.action || 'saveResults';

    if (action === 'addProduct')          return handleAddProduct(data);
    if (action === 'updateProduct')       return handleUpdateProduct(data);
    if (action === 'deleteProduct')       return handleDeleteProduct(data);
    if (action === 'getMonthGrid')        return getMonthGrid(data);
    if (action === 'getWeeklyReportDraft')return getWeeklyReportDraft(data);
    if (action === 'saveWeeklyReport')    return saveWeeklyReport(data);

    // 저장 요청 시각 기준으로 KST 날짜 산출
    var savedDate = data.savedAt ? new Date(data.savedAt) : new Date();
    var DAYS = ['일','월','화','수','목','금','토'];
    var month = Utilities.formatDate(savedDate, 'Asia/Seoul', 'MM');
    var day   = Utilities.formatDate(savedDate, 'Asia/Seoul', 'dd');
    var kstYMD = Utilities.formatDate(savedDate, 'Asia/Seoul', 'yyyy-MM-dd').split('-');
    var kstDate = new Date(parseInt(kstYMD[0]), parseInt(kstYMD[1]) - 1, parseInt(kstYMD[2]));
    var todayStr = month + '.' + day + '(' + DAYS[kstDate.getDay()] + ')';  // 예: "04.27(일)"

    // 시트명: "YY년 M월"
    var sheetName = (parseInt(kstYMD[0]) % 100) + '년 ' + parseInt(kstYMD[1]) + '월';
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
    return buildJson({ success: false, error: '시트 없음: ' + sheetName });
    }

    // 8행에서 오늘 날짜와 일치하는 열 찾기
    var lastCol    = sheet.getLastColumn();
    var headerVals = sheet.getRange(8, 1, 1, lastCol).getValues()[0];
    var targetCol  = -1;
    for (var c = 0; c < headerVals.length; c++) {
    if (String(headerVals[c]).trim() === todayStr) {
        targetCol = c + 1;  // 1-based
        break;
    }
    }
    if (targetCol === -1) {
    return buildJson({ success: false, error: '날짜 열 없음: ' + todayStr + ' (시트: ' + sheetName + ')' });
    }

    // B열에서 제품 ID 찾기 (9행부터)
    var lastRow = sheet.getLastRow();
    var idVals  = lastRow >= 9 ? sheet.getRange(9, 2, lastRow - 8, 1).getValues() : [];

    var updated = 0;
    var notFound = [];
    data.results.forEach(function(r) {
    var found = false;
    for (var i = 0; i < idVals.length; i++) {
        if (String(idVals[i][0]).trim() === String(r.id).trim()) {
        sheet.getRange(i + 9, targetCol).setValue(String(r.status).toUpperCase());
        updated++;
        found = true;
        break;
        }
    }
    if (!found) notFound.push(r.id);
    });

    return buildJson({
    success: true,
    updated: updated,
    total: data.results.length,
    notFound: notFound,
    sheet: sheetName,
    col: todayStr
    });
} catch(err) {
    return buildJson({ success: false, error: err.message });
}
}

// 제품 리스트 시트 전체를 {id: {zone, loc}} 형태로 읽어옴 (B=id, C=영역, D=설치장소)
function getProductList(ss) {
    var sheet = ss.getSheetByName('제품 리스트');
    var map = {};
    if (!sheet) return map;
    var lastRow = sheet.getLastRow();
    if (lastRow < 4) return map;
    var rows = sheet.getRange(4, 2, lastRow - 3, 3).getValues();
    rows.forEach(function(row) {
        var id = String(row[0]).trim();
        if (!id) return;
        map[id] = { zone: String(row[1]).trim(), loc: String(row[2]).trim() };
    });
    return map;
}

// 제품 리스트 시트에서 ID로 행 번호 찾기 (없으면 -1)
function findProductRow(sheet, id) {
    var lastRow = sheet.getLastRow();
    if (lastRow < 4) return -1;
    var ids = sheet.getRange(4, 2, lastRow - 3, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
        if (String(ids[i][0]).trim() === String(id).trim()) return i + 4;
    }
    return -1;
}

function handleAddProduct(data) {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('제품 리스트');
    if (!sheet) return buildJson({ success: false, error: '제품 리스트 시트 없음' });
    // 중복 체크
    if (findProductRow(sheet, data.id) !== -1)
        return buildJson({ success: false, error: '이미 존재하는 ID: ' + data.id });
    var nextRow = sheet.getLastRow() + 1;
    sheet.getRange(nextRow, 2, 1, 3).setValues([[data.id, data.zone || '', data.location || '']]);
    return buildJson({ success: true, id: data.id });
}

function handleUpdateProduct(data) {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('제품 리스트');
    if (!sheet) return buildJson({ success: false, error: '제품 리스트 시트 없음' });
    var row = findProductRow(sheet, data.id);
    if (row === -1) return buildJson({ success: false, error: 'ID 없음: ' + data.id });
    sheet.getRange(row, 3, 1, 2).setValues([[data.zone || '', data.location || '']]);
    return buildJson({ success: true, id: data.id });
}

function handleDeleteProduct(data) {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('제품 리스트');
    if (!sheet) return buildJson({ success: false, error: '제품 리스트 시트 없음' });
    var row = findProductRow(sheet, data.id);
    if (row === -1) return buildJson({ success: false, error: 'ID 없음: ' + data.id });
    sheet.deleteRow(row);
    return buildJson({ success: true, id: data.id });
}

/* ===================================================================
   점검 히스토리 / 주간 점검 요청서 자동 생성
   =================================================================== */

// 시트명 "YY년 M월" 파싱 → {name, year, month} (매치 안되면 null)
function parseMonthSheetName(name) {
    var m = String(name).trim().match(/^(\d{2})년\s*(\d{1,2})월$/);
    if (!m) return null;
    return { name: name, year: 2000 + parseInt(m[1], 10), month: parseInt(m[2], 10) };
}

// 스프레드시트 내 "YY년 M월" 형식 시트를 연대순(오래된 순)으로 정렬해 반환
function listMonthSheetsAsc(ss) {
    return ss.getSheets()
        .map(function(s) { return parseMonthSheetName(s.getName()); })
        .filter(function(m) { return m; })
        .sort(function(a, b) { return (a.year * 100 + a.month) - (b.year * 100 + b.month); });
}

// 월별 점검 시트에서 "제품 ID" 헤더가 있는 행을 찾음 — 시트마다 상단 요약 행 개수가 달라
// 헤더 행 번호가 고정돼 있지 않으므로, B열 값이 "제품 ID"인 행을 직접 탐색한다.
// 못 찾으면 기존 관례값(8행)으로 폴백.
function findHeaderRow(sheet) {
    var searchRows = Math.min(sheet.getLastRow(), 20);
    if (searchRows < 1) return 8;
    var colB = sheet.getRange(1, 2, searchRows, 1).getValues();
    for (var i = 0; i < colB.length; i++) {
        if (String(colB[i][0]).trim() === '제품 ID') return i + 1;
    }
    return 8;
}

// 월별 점검 시트 하나를 매트릭스로 읽음: 헤더 행(D열~)=날짜 헤더, 다음 행부터 B열=제품ID, D열~=일별 상태
function readSheetMatrix(sheet, year) {
    var headerRow = findHeaderRow(sheet);
    var dataStartRow = headerRow + 1;
    var lastCol = sheet.getLastColumn();
    var lastRow = sheet.getLastRow();
    var headers = [], dates = [];
    if (lastCol >= 4) {
        var headerRange = sheet.getRange(headerRow, 4, 1, lastCol - 3);
        var headerVals    = headerRange.getValues()[0];        // 실제 값 — 셀 서식이 날짜면 Date 객체로 옴
        var headerDisplay = headerRange.getDisplayValues()[0]; // 시트에 표시되는 문자열 그대로 ("07.13(월)")
        headerVals.forEach(function(h, idx) {
            var disp = String(headerDisplay[idx]).trim();
            headers.push(disp);
            if (Object.prototype.toString.call(h) === '[object Date]') {
                dates.push(h);
            } else {
                var m = disp.match(/^(\d{1,2})\.(\d{1,2})/);
                dates.push(m ? new Date(year, parseInt(m[1], 10) - 1, parseInt(m[2], 10)) : null);
            }
        });
    }
    var rowsById = {};
    if (lastRow >= dataStartRow && lastCol >= 4) {
        var idCol = sheet.getRange(dataStartRow, 2, lastRow - dataStartRow + 1, 1).getValues();
        var body  = sheet.getRange(dataStartRow, 4, lastRow - dataStartRow + 1, lastCol - 3).getValues();
        for (var i = 0; i < idCol.length; i++) {
            var id = String(idCol[i][0]).trim();
            if (!id) continue;
            rowsById[id] = body[i];
        }
    }
    return { headers: headers, dates: dates, rowsById: rowsById };
}

// 셀 값 분류 — 'BLANK' | 'PROBLEM:NO'|'PROBLEM:EM'|'PROBLEM:PM' | 'STOP'(OK, 제외사유 등)
function cellKind(raw) {
    var v = String(raw == null ? '' : raw).trim();
    if (!v) return 'BLANK';
    var up = v.toUpperCase();
    if (up === 'NO' || up === 'EM' || up === 'PM') return 'PROBLEM:' + up;
    return 'STOP';
}

// 특정 월 시트를 히스토리 페이지에 표시할 그리드 형태로 반환
function getMonthGrid(data) {
    try {
        var ss = SpreadsheetApp.getActiveSpreadsheet();
        var sheet = ss.getSheetByName(data.sheetName);
        if (!sheet) return buildJson({ success: false, error: '시트 없음: ' + data.sheetName });
        var meta = parseMonthSheetName(data.sheetName);
        var year = meta ? meta.year : (new Date()).getFullYear();
        var mat = readSheetMatrix(sheet, year);
        var rows = Object.keys(mat.rowsById).map(function(id) {
            return { id: id, values: mat.rowsById[id] };
        });
        return buildJson({ success: true, sheetName: data.sheetName, dates: mat.headers, rows: rows });
    } catch(err) {
        return buildJson({ success: false, error: err.message });
    }
}

// 주간 점검 요청서 초안 계산 — 연속 문제 발생 시작일, 신규여부, 30일 이상 여부까지 서버에서 전부 계산
// 신규 = 오류 발생 시점이 요청서 생성일(asOfDate) 당일인 항목. 한달 이상(30일+) 항목은 메인 목록에서 빼고
// 하단 섹션에만 담아 중복 표시하지 않는다.
function getWeeklyReportDraft(data) {
    try {
        var ss = SpreadsheetApp.getActiveSpreadsheet();
        var asOfStr = data.asOfDate;
        var parts = asOfStr.split('-');
        var asOfDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        var asOfKey = asOfDate.getFullYear() * 100 + (asOfDate.getMonth() + 1);

        var monthSheetsMeta = listMonthSheetsAsc(ss).filter(function(m) {
            return (m.year * 100 + m.month) <= asOfKey;
        });
        if (!monthSheetsMeta.length) return buildJson({ success: false, error: '대상 월 시트가 없습니다.' });

        // 제품ID별 타임라인(연대순) 구성
        var timelines = {};
        monthSheetsMeta.forEach(function(m) {
            var sheet = ss.getSheetByName(m.name);
            if (!sheet) return;
            var mat = readSheetMatrix(sheet, m.year);
            mat.dates.forEach(function(d, colIdx) {
                if (!d || d.getTime() > asOfDate.getTime()) return;
                Object.keys(mat.rowsById).forEach(function(id) {
                    if (!timelines[id]) timelines[id] = [];
                    timelines[id].push({ date: d, val: mat.rowsById[id][colIdx] });
                });
            });
        });

        var productList = getProductList(ss);
        var items = [];
        Object.keys(timelines).forEach(function(id) {
            var tl = timelines[id];
            if (!tl.length) return;
            var li = tl.length - 1;
            // asOfDate 당일 점검이 아직 안 돼 마지막 칸이 빈칸인 경우, 실제로 기록된
            // 가장 최근 값까지 건너뛰어 "현재 상태"를 판단 (월요일이 아니어도 매일 정상 조회되게)
            while (li >= 0 && cellKind(tl[li].val) === 'BLANK') li--;
            if (li < 0) return;
            var latestKind = cellKind(tl[li].val);
            if (latestKind.indexOf('PROBLEM') !== 0) return; // OK / 제외사유 → 제외
            var code = latestKind.split(':')[1];
            var since = tl[li].date;
            var i = li - 1;
            while (i >= 0) {
                var kind = cellKind(tl[i].val);
                if (kind === 'BLANK') { i--; continue; }
                if (kind.indexOf('PROBLEM') === 0) { since = tl[i].date; i--; continue; }
                break; // OK 또는 제외사유 → 연속 구간 종료
            }
            var daysOpen = Math.round((asOfDate.getTime() - since.getTime()) / 86400000);
            var info = productList[id] || { zone: '', loc: '' };
            items.push({
                id: id, zone: info.zone, loc: info.loc,
                code: code, since: Utilities.formatDate(since, 'Asia/Seoul', 'yy.MM.dd'),
                daysOpen: daysOpen, isOverdue: daysOpen >= 30,
                isNew: since.getTime() === asOfDate.getTime()
            });
        });

        var rank = function(it) { return it.code === 'NO' ? 1 : 0; };
        var byCodeThenId = function(a, b) {
            var r = rank(a) - rank(b);
            if (r !== 0) return r;
            return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
        };

        var overdueItems = items.filter(function(it) { return it.isOverdue; }).sort(byCodeThenId);
        var mainItems = items.filter(function(it) { return !it.isOverdue; }).sort(byCodeThenId);

        return buildJson({ success: true, asOfDate: asOfStr, items: mainItems, overdueItems: overdueItems });
    } catch(err) {
        return buildJson({ success: false, error: err.message });
    }
}

// 이번 주 요청서 결과를 "점검요청이력" 시트에 저장 (같은 생성일 행은 먼저 삭제 후 재기록 — 재생성 시 중복 방지)
// 시트 레이아웃: 1행 공백, 2행 헤더, 3행부터 데이터, B열부터 시작 (A열/1행은 항상 비움)
function saveWeeklyReport(data) {
    try {
        var ss = SpreadsheetApp.getActiveSpreadsheet();
        var sheet = ss.getSheetByName('점검요청이력');
        if (!sheet) return buildJson({ success: false, error: "'점검요청이력' 시트가 없습니다. 먼저 생성해주세요." });

        var lastRow = sheet.getLastRow();
        if (lastRow >= 3) {
            var dateVals = sheet.getRange(3, 2, lastRow - 2, 1).getValues(); // B열=생성일
            for (var r = dateVals.length - 1; r >= 0; r--) {
                var d = dateVals[r][0];
                var dStr = (d instanceof Date) ? Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM-dd') : String(d).trim();
                if (dStr === data.date) sheet.deleteRow(r + 3);
            }
        }

        var rows = (data.items || []).map(function(it) {
            return [data.date, it.id, it.code, it.since, it.isNew ? 'Y' : 'N', it.isOverdue ? 'Y' : 'N',
                    it.zone || '', it.loc || '', data.requester || '', it.remark || ''];
        });
        if (rows.length) {
            var startRow = Math.max(sheet.getLastRow() + 1, 3); // 최소 3행부터 (1행 공백, 2행 헤더 보호)
            sheet.getRange(startRow, 2, rows.length, rows[0].length).setValues(rows);
        }
        return buildJson({ success: true, saved: rows.length });
    } catch(err) {
        return buildJson({ success: false, error: err.message });
    }
}

function buildJson(obj) {
    return ContentService.createTextOutput(JSON.stringify(obj))
        .setMimeType(ContentService.MimeType.JSON);
}
