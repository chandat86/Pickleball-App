// ═══════════════════════════════════════════════════════════════
//  PICKLEBALL REFEREE – Google Apps Script v15 (2026-05-22)
//  ✅ Referee name stored in LiveScore (col 11)
//  ✅ replayMatch: sync 3 sheets (Matches+KetQua+LiveScore) khi đánh lại
//  ✅ Fix: trận đánh lại hiển thị đúng, doneMatches trừ playing
//  ✅ Fix: updateMatchScore dùng giai+nd+bang+code, tránh ghi nhầm giải trùng sân
//  ✅ BATCH endpoint: GET ?action=batch&actions=a,b,c...
//  ✅ Tối ưu: 1 request thay vì N requests song song
//  Multi-tournament | Manager Role | Standings | Court Assignment
//  Sheets: Tournaments, Users, Matches, KetQua, LiveScore,
//          EventLog, LoginLog, Players, Standings
// ═══════════════════════════════════════════════════════════════

const SS_ID = '15Z0Wup6bmh9TWZkmzyaCD3bFtGkg7kUs4KWH6QGTUBI'; // ← Thay ID Google Sheet của bạn

// ── Sheet names ──
const SH_TOURNAMENTS = 'Tournaments'; // Danh sách giải đấu
const SH_USERS       = 'Users';       // Trọng tài + Manager + Admin
const SH_MATCHES     = 'Matches';     // Lịch thi đấu (có cột Giải đấu)
const SH_RESULTS     = 'KetQua';      // Kết quả
const SH_LIVE        = 'LiveScore';   // Live đang chấm
const SH_EVENTS      = 'EventLog';    // Log từng điểm
const SH_LOGINLOG    = 'LoginLog';    // Lịch sử đăng nhập
const SH_PLAYERS     = 'Players';     // VĐV
const SH_STANDINGS   = 'Standings';   // BXH (có thể tính on-the-fly từ KetQua)

// ── Headers ──
// Tournaments: Mã giải | Tên giải | Địa điểm | Cụm sân | Ngày bắt đầu | Ngày kết thúc | Trạng thái | Ghi chú
const HDR_TOURN = ['Mã giải','Tên giải','Địa điểm','Cụm sân','Ngày bắt đầu','Ngày kết thúc','Trạng thái','Ghi chú','Người tạo'];

// Users: Mã | Họ tên | Hết hạn | Sân phân | Vòng phân | Thiết bị | Ghi chú | Trạng thái | Giải phân | Nội dung phân
const HDR_USERS = ['Mã','Họ tên','Hết hạn','Sân được phân','Vòng đấu','Thiết bị','Ghi chú','Trạng thái','Giải đấu phân','Nội dung phân'];

// Matches: Giải đấu | Nội dung | Bảng | Mã trận | Đội A | Điểm A | Điểm B | Đội B | Sân | Vòng đấu | Ghi chú
const HDR_MATCHES = ['Giải đấu','Nội dung','Bảng','Mã trận','Đội A','Điểm A','Điểm B','Đội B','Sân','Vòng đấu','Ghi chú'];

// KetQua: Thời gian | Giải đấu | Nội dung | Bảng | Mã trận | Đội A | Đội B | Điểm A | Điểm B | Thắng | Sân | Trọng tài | Quy tắc
const HDR_RESULTS = ['Thời gian','Giải đấu','Nội dung','Bảng','Mã trận','Đội A','Đội B','Điểm A','Điểm B','Thắng','Sân','Trọng tài','Quy tắc'];

// LiveScore: Key | Giải đấu | Đội A | Điểm A | Điểm B | Đội B | Giao bóng | Game | Cập nhật lúc | Trạng thái
// Trạng thái: 'playing' = đang thi đấu | 'finished' = đã kết thúc (trọng tài đã lưu kết quả)
const HDR_LIVE = ['Key','Giải đấu','Đội A','Điểm A','Điểm B','Đội B','Giao bóng','Game','Cập nhật lúc','Trạng thái','Trọng tài'];

// EventLog: Timestamp | Thời gian | Giải đấu | Nội dung | Bảng | Mã trận | Đội A | (+1) A | Tỉ số | (+1) B | Đội B | Game | Quy tắc | Sân | Sự kiện | Đội Thắng | Trọng tài
const HDR_EVENTS = ['Timestamp','Thời gian','Giải đấu','Nội dung','Bảng','Mã trận','Đội A','(+1) Đội A','Tỉ số','(+1) Đội B','Đội B','Game','Quy tắc','Sân','Sự kiện','Đội Thắng','Trọng tài'];

const HDR_LOGINLOG = ['Thời gian','Mã','Họ tên','Thiết bị','Kết quả','Chi tiết','Sân phân','Vòng phân'];
const HDR_PLAYERS  = ['Mã VĐV','Họ tên','Giới tính','Ngày sinh','Đơn vị','SĐT','Email','Giải đấu','Nội dung','Cấp độ','Ghi chú','Trạng thái'];

// ════════════════════════════════════════════════════════════════
//  PHÂN QUYỀN – Role Matrix v3
// ════════════════════════════════════════════════════════════════
//
//  Vai trò   | status     | Mô tả
//  ──────────────────────────────────────────────────────────────
//  admin     | 'admin'    | Toàn quyền: mọi giải, mọi tính năng
//  manager   | 'manager'  | Quản lý 1 giải cụ thể (xem trong Users.giai_phan)
//                           Phân công trọng tài cho giải của mình
//                           Xem dashboard giải mình
//                           KHÔNG thể tạo/xóa giải hoặc sửa Users khác giải
//  active    | 'active'   | Trọng tài: chấm điểm theo sân/vòng/giải được phân
//  khóa      | 'khóa'     | Không đăng nhập được
//
//  Enforcement: mọi action POST nhạy cảm đều gọi requireAdmin() hoặc requireAdminOrManager()
// ════════════════════════════════════════════════════════════════

function isAdminStatus(raw)   { return String(raw||'').trim().toLowerCase() === 'admin'; }
function isManagerStatus(raw) { return String(raw||'').trim().toLowerCase() === 'manager'; }

// Kiểm tra user có quyền admin không
function requireAdmin(data, ss) {
  const code = String(data.adminCode || '').trim().toUpperCase();
  if (!code) return null;
  const sh   = getOrCreateSheet(ss, SH_USERS, HDR_USERS);
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]||'').trim().toUpperCase() === code && isAdminStatus(rows[i][7])) {
      return { code, name: rows[i][1], role: 'admin', giai: null };
    }
  }
  return null;
}

// Kiểm tra quyền admin hoặc manager; manager chỉ cho phép thao tác trên giải của mình
function requireAdminOrManager(data, ss) {
  const code = String(data.adminCode || '').trim().toUpperCase();
  if (!code) return null;
  const sh   = getOrCreateSheet(ss, SH_USERS, HDR_USERS);
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const rowCode = String(rows[i][0]||'').trim().toUpperCase();
    if (rowCode !== code) continue;
    const st = String(rows[i][7]||'').trim().toLowerCase();
    if (st === 'admin')   return { code, name: rows[i][1], role: 'admin',   giai: null };
    if (st === 'manager') return { code, name: rows[i][1], role: 'manager', giai: String(rows[i][8]||'').trim() };
  }
  return null;
}

// Manager chỉ được thao tác trên giải được phân
function canAccessTournament(actor, tournamentId) {
  if (!actor) return false;
  if (actor.role === 'admin') return true;
  return actor.giai === tournamentId;
}

// ════════════════════════════════════════════════════════════════
//  doGet – Đọc dữ liệu
// ════════════════════════════════════════════════════════════════
function doGet(e) {
  try {
    const ss     = SpreadsheetApp.openById(SS_ID);
    const action = (e.parameter.action || 'matches').trim();
    const tz     = Session.getScriptTimeZone();

    // ── batch: lấy nhiều action trong 1 request ──
    if (action === 'batch') {
      return handleBatch(e, ss);
    }

    // ── validate: đăng nhập ──
    if (action === 'validate') {
      return handleValidate(e, ss, tz);
    }

    // ── tournaments: danh sách giải đấu (public) ──
    if (action === 'tournaments') {
      const sh   = getOrCreateSheet(ss, SH_TOURNAMENTS, HDR_TOURN);
      const rows = sh.getDataRange().getValues();
      // Manager chỉ thấy giải của mình (cột 8 = Người tạo = mã manager)
      const actorTourns = requireAdminOrManager(data, ss);
      if (actorTourns && !isAdminStatus(actorTourns.statusRaw) && isManagerStatus(actorTourns.statusRaw)) {
        const managerCode = String(data.adminCode||'').trim().toUpperCase();
        // Manager thấy: giải do mình tạo (col 8) HOẶC giải được assign trong Users (giai field)
        const assignedGiai = String(actorTourns.giai||'').trim().toUpperCase();
        const filtered = rows.filter((r, i) => {
          if (i === 0) return true; // header
          const ownerCol = String(r[8]||'').trim().toUpperCase();
          const giaiId   = String(r[0]||'').trim().toUpperCase();
          return ownerCol === managerCode || giaiId === assignedGiai;
        });
        return jsonOk({ rows: filtered });
      }
      return jsonOk({ rows });
    }

    // ── matches: lọc theo giải/nội dung/bảng/sân/vòng ──
    if (action === 'matches') {
      const sh   = getOrCreateSheet(ss, SH_MATCHES, HDR_MATCHES);
      const rows = sh.getDataRange().getValues();
      const f    = makeFilter(e.parameter);
      const out  = rows.slice(1).filter(r => f(r)).map(r => r);
      return jsonOk({ rows: [rows[0], ...out] });
    }

    // ── results ──
    if (action === 'results') {
      const sh   = getOrCreateSheet(ss, SH_RESULTS, HDR_RESULTS);
      const rows = sh.getDataRange().getValues();
      const giai = e.parameter.giai || '';
      const nd   = e.parameter.nd   || '';
      const bang = e.parameter.bang || '';
      const out  = rows.slice(1).filter(r =>
        (!giai || String(r[1]||'') === giai) &&
        (!nd   || String(r[2]||'') === nd)   &&
        (!bang || String(r[3]||'') === bang)
      );
      return jsonOk({ rows: [rows[0], ...out] });
    }

    // ── live ──
    if (action === 'live') {
      const sh   = getOrCreateSheet(ss, SH_LIVE, HDR_LIVE);
      const rows = sh.getDataRange().getValues();
      const code = e.parameter.code || '';
      const giai = e.parameter.giai || '';
      if (code === 'all') {
        let out = giai ? rows.slice(1).filter(r => String(r[1]||'') === giai) : rows.slice(1);
        // Chỉ trả về row đang thi đấu (playing) — finished đã được lọc riêng
        // Admin/referee phân biệt qua r[9]: 'playing' | 'finished' | '' (cũ, coi như playing)
        return jsonOk({ rows: [rows[0], ...out] });
      }
      const row = rows.find(r => r[0] === code);
      return jsonOk({ row: row || null });
    }

    // ── standings: BXH tính từ KetQua ──
    if (action === 'standings') {
      return handleStandings(e, ss);
    }

    // ── [ADMIN/MANAGER] getUsers ──
    if (action === 'getUsers') {
      const actor = requireAdminOrManager({ adminCode: e.parameter.adminCode }, ss);
      if (!actor) return jsonOk({ ok: false, reason: 'Không có quyền' });
      const sh   = getOrCreateSheet(ss, SH_USERS, HDR_USERS);
      const rows = sh.getDataRange().getValues();
      // Manager chỉ thấy user trong giải của mình
      const out = rows.slice(1).filter(r =>
        actor.role === 'admin' || String(r[8]||'').trim() === actor.giai
      );
      return jsonOk({ rows: [rows[0], ...out] });
    }

    // ── [ADMIN/MANAGER] getPlayers ──
    if (action === 'getPlayers') {
      const sh   = getOrCreateSheet(ss, SH_PLAYERS, HDR_PLAYERS);
      const rows = sh.getDataRange().getValues();
      const giai = e.parameter.giai || '';
      const out  = giai ? rows.slice(1).filter(r => String(r[7]||'') === giai) : rows.slice(1);
      return jsonOk({ rows: [rows[0], ...out] });
    }

    // ── [ADMIN/MANAGER] dashboard ──
    if (action === 'dashboard') {
      const actor = requireAdminOrManager({ adminCode: e.parameter.adminCode }, ss);
      if (!actor) return jsonOk({ ok: false, reason: 'Không có quyền' });
      return handleDashboard(e, ss, actor, tz);
    }

    return jsonOk({ error: 'Unknown action: ' + action });

  } catch (err) {
    return jsonErr(err.message);
  }
}

// ════════════════════════════════════════════════════════════════
//  doPost – Ghi dữ liệu
// ════════════════════════════════════════════════════════════════
function doPost(e) {
  try {
    const ss     = SpreadsheetApp.openById(SS_ID);
    const data   = JSON.parse(e.postData.contents);
    const action = data.action;
    const tz     = Session.getScriptTimeZone();

    // ── SCORING ACTIONS (trọng tài dùng) ──────────────────────

    // Lưu kết quả trận
    if (action === 'append') {
      return handleAppend(data, ss, tz);
    }

    // appendResult — Admin ghi tỉ số vào KetQua (upsert)
    if (action === 'appendResult') {
      const actor = requireAdminOrManager(data, ss);
      if (!actor) return jsonOk({ ok: false, reason: 'Không có quyền' });
      const rSh = getOrCreateSheet(ss, SH_RESULTS, HDR_RESULTS);
      const row = data.row || [];
      const giai = String(row[1]||'').trim();
      const bang = String(row[3]||'').trim();
      const code = String(row[4]||'').trim();
      const key  = giai + '|' + bang + '|' + code;
      const rows = rSh.getDataRange().getValues();
      let found = false;
      for (let i = 1; i < rows.length; i++) {
        const rKey = String(rows[i][1]||'') + '|' + String(rows[i][3]||'') + '|' + String(rows[i][4]||'');
        if (rKey === key) { rSh.getRange(i+1, 1, 1, row.length).setValues([row]); found = true; break; }
      }
      if (!found) rSh.appendRow(row);
      return jsonOk({ ok: true, upserted: true });
    }

    // logScoreEdit — Ghi log chỉnh sửa tỉ số của admin
    if (action === 'logScoreEdit') {
      const actor = requireAdminOrManager(data, ss);
      if (!actor) return jsonOk({ ok: false, reason: 'Không có quyền' });
      const logSh = getOrCreateSheet(ss, 'ScoreEditLog',
        ['Thời gian','Editor','Giải','ND','Bảng','Mã trận','Đội','Tỉ số cũ','Tỉ số mới','Ghi chú']);
      const l = data.log || {};
      logSh.appendRow([
        l.time || new Date().toISOString(),
        l.editor || actor.name || 'admin',
        l.giai || '', l.nd || '', l.bang || '', l.code || '',
        l.teams || '', l.oldScore || '', l.newScore || '', l.note || ''
      ]);
      return jsonOk({ ok: true, logged: true });
    }

    // Ghi EventLog đơn (legacy / fallback)
    if (action === 'log') {
      const sh = getOrCreateSheet(ss, SH_EVENTS, HDR_EVENTS);
      sh.appendRow(data.row);
      return jsonOk({ logged: 1 });
    }

    // ── Ghi EventLog hàng loạt (batch) — 1 request, N rows ──
    // Client gom nhiều điểm/sự kiện rồi gửi 1 lần → nhanh hơn N lần
    if (action === 'batchLog') {
      const rows = data.rows; // mảng các row (mỗi row là 1 mảng giá trị)
      if (!Array.isArray(rows) || rows.length === 0) return jsonOk({ logged: 0 });
      const sh      = getOrCreateSheet(ss, SH_EVENTS, HDR_EVENTS);
      const lastRow = sh.getLastRow();
      // setValues nhanh hơn nhiều appendRow lặp — 1 lần I/O duy nhất
      sh.getRange(lastRow + 1, 1, rows.length, rows[0].length).setValues(rows);
      SpreadsheetApp.flush(); // đảm bảo ghi xong trước khi trả về
      return jsonOk({ logged: rows.length });
    }

    // Cập nhật LiveScore
    if (action === 'live') {
      // ── KHÔNG dùng Lock cho live ──
      // Mỗi trọng tài chỉ ghi 1 row riêng (key = noidung|bang|code).
      // Xung đột chỉ xảy ra nếu cùng 1 key — dùng PropertiesCache để tránh scan,
      // nên tốc độ ghi < 200ms, không cần lock gây chậm.
      const sh  = getOrCreateSheet(ss, SH_LIVE, HDR_LIVE);
      const key = String(data.row[0] || '');
      const now = Utilities.formatDate(new Date(), tz, 'HH:mm:ss');
      const r   = data.row;

      // Referee gửi kèm giai → không cần đọc Matches sheet
      let giaiFromMatch = data.giai || '';
      if (!giaiFromMatch) {
        const mShLive   = getOrCreateSheet(ss, SH_MATCHES, HDR_MATCHES);
        const mRowsLive = mShLive.getDataRange().getValues().slice(1);
        const keyParts  = key.split('|');
        const matchRow  = mRowsLive.find(mr =>
          String(mr[1]||'') === keyParts[0] &&
          String(mr[2]||'') === keyParts[1] &&
          String(mr[3]||'') === keyParts[2]
        );
        giaiFromMatch = matchRow ? String(matchRow[0]||'') : '';
      }

      // r[0]=key, r[1]=teamA, r[2]=scoreA, r[3]=scoreB, r[4]=teamB, r[5]=server, r[6]=game
      // r[7]=updatedAt (client, bỏ qua — dùng now), r[8]=referee (v15+)
      const rowWithTs = [
        key, giaiFromMatch,
        r[1]||'', Number(r[2])||0, Number(r[3])||0, r[4]||'',
        r[5]||'', r[6]||'Game 1', now, 'playing',
        r[8]||''  // Trọng tài (col 11)
      ];

      // Dùng PropertiesService cache row index → ghi trực tiếp, không scan toàn sheet
      const props    = PropertiesService.getScriptProperties();
      const cacheKey = 'LIVE_ROW_' + key.replace(/[^a-zA-Z0-9_]/g, '_');
      const cachedRow = parseInt(props.getProperty(cacheKey) || '0', 10);

      let rowWritten = false;
      if (cachedRow > 1) {
        try {
          const existing = sh.getRange(cachedRow, 1, 1, 1).getValue();
          if (String(existing||'').trim() === key.trim()) {
            sh.getRange(cachedRow, 1, 1, rowWithTs.length).setValues([rowWithTs]);
            rowWritten = true;
          }
        } catch(eCache) { /* cache stale → scan lại dưới */ }
      }

      if (!rowWritten) {
        const lastRow = sh.getLastRow();
        let foundRow = 0;
        if (lastRow > 1) {
          const keyCol = sh.getRange(2, 1, lastRow - 1, 1).getValues();
          for (let i = keyCol.length - 1; i >= 0; i--) {
            if (String(keyCol[i][0]||'').trim() === key.trim()) {
              foundRow = i + 2;
              break;
            }
          }
        }
        if (foundRow > 0) {
          sh.getRange(foundRow, 1, 1, rowWithTs.length).setValues([rowWithTs]);
          props.setProperty(cacheKey, String(foundRow));
        } else {
          sh.appendRow(rowWithTs);
          props.setProperty(cacheKey, String(sh.getLastRow()));
        }
      }
      // SpreadsheetApp.flush() bỏ — không cần flush cho live update, tiết kiệm ~200ms
      return jsonOk({ updated: true, score: [Number(r[2])||0, Number(r[3])||0] });
    }

    // Xóa LiveScore (thoát trận không lưu)
    if (action === 'deleteLive') {
      clearLive(ss, data.key || '');
      return jsonOk({ deleted: true });
    }

    // Đánh dấu LiveScore đã hoàn thành (trọng tài đã lưu kết quả)
    // Giữ lại row với status='finished' thay vì xóa — admin vẫn thấy tỉ số cuối
    if (action === 'finishLive') {
      const lock2 = LockService.getScriptLock();
      lock2.waitLock(3000);
      try {
        const sh  = getOrCreateSheet(ss, SH_LIVE, HDR_LIVE);
        const key = String(data.key || '');
        const now2 = Utilities.formatDate(new Date(), tz, 'HH:mm:ss');
        const props2    = PropertiesService.getScriptProperties();
        const cacheKey2 = 'LIVE_ROW_' + key.replace(/[^a-zA-Z0-9_]/g, '_');
        const cachedRow2 = parseInt(props2.getProperty(cacheKey2) || '0', 10);

        let found = false;
        // Thử dùng cache trước
        if (cachedRow2 > 1) {
          try {
            const existing2 = sh.getRange(cachedRow2, 1, 1, 1).getValue();
            if (String(existing2||'').trim() === key.trim()) {
              const r2 = sh.getRange(cachedRow2, 1, 1, 10).getValues()[0];
              const sA = (data.scoreA !== undefined && data.scoreA !== null) ? data.scoreA : r2[3];
              const sB = (data.scoreB !== undefined && data.scoreB !== null) ? data.scoreB : r2[4];
              sh.getRange(cachedRow2, 1, 1, 11).setValues([[r2[0],r2[1],r2[2],sA,sB,r2[5],r2[6],r2[7],now2,'finished',r2[10]||'']]);
              found = true;
            }
          } catch(e2) {}
        }
        if (!found) {
          // Scan cột Key
          const lastRow2 = sh.getLastRow();
          if (lastRow2 > 1) {
            const keyCol2 = sh.getRange(2, 1, lastRow2-1, 1).getValues();
            for (let i = 0; i < keyCol2.length; i++) {
              if (String(keyCol2[i][0]||'').trim() === key.trim()) {
                const ri = i + 2;
                const r2 = sh.getRange(ri, 1, 1, 10).getValues()[0];
                const sA = (data.scoreA !== undefined && data.scoreA !== null) ? data.scoreA : r2[3];
                const sB = (data.scoreB !== undefined && data.scoreB !== null) ? data.scoreB : r2[4];
                sh.getRange(ri, 1, 1, 11).setValues([[r2[0],r2[1],r2[2],sA,sB,r2[5],r2[6],r2[7],now2,'finished',r2[10]||'']]);
                found = true;
                break;
              }
            }
          }
          // Nếu chưa có row → tạo mới với status=finished
          if (!found && key) {
            const mShF   = getOrCreateSheet(ss, SH_MATCHES, HDR_MATCHES);
            const mRowsF = mShF.getDataRange().getValues().slice(1);
            const kp     = key.split('|');
            const mr     = mRowsF.find(m => String(m[1]||'')===kp[0] && String(m[2]||'')===kp[1] && String(m[3]||'')===kp[2]);
            const gF     = data.giai || (mr ? String(mr[0]||'') : '');
            sh.appendRow([key, gF, data.teamA||'', data.scoreA||0, data.scoreB||0,
                          data.teamB||'', '', 'Game '+(data.game||1), now2, 'finished']);
          }
        }
        // Xóa cache vì row đã finished (sẽ bị dọn sau 60 phút)
        props2.deleteProperty(cacheKey2);
      } finally { lock2.releaseLock(); }
      return jsonOk({ finished: true });
    }

    // ══════════════════════════════════════════════════════════════
    // replayMatch: Trọng tài đánh lại trận đã hoàn thành
    // → Reset điểm trong Matches, xóa KetQua cũ, xóa LiveScore row
    // → Tất cả sheets đồng bộ: trận về trạng thái "chưa đấu"
    // → Trọng tài bắt đầu lại từ 0
    // ══════════════════════════════════════════════════════════════
    if (action === 'replayMatch') {
      const key      = String(data.key    || '').trim(); // noidung|bang|code
      const giai     = String(data.giai   || '').trim();
      const nd       = String(data.nd     || '').trim();
      const bang     = String(data.bang   || '').trim();
      const code     = String(data.code   || '').trim();
      if (!key || !bang || !code) return jsonOk({ ok: false, reason: 'Thiếu thông tin trận' });

      // 1. Reset điểm A/B trong sheet Matches → về rỗng (chưa đấu)
      try {
        const mSh   = ss.getSheetByName(SH_MATCHES);
        if (mSh) {
          const mRows = mSh.getDataRange().getValues();
          for (let i = 1; i < mRows.length; i++) {
            const rGiai = String(mRows[i][0]||'').trim();
            const rNd   = String(mRows[i][1]||'').trim();
            const rBang = String(mRows[i][2]||'').trim();
            const rCode = String(mRows[i][3]||'').trim();
            // Khớp giai+nd+bang+code để tránh reset nhầm giải khác
            const giaiMatch = !giai || rGiai === giai;
            const ndMatch   = !nd   || rNd   === nd;
            if (giaiMatch && ndMatch && rBang === bang && rCode === code) {
              mSh.getRange(i+1, 6).setValue(''); // Điểm A → rỗng
              mSh.getRange(i+1, 7).setValue(''); // Điểm B → rỗng
              break;
            }
          }
        }
      } catch(e1) { Logger.log('replayMatch Matches: ' + e1.message); }

      // 2. Xóa row trong KetQua → trận không còn "hoàn thành"
      try {
        const rSh   = ss.getSheetByName(SH_RESULTS);
        if (rSh) {
          const rRows = rSh.getDataRange().getValues();
          // Duyệt từ dưới lên để xóa không bị lệch index
          for (let i = rRows.length - 1; i >= 1; i--) {
            const rGiai = String(rRows[i][1]||'').trim();
            const rNd   = String(rRows[i][2]||'').trim();
            const rBang = String(rRows[i][3]||'').trim();
            const rCode = String(rRows[i][4]||'').trim();
            const giaiMatch = !giai || rGiai === giai;
            const ndMatch   = !nd   || rNd   === nd;
            if (giaiMatch && ndMatch && rBang === bang && rCode === code) {
              rSh.deleteRow(i+1);
              break; // xóa 1 row duy nhất (trận upsert, chỉ có 1)
            }
          }
        }
      } catch(e2) { Logger.log('replayMatch KetQua: ' + e2.message); }

      // 3. Xóa LiveScore row (nếu có row finished) → trận về "chưa đấu"
      clearLive(ss, key);

      // 4. Xóa PropertiesService cache để lần push live tiếp tạo row mới
      try {
        const cKey = 'LIVE_ROW_' + key.replace(/[^a-zA-Z0-9_]/g, '_');
        PropertiesService.getScriptProperties().deleteProperty(cKey);
      } catch(e3) {}

      return jsonOk({ ok: true, reset: { matches: true, ketqua: true, live: true } });
    }

    // Thêm trận (từ app trọng tài, backward compat)
    if (action === 'addMatch') {
      const sh   = getOrCreateSheet(ss, SH_MATCHES, HDR_MATCHES);
      const rows = sh.getDataRange().getValues();
      const key  = (data.row[0]||'')+'|'+(data.row[2]||'')+'|'+(data.row[3]||'');
      const dup  = rows.slice(1).find(r => (r[0]+'|'+r[2]+'|'+r[3]) === key);
      if (!dup) sh.appendRow(data.row);
      return jsonOk({ added: !dup });
    }

    // ── TOURNAMENT ACTIONS (Admin) ──────────────────────────────

    if (action === 'addTournament') {
      const actor = requireAdminOrManager(data, ss);
      if (!actor) return jsonOk({ ok: false, reason: 'Không có quyền tạo giải' });
      const sh   = getOrCreateSheet(ss, SH_TOURNAMENTS, HDR_TOURN);
      const rows = sh.getDataRange().getValues();
      const id   = String(data.tournament.id || '').trim().toUpperCase();
      if (!id) return jsonOk({ ok: false, reason: 'Thiếu mã giải' });
      if (rows.slice(1).find(r => String(r[0]||'').trim().toUpperCase() === id))
        return jsonOk({ ok: false, reason: 'Mã giải đã tồn tại' });
      const t = data.tournament;
      // Lưu owner = mã người tạo (manager hoặc admin)
      const ownerCode = String(data.adminCode||'').trim().toUpperCase();
      sh.appendRow([id, t.name||'', t.venue||'', t.courts||'', t.startDate||'', t.endDate||'', t.status||'active', t.note||'', ownerCode]);
      // Gán giải cho refs được chọn
      if (Array.isArray(t.refs) && t.refs.length) {
        _assignRefsGiai(ss, t.refs, t.name||id);
      }
      return jsonOk({ ok: true, added: id });
    }

    if (action === 'updateTournament') {
      const actor = requireAdminOrManager(data, ss);
      if (!actor) return jsonOk({ ok: false, reason: 'Không có quyền' });
      // Manager chỉ được sửa giải của mình
      if (!isAdminStatus(actor.statusRaw) && isManagerStatus(actor.statusRaw)) {
        const sh2 = getOrCreateSheet(ss, SH_TOURNAMENTS, HDR_TOURN);
        const rows2 = sh2.getDataRange().getValues();
        const tId  = String((data.tournament&&data.tournament.id)||data.id||'').trim().toUpperCase();
        const row2 = rows2.slice(1).find(r=>String(r[0]||'').trim().toUpperCase()===tId);
        const myCode = String(data.adminCode||'').trim().toUpperCase();
        const myGiai = String(actor.giai||'').trim().toUpperCase();
        if (row2 && String(row2[8]||'').trim().toUpperCase()!==myCode && String(row2[0]||'').trim().toUpperCase()!==myGiai)
          return jsonOk({ ok: false, reason: 'Bạn chỉ được sửa giải của mình' });
      }
      const sh   = getOrCreateSheet(ss, SH_TOURNAMENTS, HDR_TOURN);
      const rows = sh.getDataRange().getValues();
      const id   = String(data.tournament.id || '').trim().toUpperCase();
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][0]||'').trim().toUpperCase() === id) {
          const t = data.tournament;
          if (t.name      !== undefined) sh.getRange(i+1,2).setValue(t.name);
          if (t.venue     !== undefined) sh.getRange(i+1,3).setValue(t.venue);
          if (t.courts    !== undefined) sh.getRange(i+1,4).setValue(t.courts);
          if (t.startDate !== undefined) sh.getRange(i+1,5).setValue(t.startDate);
          if (t.endDate   !== undefined) sh.getRange(i+1,6).setValue(t.endDate);
          if (t.status    !== undefined) sh.getRange(i+1,7).setValue(t.status);
          if (t.note      !== undefined) sh.getRange(i+1,8).setValue(t.note);
          // Cập nhật refs: gán giải cho TT được chọn
          if (Array.isArray(t.refs)) {
            const giaiName = t.name || String(rows[i][1]||'');
            _assignRefsGiai(ss, t.refs, giaiName);
          }
          return jsonOk({ ok: true });
        }
      }
      return jsonOk({ ok: false, reason: 'Không tìm thấy giải' });
    }

    // ── assignRefsToTournament: gán/bỏ gán nhiều TT cho 1 giải cùng lúc ──
    if (action === 'assignRefsToTournament') {
      const actor = requireAdminOrManager(data, ss);
      if (!actor) return jsonOk({ ok: false, reason: 'Không có quyền' });
      const giai    = String(data.giai    || '').trim(); // tên giải
      const refCodes = Array.isArray(data.refCodes) ? data.refCodes.map(c=>String(c).trim().toUpperCase()) : [];
      if (!giai) return jsonOk({ ok: false, reason: 'Thiếu tên giải' });
      const sh   = getOrCreateSheet(ss, SH_USERS, HDR_USERS);
      const rows = sh.getDataRange().getValues();
      let assigned = 0, removed = 0;
      for (let i = 1; i < rows.length; i++) {
        const code    = String(rows[i][0]||'').trim().toUpperCase();
        const curGiai = String(rows[i][8]||'').trim();
        const st      = String(rows[i][7]||'').toLowerCase();
        if (st === 'admin') continue;
        if (refCodes.includes(code)) {
          // Gán giải
          if (curGiai !== giai) { sh.getRange(i+1,9).setValue(giai); assigned++; }
        } else if (curGiai === giai) {
          // Bỏ gán — xóa giải, xóa sân/vòng
          sh.getRange(i+1,4).setValue('');
          sh.getRange(i+1,5).setValue('');
          sh.getRange(i+1,9).setValue('');
          sh.getRange(i+1,10).setValue('');
          removed++;
        }
      }
      return jsonOk({ ok: true, assigned, removed });
    }

    // ── assignCourtToRef: phân sân cụ thể cho 1 TT trong giải ──
    if (action === 'assignCourtToRef') {
      const actor = requireAdminOrManager(data, ss);
      if (!actor) return jsonOk({ ok: false, reason: 'Không có quyền' });
      const sh     = getOrCreateSheet(ss, SH_USERS, HDR_USERS);
      const rows   = sh.getDataRange().getValues();
      const target = String(data.refCode||'').trim().toUpperCase();
      const courts = String(data.courts ||'').trim();
      const rounds = String(data.rounds ||'').trim();
      const nd     = String(data.noidung||'').trim();
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][0]||'').trim().toUpperCase() !== target) continue;
        sh.getRange(i+1,4).setValue(courts);
        sh.getRange(i+1,5).setValue(rounds);
        if (nd) sh.getRange(i+1,10).setValue(nd);
        return jsonOk({ ok: true });
      }
      return jsonOk({ ok: false, reason: 'Không tìm thấy trọng tài' });
    }

    if (action === 'deleteTournament') {
      const actor = requireAdminOrManager(data, ss);
      if (!actor) return jsonOk({ ok: false, reason: 'Không có quyền' });
      // Manager chỉ được xóa giải của mình
      if (!isAdminStatus(actor.statusRaw) && isManagerStatus(actor.statusRaw)) {
        const sh3 = getOrCreateSheet(ss, SH_TOURNAMENTS, HDR_TOURN);
        const rows3 = sh3.getDataRange().getValues();
        const dId  = String(data.id||'').trim().toUpperCase();
        const row3 = rows3.slice(1).find(r=>String(r[0]||'').trim().toUpperCase()===dId);
        const myCode3 = String(data.adminCode||'').trim().toUpperCase();
        const myGiai3 = String(actor.giai||'').trim().toUpperCase();
        if (row3 && String(row3[8]||'').trim().toUpperCase()!==myCode3 && String(row3[0]||'').trim().toUpperCase()!==myGiai3)
          return jsonOk({ ok: false, reason: 'Bạn chỉ được xóa giải của mình' });
      }
      const sh   = getOrCreateSheet(ss, SH_TOURNAMENTS, HDR_TOURN);
      const rows = sh.getDataRange().getValues();
      const id   = String(data.id || '').trim().toUpperCase();
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][0]||'').trim().toUpperCase() === id) {
          sh.deleteRow(i+1);
          return jsonOk({ ok: true });
        }
      }
      return jsonOk({ ok: false, reason: 'Không tìm thấy giải' });
    }

    // ── USER ACTIONS (Admin + Manager) ──────────────────────────

    if (action === 'addUser') {
      const actor = requireAdminOrManager(data, ss);
      if (!actor) return jsonOk({ ok: false, reason: 'Không có quyền' });
      const sh      = getOrCreateSheet(ss, SH_USERS, HDR_USERS);
      const rows    = sh.getDataRange().getValues();
      const newCode = String(data.user.code||'').trim().toUpperCase();
      if (!newCode) return jsonOk({ ok: false, reason: 'Thiếu mã' });
      if (rows.slice(1).find(r => String(r[0]||'').trim().toUpperCase() === newCode))
        return jsonOk({ ok: false, reason: 'Mã đã tồn tại: ' + newCode });
      // Manager chỉ tạo trọng tài cho giải của mình
      const assignGiai = actor.role === 'manager' ? actor.giai : (data.user.giai || '');
      const expDate = data.user.expire ? new Date(data.user.expire) : new Date('2099-12-31');
      sh.appendRow([
        newCode,
        String(data.user.name   || '').trim(),
        expDate,
        String(data.user.courts || '').trim(),
        String(data.user.rounds || '').trim(),
        '',
        String(data.user.note   || '').trim(),
        String(data.user.status || 'active').trim().toLowerCase(),
        assignGiai,
        String(data.user.noidung || '').trim()
      ]);
      return jsonOk({ ok: true, added: newCode });
    }

    if (action === 'updateUser') {
      const actor = requireAdminOrManager(data, ss);
      if (!actor) return jsonOk({ ok: false, reason: 'Không có quyền' });
      const sh     = getOrCreateSheet(ss, SH_USERS, HDR_USERS);
      const rows   = sh.getDataRange().getValues();
      const target = String(data.user.code||'').trim().toUpperCase();
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][0]||'').trim().toUpperCase() !== target) continue;
        // Manager chỉ sửa trọng tài trong giải của mình
        if (actor.role === 'manager' && String(rows[i][8]||'').trim() !== actor.giai)
          return jsonOk({ ok: false, reason: 'Không có quyền sửa trọng tài giải khác' });
        const u = data.user;
        if (u.name    !== undefined) sh.getRange(i+1,2).setValue(u.name);
        if (u.expire  !== undefined) sh.getRange(i+1,3).setValue(new Date(u.expire));
        if (u.courts  !== undefined) sh.getRange(i+1,4).setValue(u.courts);
        if (u.rounds  !== undefined) sh.getRange(i+1,5).setValue(u.rounds);
        if (u.note    !== undefined) sh.getRange(i+1,7).setValue(u.note);
        if (u.status  !== undefined) sh.getRange(i+1,8).setValue(u.status);
        if (u.giai    !== undefined && actor.role === 'admin') sh.getRange(i+1,9).setValue(u.giai);
        if (u.noidung !== undefined) sh.getRange(i+1,10).setValue(u.noidung);
        return jsonOk({ ok: true });
      }
      return jsonOk({ ok: false, reason: 'Không tìm thấy' });
    }

    if (action === 'deleteUser') {
      const actor = requireAdminOrManager(data, ss);
      if (!actor) return jsonOk({ ok: false, reason: 'Không có quyền' });
      const sh     = getOrCreateSheet(ss, SH_USERS, HDR_USERS);
      const rows   = sh.getDataRange().getValues();
      const target = String(data.code||'').trim().toUpperCase();
      const adminCount = rows.slice(1).filter(r => String(r[7]||'').toLowerCase() === 'admin').length;
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][0]||'').trim().toUpperCase() !== target) continue;
        if (actor.role === 'manager' && String(rows[i][8]||'').trim() !== actor.giai)
          return jsonOk({ ok: false, reason: 'Không có quyền' });
        if (String(rows[i][7]||'').toLowerCase() === 'admin' && adminCount <= 1)
          return jsonOk({ ok: false, reason: 'Không thể xóa admin duy nhất' });
        sh.deleteRow(i+1);
        return jsonOk({ ok: true });
      }
      return jsonOk({ ok: false, reason: 'Không tìm thấy' });
    }

    // Phân công trọng tài: cập nhật sân, vòng, giải, nội dung
    if (action === 'assignRef') {
      const actor = requireAdminOrManager(data, ss);
      if (!actor) return jsonOk({ ok: false, reason: 'Không có quyền' });
      const sh     = getOrCreateSheet(ss, SH_USERS, HDR_USERS);
      const rows   = sh.getDataRange().getValues();
      const target = String(data.refCode||'').trim().toUpperCase();
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][0]||'').trim().toUpperCase() !== target) continue;
        if (actor.role === 'manager' && String(rows[i][8]||'').trim() !== actor.giai)
          return jsonOk({ ok: false, reason: 'Không có quyền phân công trọng tài giải khác' });
        // Chỉ clear/update sân vòng, không đổi role
        sh.getRange(i+1,4).setValue(data.courts  || '');
        sh.getRange(i+1,5).setValue(data.rounds  || '');
        sh.getRange(i+1,9).setValue(data.giai    || rows[i][8] || '');
        sh.getRange(i+1,10).setValue(data.noidung|| rows[i][9] || '');
        return jsonOk({ ok: true });
      }
      return jsonOk({ ok: false, reason: 'Không tìm thấy trọng tài' });
    }

    // Clear sân sau giải đấu — xóa sân/vòng của tất cả TT thuộc giải
    if (action === 'clearRefAssignment') {
      const actor = requireAdminOrManager(data, ss);
      if (!actor) return jsonOk({ ok: false, reason: 'Không có quyền' });
      const sh   = getOrCreateSheet(ss, SH_USERS, HDR_USERS);
      const rows = sh.getDataRange().getValues();
      const giai = String(data.giai || '').trim();
      let cleared = 0;
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][8]||'').trim() !== giai) continue;
        if (!canAccessTournament(actor, giai)) continue;
        sh.getRange(i+1,4).setValue(''); // clear sân
        sh.getRange(i+1,5).setValue(''); // clear vòng
        cleared++;
      }
      return jsonOk({ ok: true, cleared });
    }

    // ── MATCH ACTIONS (Admin + Manager) ──────────────────────────

    if (action === 'addMatchAdmin') {
      const actor = requireAdminOrManager(data, ss);
      if (!actor) return jsonOk({ ok: false, reason: 'Không có quyền' });
      const sh   = getOrCreateSheet(ss, SH_MATCHES, HDR_MATCHES);
      const rows = sh.getDataRange().getValues();
      // row = [Giải đấu, Nội dung, Bảng, Mã trận, ĐộiA, ĐiểmA, ĐiểmB, ĐộiB, Sân, Vòng, GhiChú]
      const row  = data.row || [];
      const giai = String(row[0]||'').trim();
      if (!canAccessTournament(actor, giai))
        return jsonOk({ ok: false, reason: 'Manager không thể thêm trận cho giải khác' });
      const key = giai+'|'+row[2]+'|'+row[3]; // Giải|Bảng|Mã
      const dup = rows.slice(1).find(r => (r[0]+'|'+r[2]+'|'+r[3]) === key);
      if (dup) return jsonOk({ ok: false, reason: 'Trận đã tồn tại' });
      sh.appendRow(row);
      return jsonOk({ ok: true });
    }

    // ── addMatchesBatch: ghi nhiều trận 1 lần, nhanh gấp N lần addMatchAdmin ──
    if (action === 'addMatchesBatch') {
      const actor = requireAdminOrManager(data, ss);
      if (!actor) return jsonOk({ ok: false, reason: 'Không có quyền' });
      const sh    = getOrCreateSheet(ss, SH_MATCHES, HDR_MATCHES);
      const rows  = sh.getDataRange().getValues();
      // Build existing key set: giai|bang|code
      const existing = new Set(rows.slice(1).map(r => `${r[0]}|${r[2]}|${r[3]}`));
      const toAdd = (data.rows || []).filter(row => {
        const giai = String(row[0]||'').trim();
        if (!canAccessTournament(actor, giai)) return false;
        const key = `${giai}|${row[2]}|${row[3]}`;
        return !existing.has(key);
      });
      if (!toAdd.length) return jsonOk({ ok: true, added: 0, skipped: (data.rows||[]).length });
      sh.getRange(sh.getLastRow()+1, 1, toAdd.length, toAdd[0].length).setValues(toAdd);
      return jsonOk({ ok: true, added: toAdd.length, skipped: (data.rows||[]).length - toAdd.length });
    }

    if (action === 'updateMatch') {
      const actor = requireAdminOrManager(data, ss);
      if (!actor) return jsonOk({ ok: false, reason: 'Không có quyền' });
      const sh   = getOrCreateSheet(ss, SH_MATCHES, HDR_MATCHES);
      const rows = sh.getDataRange().getValues();
      // Tìm theo bang|code (không phụ thuộc vào giai để tránh mismatch tên/mã)
      const giai     = String(data.giai||'').trim();
      const giaiName = String(data.giaiName||data.giai||'').trim();
      const bang     = String(data.bang||'').trim();
      const code     = String(data.code||'').trim();
      for (let i = 1; i < rows.length; i++) {
        const rGiai = String(rows[i][0]||'').trim();
        const rBang = String(rows[i][2]||'').trim();
        const rCode = String(rows[i][3]||'').trim();
        if (rBang !== bang || rCode !== code) continue;
        // Khớp giải: so sánh tên hoặc mã
        const giaiMatch = rGiai === giai || rGiai === giaiName;
        if (!giaiMatch) continue;
        // ⚡ Đảm bảo row[0] ghi ra sheet là TÊN GIẢI đang có (không ghi đè bằng mã)
        const writeRow = [...(data.row||[])];
        writeRow[0] = rGiai; // Giữ nguyên tên giải đang có trong sheet
        sh.getRange(i+1, 1, 1, writeRow.length).setValues([writeRow]);
        return jsonOk({ ok: true });
      }
      return jsonOk({ ok: false, reason: 'Không tìm thấy trận: ' + bang + '|' + code });
    }

    if (action === 'deleteMatch') {
      const actor = requireAdminOrManager(data, ss);
      if (!actor) return jsonOk({ ok: false, reason: 'Không có quyền' });
      const sh   = getOrCreateSheet(ss, SH_MATCHES, HDR_MATCHES);
      const rows = sh.getDataRange().getValues();
      const giai = String(data.giai||'').trim();
      const bang = String(data.bang||'').trim();
      const code = String(data.code||'').trim();
      // canAccessTournament với cả mã lẫn tên giải
      if (!canAccessTournament(actor, giai) && actor.role !== 'admin')
        return jsonOk({ ok: false, reason: 'Không có quyền' });
      for (let i = 1; i < rows.length; i++) {
        const rGiai = String(rows[i][0]||'').trim();
        const rBang = String(rows[i][2]||'').trim();
        const rCode = String(rows[i][3]||'').trim();
        // Match nếu giaiId hoặc tên giải khớp
        const giaiMatch = rGiai === giai || (data.giaiName && rGiai === String(data.giaiName||'').trim());
        if (giaiMatch && rBang === bang && rCode === code) {
          sh.deleteRow(i+1);
          return jsonOk({ ok: true });
        }
      }
      return jsonOk({ ok: false, reason: 'Không tìm thấy: ' + giai + '|' + bang + '|' + code });
    }

    // Phân sân cho cả bảng (cập nhật cột Sân của tất cả trận trong bảng)
    if (action === 'assignCourtToBang') {
      const actor = requireAdminOrManager(data, ss);
      if (!actor) return jsonOk({ ok: false, reason: 'Không có quyền' });
      const sh   = getOrCreateSheet(ss, SH_MATCHES, HDR_MATCHES);
      const rows = sh.getDataRange().getValues();
      const giai = String(data.giai||'').trim();
      const nd   = String(data.nd||'').trim();
      const bang = String(data.bang||'').trim();
      const court= String(data.court||'').trim();
      if (!canAccessTournament(actor, giai))
        return jsonOk({ ok: false, reason: 'Không có quyền' });
      const ref   = String(data.ref||'').trim(); // tên trọng tài (tuỳ chọn)
      let updated = 0;
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][0]||'').trim() === giai &&
            String(rows[i][1]||'').trim() === nd   &&
            String(rows[i][2]||'').trim() === bang) {
          if (court !== '') sh.getRange(i+1, 9).setValue(court);  // col Sân (index 8)
          if (ref   !== '') sh.getRange(i+1, 11).setValue(ref);   // col GhiChú/Referee (index 10)
          updated++;
        }
      }
      return jsonOk({ ok: true, updated });
    }

    // ── PLAYER ACTIONS (Admin + Manager) ─────────────────────────

    if (action === 'addPlayer') {
      const actor = requireAdminOrManager(data, ss);
      if (!actor) return jsonOk({ ok: false, reason: 'Không có quyền' });
      const sh   = getOrCreateSheet(ss, SH_PLAYERS, HDR_PLAYERS);
      const rows = sh.getDataRange().getValues();
      const pid  = String(data.player.id||'').trim().toUpperCase();
      if (pid && rows.slice(1).find(r => String(r[0]||'').trim().toUpperCase() === pid))
        return jsonOk({ ok: false, reason: 'Mã VĐV đã tồn tại: ' + pid });
      const p = data.player;
      sh.appendRow([
        pid || 'P' + sh.getLastRow(),
        p.name||'', p.gender||'', p.dob ? new Date(p.dob) : '',
        p.club||'', p.phone||'', p.email||'',
        p.giai||'', p.category||'', p.level||'', p.note||'', p.status||'active'
      ]);
      return jsonOk({ ok: true });
    }

    if (action === 'updatePlayer') {
      const actor = requireAdminOrManager(data, ss);
      if (!actor) return jsonOk({ ok: false, reason: 'Không có quyền' });
      const sh     = getOrCreateSheet(ss, SH_PLAYERS, HDR_PLAYERS);
      const rows   = sh.getDataRange().getValues();
      const target = String(data.player.id||'').trim().toUpperCase();
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][0]||'').trim().toUpperCase() !== target) continue;
        const p = data.player;
        const fields = [,p.name,p.gender,,p.club,p.phone,p.email,p.giai,p.category,p.level,p.note,p.status];
        fields.forEach((v,col) => { if(v !== undefined && col > 0) sh.getRange(i+1,col).setValue(v); });
        if (p.dob !== undefined) sh.getRange(i+1,4).setValue(new Date(p.dob));
        return jsonOk({ ok: true });
      }
      return jsonOk({ ok: false, reason: 'Không tìm thấy VĐV' });
    }

    if (action === 'deletePlayer') {
      const actor = requireAdminOrManager(data, ss);
      if (!actor) return jsonOk({ ok: false, reason: 'Không có quyền' });
      const sh     = getOrCreateSheet(ss, SH_PLAYERS, HDR_PLAYERS);
      const rows   = sh.getDataRange().getValues();
      const target = String(data.id||'').trim().toUpperCase();
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][0]||'').trim().toUpperCase() === target) {
          sh.deleteRow(i+1);
          return jsonOk({ ok: true });
        }
      }
      return jsonOk({ ok: false, reason: 'Không tìm thấy' });
    }

    if (action === 'importPlayers') {
      const actor = requireAdminOrManager(data, ss);
      if (!actor) return jsonOk({ ok: false, reason: 'Không có quyền' });
      const sh       = getOrCreateSheet(ss, SH_PLAYERS, HDR_PLAYERS);
      const rows     = sh.getDataRange().getValues();
      const existing = new Set(rows.slice(1).map(r => String(r[0]||'').trim().toUpperCase()));
      const players  = data.players || [];
      let added = 0, skipped = 0;
      players.forEach((p, idx) => {
        const pid = String(p.id||('P'+(sh.getLastRow()+idx))).trim().toUpperCase();
        if (existing.has(pid)) { skipped++; return; }
        sh.appendRow([pid, p.name||'', p.gender||'', p.dob ? new Date(p.dob) : '',
          p.club||'', p.phone||'', p.email||'', p.giai||'', p.category||'',
          p.level||'', p.note||'', p.status||'active']);
        existing.add(pid); added++;
      });
      return jsonOk({ ok: true, added, skipped });
    }

    return jsonOk({ error: 'Unknown action: ' + action });

  } catch (err) {
    return jsonErr(err.message);
  }
}

// ════════════════════════════════════════════════════════════════
//  HANDLERS – Tách ra cho dễ đọc
// ════════════════════════════════════════════════════════════════

function handleValidate(e, ss, tz) {
  const code   = (e.parameter.code   || '').trim().toUpperCase();
  const device = (e.parameter.device || '').trim();
  const timeStr = Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy HH:mm:ss');
  if (!code) return jsonOk({ valid: false, reason: 'Thiếu mã' });

  const sh    = getOrCreateSheet(ss, SH_USERS,    HDR_USERS);
  const logSh = getOrCreateSheet(ss, SH_LOGINLOG, HDR_LOGINLOG);
  const rows  = sh.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]||'').trim().toUpperCase() !== code) continue;
    const name      = String(rows[i][1]||'').trim();
    const expireRaw = rows[i][2];
    const courts    = String(rows[i][3]||'').trim();
    const rounds    = String(rows[i][4]||'').trim();
    const statusRaw = rows[i][7];
    const status    = String(statusRaw||'').trim().toLowerCase();
    const giai      = String(rows[i][8]||'').trim();
    const noidung   = String(rows[i][9]||'').trim();

    if (status === 'khóa' || status === 'disabled') {
      logSh.appendRow([timeStr, code, name, device, '❌ Bị khóa', 'Tài khoản bị khóa', courts, rounds]);
      return jsonOk({ valid: false, reason: 'Tài khoản bị khóa', name });
    }

    // Kiểm tra hết hạn — nếu expire trống thì coi như hết hạn
    if (!expireRaw) {
      logSh.appendRow([timeStr, code, name, device, '⚠️ Hết hạn', 'Không có ngày hết hạn', courts, rounds]);
      return jsonOk({ valid: false, reason: 'Tài khoản chưa được cấp ngày hết hạn', name });
    }
    const expDate = new Date(expireRaw);
    const today   = new Date(); today.setHours(0,0,0,0);
    if (expDate < today) {
      const exp = Utilities.formatDate(expDate, tz, 'dd/MM/yyyy');
      logSh.appendRow([timeStr, code, name, device, '⚠️ Hết hạn', 'Hết hạn: ' + exp, courts, rounds]);
      return jsonOk({ valid: false, reason: 'Mã hết hạn ngày ' + exp, name });
    }

    // Sân để trống → trọng tài không thấy trận (kiểm tra ở app trọng tài)
    if (device && !String(rows[i][5]||'').trim()) sh.getRange(i+1, 6).setValue(device);
    const expFmt    = Utilities.formatDate(expDate, tz, 'dd/MM/yyyy');
    const courtList = courts ? courts.split(',').map(s=>s.trim()).filter(Boolean) : [];
    const roundList = rounds ? rounds.split(',').map(s=>s.trim()).filter(Boolean) : [];
    const isAdmin   = isAdminStatus(statusRaw);
    const isManager = isManagerStatus(statusRaw);

    // assignment: đơn vị phân quyền { giai, courts[], noidung, rounds[] }
    const assignment = { giai, courts: courtList, noidung, rounds: roundList };

    logSh.appendRow([timeStr, code, name, device, '✅ Đăng nhập',
      expFmt + (isAdmin?' [ADMIN]':isManager?' [MANAGER]':''),
      courtList.join(',') || '—', roundList.join(',') || '—',
      giai || '—', noidung || '—'
    ]);

    return jsonOk({
      valid: true, name, code, expire: expFmt,
      // backward compat
      courts: courtList, rounds: roundList, giai, noidung,
      // cấu trúc mới: assignment có giai → tránh trùng tên sân giữa các giải
      assignment,
      isAdmin, isManager,
      statusRaw: String(statusRaw||'')
    });
  }

  logSh.appendRow([timeStr, code, '–', device, '❌ Sai mã', 'Không tồn tại', '', '']);
  return jsonOk({ valid: false, reason: 'Mã không tồn tại' });
}

function handleAppend(data, ss, tz) {
  const rSh       = getOrCreateSheet(ss, SH_RESULTS, HDR_RESULTS);
  // row = [time, giai, nd, bang, code, teamA, teamB, sA, sB, winner, court, ref, rule]
  const row       = data.row || [];
  const giai      = String(row[1]||'').trim();
  const nd        = String(row[2]||'').trim();
  const bang      = String(row[3]||'').trim();
  const matchCode = String(row[4]||'').trim();
  const scoreA    = row[7];
  const scoreB    = row[8];
  const court     = String(row[10]||'').trim();
  const key       = giai+'|'+bang+'|'+matchCode;

  // Upsert vào KetQua
  const rows = rSh.getDataRange().getValues();
  let found = false;
  for (let i = 1; i < rows.length; i++) {
    const rKey = String(rows[i][1]||'')+'|'+String(rows[i][3]||'')+'|'+String(rows[i][4]||'');
    if (rKey === key) {
      rSh.getRange(i+1, 1, 1, row.length).setValues([row]);
      found = true; break;
    }
  }
  if (!found) rSh.appendRow(row);

  // Cập nhật điểm vào Matches
  updateMatchScore(ss, giai, nd, bang, matchCode, scoreA, scoreB, court);

  // Xóa khỏi LiveScore
  clearLive(ss, key);

  return jsonOk({ saved: true });
}

// BXH: tính điểm từ KetQua
function handleStandings(e, ss) {
  const giai = e.parameter.giai || '';
  const nd   = e.parameter.nd   || '';
  const bang = e.parameter.bang || '';
  const rSh  = getOrCreateSheet(ss, SH_RESULTS, HDR_RESULTS);
  const allRows = rSh.getDataRange().getValues().slice(1).filter(r =>
    (!giai || String(r[1]||'') === giai) &&
    (!nd   || String(r[2]||'') === nd)
  );

  function calcTable(rows) {
    const table = {};
    const addTeam = t => { if(!table[t]) table[t]={team:t,played:0,won:0,lost:0,pts:0,ptsFor:0,ptsAgainst:0,pDiff:0}; };
    rows.forEach(r => {
      const tA=String(r[5]||''), tB=String(r[6]||'');
      const sA=Number(r[7]||0),  sB=Number(r[8]||0);
      const win=String(r[9]||'');
      addTeam(tA); addTeam(tB);
      table[tA].played++; table[tB].played++;
      table[tA].ptsFor+=sA; table[tA].ptsAgainst+=sB;
      table[tB].ptsFor+=sB; table[tB].ptsAgainst+=sA;
      if(win===tA){table[tA].won++;table[tA].pts+=1;table[tB].lost++;}
      else if(win===tB){table[tB].won++;table[tB].pts+=1;table[tA].lost++;}
    });
    Object.values(table).forEach(t=>{ t.pDiff=t.ptsFor-t.ptsAgainst; });
    return Object.values(table)
      .sort((a,b)=>b.pts-a.pts||b.pDiff-a.pDiff||b.ptsFor-a.ptsFor)
      .map((t,i)=>({...t,rank:i+1}));
  }

  if (bang) {
    // Chọn bảng cụ thể → 1 bảng
    const rows = allRows.filter(r => String(r[3]||'')===bang);
    const standings = calcTable(rows);
    return jsonOk({ standings, groups: [{bang, nd, standings}], giai, nd, bang });
  } else {
    // Không chọn bảng → tính BXH cho từng bảng riêng
    const bangsSet = [...new Set(allRows.map(r=>String(r[3]||'')).filter(Boolean))].sort();
    if (!bangsSet.length) return jsonOk({ standings:[], groups:[], giai, nd, bang });
    const groups = bangsSet.map(bg => {
      const rows = allRows.filter(r => String(r[3]||'')===bg);
      return { bang: bg, nd: nd || String(allRows.find(r=>String(r[3]||'')===bg)?.[2]||''), standings: calcTable(rows) };
    });
    // standings flat = tất cả (để backward compat)
    const allStandings = groups.flatMap(g => g.standings);
    return jsonOk({ standings: allStandings, groups, giai, nd, bang });
  }
}

// Filter matches theo params URL
function makeFilter(params) {
  const giai  = params.giai  || '';
  const nd    = params.nd    || '';
  const bang  = params.bang  || '';
  const court = params.court || '';
  const round = params.round || '';
  const code  = params.refCode || '';
  return (r) =>
    (!giai  || String(r[0]||'') === giai)  &&
    (!nd    || String(r[1]||'') === nd)    &&
    (!bang  || String(r[2]||'') === bang)  &&
    (!court || String(r[8]||'').toLowerCase().includes(court.toLowerCase())) &&
    (!round || String(r[9]||'').toLowerCase().includes(round.toLowerCase()));
}

// Dashboard data
function handleDashboard(e, ss, actor, tz) {
  const giaiParam = e.parameter.giai || '';
  const nd        = e.parameter.nd   || '';
  const bang      = e.parameter.bang || '';

  // Tìm tên giải từ Tournaments (admin gửi lên có thể là tên hoặc mã)
  const tSh   = getOrCreateSheet(ss, SH_TOURNAMENTS, HDR_TOURN);
  const tRows = tSh.getDataRange().getValues().slice(1);
  function resolveGiaiName(val) {
    if (!val) return '';
    // Thử khớp theo tên trước
    const byName = tRows.find(r => String(r[1]||'').trim() === val.trim());
    if (byName) return String(byName[1]||'').trim();
    // Thử khớp theo mã
    const byId = tRows.find(r => String(r[0]||'').trim() === val.trim());
    if (byId) return String(byId[1]||'').trim();
    return val; // fallback
  }

  // Manager chỉ xem giải của mình
  const rawFilterGiai = actor.role === 'manager' ? actor.giai : giaiParam;
  const filterGiai = resolveGiaiName(rawFilterGiai); // luôn là tên giải

  const mSh   = getOrCreateSheet(ss, SH_MATCHES,     HDR_MATCHES);
  const rSh   = getOrCreateSheet(ss, SH_RESULTS,     HDR_RESULTS);
  const lSh   = getOrCreateSheet(ss, SH_LIVE,        HDR_LIVE);
  const uSh   = getOrCreateSheet(ss, SH_USERS,       HDR_USERS);
  const logSh = getOrCreateSheet(ss, SH_LOGINLOG,    HDR_LOGINLOG);

  // Lọc Matches theo giải (tên) + nd + bang
  const allMRows = mSh.getDataRange().getValues().slice(1);
  const mRows = allMRows.filter(r =>
    (!filterGiai || String(r[0]||'').trim() === filterGiai) &&
    (!nd   || String(r[1]||'').trim() === nd)   &&
    (!bang || String(r[2]||'').trim() === bang)
  );
  // Map key→giai từ Matches để fallback cho LiveScore cũ (r[1] rỗng)
  const matchKeyToGiai = {};
  allMRows.forEach(mr => { const mk=String(mr[1]||'')+'|'+String(mr[2]||'')+'|'+String(mr[3]||''); matchKeyToGiai[mk]=String(mr[0]||''); });
  const rRows = rSh.getDataRange().getValues().slice(1).filter(r =>
    (!filterGiai || String(r[1]||'').trim() === filterGiai) &&
    (!nd   || String(r[2]||'').trim() === nd)   &&
    (!bang || String(r[3]||'').trim() === bang)
  );
  // ══════════════════════════════════════════════════════
  // NGUỒN SỰ THẬT DUY NHẤT: LiveScore sheet
  //   playing  → đang thi đấu (live)
  //   finished → đã kết thúc  (không live)
  //   không có row → chưa đấu
  //
  // "done" = có trong KetQua VÀ KHÔNG đang playing trong LiveScore
  // "live" = status='playing' trong LiveScore  ← ưu tiên tuyệt đối
  // ══════════════════════════════════════════════════════

  const allLiveRawRows = lSh.getDataRange().getValues().slice(1);

  // Build Set liveKey của các trận đang 'playing' (source of truth)
  const playingKeys = new Set(); // noidung|bang|code đang playing
  allLiveRawRows.forEach(function(r) {
    if (String(r[9]||'') !== 'playing') return;
    const lKey = String(r[0]||'');
    if (lKey) playingKeys.add(lKey);
  });

  // lRows: chỉ các row status='playing', lọc theo giải nếu có
  const lRows = allLiveRawRows.filter(function(r) {
    if (String(r[9]||'') !== 'playing') return false; // chỉ lấy playing
    if (!String(r[0]||'')) return false;
    if (filterGiai) {
      const g = String(r[1]||'') || matchKeyToGiai[String(r[0]||'')] || '';
      if (g !== filterGiai) return false;
    }
    return true;
  });

  // doneBangCode: bang|code đã có KetQua VÀ không đang playing
  // → dùng để count "done" cho progress bar (không dùng để filter lRows nữa)
  const doneBangCode = {};
  rRows.forEach(function(r) {
    const bg = String(r[3]||'').trim(), cd = String(r[4]||'').trim();
    if (!bg || !cd) return;
    const lk = String(r[2]||'') + '|' + bg + '|' + cd; // nd|bang|code
    // Chỉ count là "done" nếu KHÔNG đang playing lại
    if (!playingKeys.has(lk)) doneBangCode[bg + '|' + cd] = true;
  });
  const uRows = uSh.getDataRange().getValues().slice(1);
  const logRows = logSh.getDataRange().getValues().slice(1);
  // tRows đã khai báo ở đầu hàm (dùng cho resolveGiaiName + tournaments list)

  // Summary
  const totalMatches   = mRows.length;
  // liveKeys = noidung|bang|code đang playing (từ lRows đã filter)
  const liveKeys       = new Set(lRows.map(function(r) { return String(r[0]||''); }));
  // doneMatches = số trận có KetQua VÀ không đang playing lại
  const doneMatches    = rRows.filter(function(r) {
    const nd = String(r[2]||'').trim(), bg = String(r[3]||'').trim(), cd = String(r[4]||'').trim();
    const lk = nd + '|' + bg + '|' + cd;
    return !playingKeys.has(lk); // đang đánh lại → không count là done
  }).length;
  const liveMatches    = lRows.length;
  const totalRefs      = uRows.filter(r => String(r[7]||'').toLowerCase() === 'active').length;
  const today          = Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy');
  const todayLogins    = logRows.filter(r => String(r[0]||'').startsWith(today) && String(r[4]||'').includes('✅')).length;
  const adminUsers     = uRows.filter(r => String(r[7]||'').toLowerCase() === 'admin').length;
  const managerUsers   = uRows.filter(r => String(r[7]||'').toLowerCase() === 'manager').length;
  const lockedUsers    = uRows.filter(r => ['khóa','disabled'].includes(String(r[7]||'').toLowerCase())).length;

  // Tournaments list (for filter) — tRows đã được khai báo ở trên
  const tournaments = tRows.map(r => ({
    id: r[0], name: r[1], venue: r[2], courts: r[3],
    startDate: r[4], endDate: r[5], status: r[6], note: r[7]
  }));

  // Build map Matches: "giai|bang|code" -> {court}
  const matchCourtMap = {};
  allMRows.forEach(function(mr) {
    var mk = String(mr[0]||'') + '|' + String(mr[2]||'') + '|' + String(mr[3]||'');
    matchCourtMap[mk] = String(mr[8]||'');
  });

  // Build map KetQua: "giai|bang|code" -> referee (col 11)
  const allRRows2 = rSh.getDataRange().getValues().slice(1);
  const refMap = {};
  allRRows2.forEach(function(r) {
    var rk = String(r[1]||'') + '|' + String(r[3]||'') + '|' + String(r[4]||'');
    if (!refMap[rk] && String(r[11]||'')) refMap[rk] = String(r[11]||'');
  });

  // Live detail -- parse key = "noidung|bang|code"
  const liveDetail = lRows.map(function(r) {
    var key   = String(r[0]||'');
    var parts = key.split('|');
    var nd    = parts[0] || '';
    var bang  = parts[1] || '';
    var code  = parts.length >= 3 ? parts.slice(2).join('|') : (parts[1]||'');
    var giai  = String(r[1]||'');
    var mk    = giai + '|' + bang + '|' + code;
    return {
      key: key, giai: giai, nd: nd, bang: bang, code: code,
      teamA:   r[2], scoreA: r[3],
      scoreB:  r[4], teamB:  r[5],
      serve:   r[6], game:   r[7], updated: r[8],
      court:   matchCourtMap[mk]  || '',
      referee: refMap[mk]         || '',
    };
  });

  // Group by Giải > Nội dung > Bảng
  const tree = {};
  mRows.forEach(r => {
    const g  = String(r[0]||''), nd = String(r[1]||''), bg = String(r[2]||'');
    const code = String(r[3]||'');
    const bc   = bg + '|' + code;           // bang|code
    const lk   = nd + '|' + bg + '|' + code; // noidung|bang|code (LiveScore key)
    if (!tree[g])        tree[g]        = { name: g, noidungs: {} };
    if (!tree[g].noidungs[nd]) tree[g].noidungs[nd] = { bangs: {} };
    if (!tree[g].noidungs[nd].bangs[bg]) tree[g].noidungs[nd].bangs[bg] = { total:0, done:0, live:0 };
    tree[g].noidungs[nd].bangs[bg].total++;
    // done: có KetQua VÀ không đang playing lại
    if (doneBangCode[bc]) tree[g].noidungs[nd].bangs[bg].done++;
    // live: đang playing trong LiveScore (source of truth)
    if (liveKeys.has(lk)) tree[g].noidungs[nd].bangs[bg].live++;
  });

  // Flatten for categories display
  const categories = [];
  Object.values(tree).forEach(g => {
    Object.entries(g.noidungs).forEach(([nd, nv]) => {
      let total=0,done=0,live=0;
      const bangs = [];
      Object.entries(nv.bangs).forEach(([bg,bv]) => {
        total+=bv.total; done+=bv.done; live+=bv.live;
        bangs.push(bg);
      });
      categories.push({ giai:g.name, name:nd, bangs, total, done, live,
        pct: Math.round(done/total*100)||0 });
    });
  });

  // Nội dung và bảng có trong giải đang lọc (để populate dropdown)
  const noidungs = [...new Set(allMRows
    .filter(r => !filterGiai || String(r[0]||'').trim() === filterGiai)
    .map(r => String(r[1]||'').trim()).filter(Boolean))].sort();
  const bangs = [...new Set(allMRows
    .filter(r => {
      if (filterGiai && String(r[0]||'').trim() !== filterGiai) return false;
      if (nd && String(r[1]||'').trim() !== nd) return false;
      return true;
    })
    .map(r => String(r[2]||'').trim()).filter(Boolean))].sort();

  return jsonOk({
    summary: { totalMatches, doneMatches, liveMatches, totalRefs,
               adminUsers, managerUsers, lockedUsers, todayLogins },
    liveDetail,
    categories,
    tournaments,
    noidungs,
    bangs,
    filterGiai,
    filterNd: nd,
    filterBang: bang,
    tree,
    recentResults: rRows.slice(-15).reverse().map(r => ({
      time:r[0], giai:r[1], nd:r[2], bang:r[3], code:r[4],
      teamA:r[5], teamB:r[6], scoreA:r[7], scoreB:r[8], winner:r[9]
    }))
  });
}

// ════════════════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════════════════

function getOrCreateSheet(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    const hdr = sh.getRange(1, 1, 1, headers.length);
    hdr.setFontWeight('bold');
    hdr.setBackground('#0369a1');
    hdr.setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}

// Cập nhật Điểm A/B trong sheet Matches sau khi kết thúc trận
// ── FIX Bug trùng sân: bắt buộc khớp đủ giai+nd+bang+code ──
// Các giải khác nhau có thể dùng cùng tên sân (A1, Sân 1...) và cùng mã trận (A1, B1...)
// → phải khớp giai+nd để tránh ghi nhầm tỉ số sang giải khác
function updateMatchScore(ss, giai, nd, bang, matchCode, scoreA, scoreB, court) {
  try {
    const sh   = ss.getSheetByName(SH_MATCHES);
    if (!sh) return;
    const rows = sh.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      const rGiai = String(rows[i][0]||'').trim();
      const rNd   = String(rows[i][1]||'').trim();
      const rBang = String(rows[i][2]||'').trim();
      const rCode = String(rows[i][3]||'').trim();
      // Phải khớp đủ 4 trường: giai + nd + bang + code
      // rGiai so với giai (tên giải) — KetQua luôn lưu tên giải
      if (rGiai === giai && rNd === nd && rBang === bang && rCode === matchCode) {
        sh.getRange(i+1, 6).setValue(scoreA); // Điểm A col 6
        sh.getRange(i+1, 7).setValue(scoreB); // Điểm B col 7
        if (court && !String(rows[i][8]||'').trim()) sh.getRange(i+1, 9).setValue(court);
        break;
      }
    }
  } catch(e) { Logger.log('updateMatchScore error: ' + e.message); }
}

// Xóa row trong LiveScore theo key — chỉ đọc cột Key, không đọc toàn bộ sheet
function clearLive(ss, key) {
  try {
    const sh = ss.getSheetByName(SH_LIVE);
    if (!sh || sh.getLastRow() <= 1) return;
    // Xóa cache row index
    try {
      const cKey = 'LIVE_ROW_' + key.replace(/[^a-zA-Z0-9_]/g, '_');
      PropertiesService.getScriptProperties().deleteProperty(cKey);
    } catch(ep) {}
    // Đọc chỉ cột Key (cột 1), không đọc toàn sheet
    const lastRow = sh.getLastRow();
    if (lastRow <= 1) return;
    const keyCol = sh.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = keyCol.length - 1; i >= 0; i--) {
      if (String(keyCol[i][0]||'').trim() === key.trim()) sh.deleteRow(i + 2);
    }
  } catch(e) {}
}


// ── Helper: gán tên giải vào Users.giai (cột 9) cho danh sách mã TT ──
function _assignRefsGiai(ss, refCodes, giaiName) {
  try {
    const sh   = getOrCreateSheet(ss, SH_USERS, HDR_USERS);
    const rows = sh.getDataRange().getValues();
    const codes = refCodes.map(c => String(c).trim().toUpperCase());
    for (let i = 1; i < rows.length; i++) {
      const code = String(rows[i][0]||'').trim().toUpperCase();
      if (codes.includes(code)) {
        sh.getRange(i+1, 9).setValue(giaiName);
      }
    }
  } catch(e) { Logger.log('_assignRefsGiai error: ' + e.message); }
}
// Dọn LiveScore: row 'playing' cũ > 4 tiếng, row 'finished' cũ > 1 tiếng (chạy qua Time Trigger)
function cleanStaleLive() {
  try {
    const ss  = SpreadsheetApp.openById(SS_ID);
    const sh  = ss.getSheetByName(SH_LIVE);
    if (!sh || sh.getLastRow() <= 1) return;
    const now  = new Date();
    const lastRow = sh.getLastRow();
    if (lastRow <= 1) return;
    // Chỉ đọc 3 cột cần thiết: Key(1), Cập nhật lúc(9), Trạng thái(10)
    const data = sh.getRange(2, 1, lastRow - 1, 10).getValues();
    const props = PropertiesService.getScriptProperties();
    for (let i = data.length - 1; i >= 0; i--) {
      const key    = String(data[i][0] || '');
      const tsRaw  = String(data[i][8] || '');
      const status = String(data[i][9] || '');
      if (!tsRaw) { sh.deleteRow(i + 2); continue; }
      const parts = tsRaw.split(':');
      if (parts.length < 2) { sh.deleteRow(i + 2); continue; }
      const ref = new Date();
      ref.setHours(parseInt(parts[0]||0), parseInt(parts[1]||0), parseInt(parts[2]||0), 0);
      const ageMin = (now - ref) / 60000;
      const threshold = (status === 'finished') ? 60 : 240;
      if (ageMin > threshold) {
        Logger.log('cleanStaleLive: xóa ' + key + ' status=' + status + ' updated=' + tsRaw);
        sh.deleteRow(i + 2);
        // Xóa cache row index tương ứng
        if (key) {
          try { props.deleteProperty('LIVE_ROW_' + key.replace(/[^a-zA-Z0-9_]/g, '_')); } catch(ep) {}
        }
      }
    }
  } catch(e) { Logger.log('cleanStaleLive error: ' + e.message); }
}

// Cài Time Trigger tự động dọn LiveScore mỗi 30 phút — chạy 1 lần
function setupLiveTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'cleanStaleLive') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('cleanStaleLive').timeBased().everyMinutes(30).create();
  Logger.log('✅ Trigger cleanStaleLive mỗi 30 phút đã được cài');
}

function jsonOk(obj) {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, ...obj }))
    .setMimeType(ContentService.MimeType.JSON);
}
function jsonErr(msg) {
  return ContentService.createTextOutput(JSON.stringify({ ok: false, error: msg }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ════════════════════════════════════════════════════════════════
//  SETUP – Chạy 1 lần để khởi tạo sheets + dữ liệu mẫu 3 giải
// ════════════════════════════════════════════════════════════════
function setupSampleData() {
  const ss = SpreadsheetApp.openById(SS_ID);

  // Tạo tất cả sheets
  [SH_TOURNAMENTS,SH_USERS,SH_MATCHES,SH_RESULTS,SH_LIVE,SH_EVENTS,SH_LOGINLOG,SH_PLAYERS].forEach(name => {
    const hdr = name === SH_TOURNAMENTS ? HDR_TOURN :
                name === SH_USERS       ? HDR_USERS :
                name === SH_MATCHES     ? HDR_MATCHES :
                name === SH_RESULTS     ? HDR_RESULTS :
                name === SH_LIVE        ? HDR_LIVE :
                name === SH_EVENTS      ? HDR_EVENTS :
                name === SH_LOGINLOG    ? HDR_LOGINLOG : HDR_PLAYERS;
    getOrCreateSheet(ss, name, hdr);
  });

  // ── Tournaments mẫu (3 giải đấu) ──
  const tSh = ss.getSheetByName(SH_TOURNAMENTS);
  if (tSh.getLastRow() <= 1) {
    tSh.appendRow(['NH2025',  'Giải Ngân Hàng 2025',       'Sân AK',       'Sân 1,Sân 2,Sân 3,Sân 4,Sân 5,Sân 6,Sân 7,Sân 8,Sân 9,Sân 10', '2025-06-01','2025-06-02','active','']);
    tSh.appendRow(['BDS2025', 'Giải Hội Nhóm BĐS 2025',   'Sân Trường Sơn','Sân 1,Sân 2,Sân 3,Sân 4,Sân 5,Sân 6,Sân 7,Sân 8,Sân 9,Sân 10','2025-06-03','2025-06-04','active','']);
    tSh.appendRow(['BMY2025', 'Giải Tiệm Bánh Mỳ 2025',   'Sân Tuyên Sơn','A1,A2,A3,A4,A5,A6,A7,A8,A9,A10,B1,B2,B3,B4,B5,B6,B7,B8,B9,B10', '2025-06-05','2025-06-06','active','']);
  }

  // ── Users mẫu ──
  const uSh = ss.getSheetByName(SH_USERS);
  if (uSh.getLastRow() <= 1) {
    uSh.appendRow(['ADMIN01','Admin Tổng',   new Date('2026-12-31'),'','','','Quản trị viên',   'admin',  '',       '']);
    uSh.appendRow(['MGR001', 'Manager NH',   new Date('2026-12-31'),'','','','Quản lý Ngân Hàng','manager','NH2025', '']);
    uSh.appendRow(['MGR002', 'Manager BĐS',  new Date('2026-12-31'),'','','','Quản lý BĐS',     'manager','BDS2025','']);
    uSh.appendRow(['MGR003', 'Manager BMY',  new Date('2026-12-31'),'','','','Quản lý Bánh Mỳ', 'manager','BMY2025','']);
    uSh.appendRow(['REF001', 'Nguyễn Văn An',new Date('2026-12-31'),'Sân 1,Sân 2','Vòng bảng','','TT giải NH','active','NH2025','Đôi Nam 7.0']);
    uSh.appendRow(['REF002', 'Trần Thị Bình',new Date('2026-12-31'),'Sân 3,Sân 4','Vòng bảng','','TT giải NH','active','NH2025','Đôi Nữ Vui Vẻ']);
    uSh.appendRow(['REF003', 'Lê Văn Cường', new Date('2026-12-31'),'Sân 1,Sân 2','Vòng bảng','','TT giải BĐS','active','BDS2025','Đôi Hỗn Hợp 5.6']);
    uSh.appendRow(['REF004', 'Phạm Thị Dung',new Date('2026-12-31'),'A1,A2,A3',   'Vòng bảng','','TT giải BMY','active','BMY2025','Đôi Nam Bánh Mỳ 5.5']);
  }

  // ── Matches mẫu (Giải NH) ──
  const mSh = ss.getSheetByName(SH_MATCHES);
  if (mSh.getLastRow() <= 1) {
    mSh.appendRow(['NH2025','Đôi Nam 7.0',     'Bảng A','A1','Đội 1','','','Đội 2','Sân 1','Vòng bảng','']);
    mSh.appendRow(['NH2025','Đôi Nam 7.0',     'Bảng A','A2','Đội 3','','','Đội 4','Sân 2','Vòng bảng','']);
    mSh.appendRow(['NH2025','Đôi Nữ Vui Vẻ',  'Bảng A','B1','Đội 5','','','Đội 6','Sân 3','Vòng bảng','']);
    mSh.appendRow(['BDS2025','Đôi Hỗn Hợp 5.6','Bảng A','C1','Đội 7','','','Đội 8','Sân 1','Vòng bảng','']);
    mSh.appendRow(['BMY2025','Đôi Nam Bánh Mỳ 5.5','Bảng A','D1','Đội 9','','','Đội 10','A1','Vòng bảng','']);
  }

  // Autofit columns
  [SH_TOURNAMENTS,SH_USERS,SH_MATCHES,SH_RESULTS,SH_LIVE,SH_LOGINLOG,SH_PLAYERS].forEach(name => {
    const sh = ss.getSheetByName(name);
    if (sh && sh.getLastColumn() > 0) sh.autoResizeColumns(1, sh.getLastColumn());
  });

  Logger.log('✅ Setup v3 hoàn tất! 3 giải mẫu + Users đầy đủ role admin/manager/active.');
  Logger.log('👉 Nhớ chạy setupLiveTrigger() để bật auto-clean LiveScore mỗi 30 phút.');
}
// ════════════════════════════════════════════════════════════════
//  BATCH GET — Trả nhiều action trong 1 request duy nhất
//  GET ?action=batch&actions=tournaments,matches,results,live
//      &giai=...&code=all
//  → { ok:true, tournaments:{...}, matches:{...}, results:{...}, live:{...} }
// ════════════════════════════════════════════════════════════════
function handleBatch(e, ss) {
  const wantedStr = e.parameter.actions || '';
  const wanted = wantedStr.split(',').map(s=>s.trim()).filter(Boolean);
  const out = {};

  wanted.forEach(a => {
    try {
      const fakeE = { parameter: Object.assign({}, e.parameter, { action: a }) };
      if (a === 'tournaments') {
        const sh = getOrCreateSheet(ss, SH_TOURNAMENTS, HDR_TOURN);
        out.tournaments = { rows: sh.getDataRange().getValues() };
      } else if (a === 'matches') {
        const sh   = getOrCreateSheet(ss, SH_MATCHES, HDR_MATCHES);
        const rows = sh.getDataRange().getValues();
        const f    = makeFilter(e.parameter);
        out.matches = { rows: [rows[0], ...rows.slice(1).filter(r=>f(r))] };
      } else if (a === 'results') {
        const sh   = getOrCreateSheet(ss, SH_RESULTS, HDR_RESULTS);
        const rows = sh.getDataRange().getValues();
        const giai = e.parameter.giai || '';
        const nd   = e.parameter.nd   || '';
        const bang = e.parameter.bang || '';
        const filtered = rows.slice(1).filter(r =>
          (!giai || String(r[1]||'') === giai) &&
          (!nd   || String(r[2]||'') === nd)   &&
          (!bang || String(r[3]||'') === bang)
        );
        out.results = { rows: [rows[0], ...filtered] };
      } else if (a === 'live') {
        const sh   = getOrCreateSheet(ss, SH_LIVE, HDR_LIVE);
        const rows = sh.getDataRange().getValues();
        const giai = e.parameter.giai || '';
        const liveRows = giai ? rows.slice(1).filter(r=>String(r[1]||'')===giai) : rows.slice(1);
        out.live = { rows: [rows[0], ...liveRows] };
      }
    } catch(err) {
      out[a] = { error: err.message };
    }
  });

  return jsonOk(out);
}