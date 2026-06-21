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
        - 3행  : 헤더 (B=제품ID, C=영역명, E=설치장소)
        - 4행~ : 데이터
================================================================================
*/
// GET 요청 — 제품 리스트 시트에서 영역/설치장소 반환
// 반환 형식: { success, zones:[{name,ids[]}], locations:{id:loc} }
function doGet(e) {
try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('제품 리스트');
    if (!sheet) {
    return buildJson({ success: false, error: '제품 리스트 시트 없음' });
    }
    var lastRow = sheet.getLastRow();
    var locations = {};
    var zoneMap   = {};   // zoneName -> [id, ...]
    var zoneOrder = [];   // 등장 순서 유지
    if (lastRow >= 4) {
    // B(2)=제품ID, C(3)=영역명, D(4)=설치장소 → getRange(4, 2, n, 3)
    var rows = sheet.getRange(4, 2, lastRow - 3, 3).getValues();
    rows.forEach(function(row) {
        var id   = String(row[0]).trim();
        var zone = String(row[1]).trim();
        var loc  = String(row[2]).trim();
        if (!id) return;
        if (zone) {
        if (!zoneMap[zone]) { zoneMap[zone] = []; zoneOrder.push(zone); }
        zoneMap[zone].push(id);
        }
        if (loc) locations[id] = loc;
    });
    }
    var zones = zoneOrder.map(function(name) {
    return { name: name, ids: zoneMap[name] };
    });
    return buildJson({ success: true, zones: zones, locations: locations });
} catch(err) {
    return buildJson({ success: false, error: err.message });
}
}

// POST 요청 — action에 따라 처리
function doPost(e) {
try {
    var data = JSON.parse(e.postData.contents);
    var action = data.action || 'saveResults';

    if (action === 'addProduct')    return handleAddProduct(data);
    if (action === 'updateProduct') return handleUpdateProduct(data);
    if (action === 'deleteProduct') return handleDeleteProduct(data);

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

function buildJson(obj) {
    return ContentService.createTextOutput(JSON.stringify(obj))
        .setMimeType(ContentService.MimeType.JSON);
}
