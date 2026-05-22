Link app: https://chandat86.github.io/UAT-PickleBall-Test/

https://script.google.com/macros/s/AKfycbyLujKd3ONX6RZffuMaHSWKgGCGN6k6dAwp3kEEw05Shs6u4jctSpwe6-B7tw8yTCKL/exec


\Hướng dẫn đổi URL khi có GAS mới:
Cách 1 — Vĩnh viễn (khuyến nghị): Mở file HTML, tìm dòng:
javascriptconst _EMBEDDED_GS_URL = 'https://script.google.com/macros/s/AKfycb...';
Thay URL mới vào → lưu file → xong
Cách 2 — Tạm thời: Trong app → mở GS card → click ⚙️ Đổi URL GAS → nhập URL mới → 💾 Lưu (giữ đến khi clear cache)
- link Google app Script UAT: const _EMBEDDED_GS_URL = 'https://script.google.com/macros/s/AKfycbyLujKd3ONX6RZffuMaHSWKgGCGN6k6dAwp3kEEw05Shs6u4jctSpwe6-B7tw8yTCKL/exec';
-------Update UAT-Pickleball-V2 ------------
- Thêm BXH
- Chỉnh lại ô chọn trận đấu.
---- v2.1 ------
  - Update BXH lay ket qua tu GGSheet
  - 

--- Version v2.3 ----
- Update BXH: không ghi thêm dữ liệu kết quả 2 lần, ghi đè lên update.

- --- version v2.4 ---
#Yêu cầu Thay đổi
1 Poll 10s thay vì 5s   ---> POLL_FOCUSED=10000, POLL_BACKGROUND=60000
2 Tải trận realtime + phát hiện thay đổi tỉ số   ----> Poll cũng so sánh matchScoreA/B để cập nhật tỉ số live
3 Trạng thái trận: Chưa/Đang/Hoàn thành  --->  ⬜ Chưa thi đấu · 🟠 Đang thi đấu · ✅ Hoàn thành
4 Badge chỉ hiện số trận bảng đó  ---> Bỏ /tổng
5 Ẩn danh sách khi chưa chọn nội dung/bảng  --> Hiện hướng dẫn và tổng số trận
6 Bỏ Game Tiếp, thêm Bắt đầu   ----> Thứ tự: Bắt đầu · Undo · Lưu · Reset
  7 Chưa Bắt đầu → không nhập điểm được  ---> not-started class disable sc-btn
  8 Nút xóa kết quả localclear   --->  Results() — chỉ xóa local, không xóa GSheets
  9 Quy tắc vào Cài đặt dạng dropdown   ---> + thêm Chạm 21, Chạm 25
  10 Danh sách trận tự thu gọn  ---> Chỉ hiện khi chọn đủ Nội dung + Bảng
  11 Nút GSheet đã được chuyển vào card GS, nằm sau nút "🔄 Tải trận + kết quả". Header giờ chỉ còn logo + tên app, gọn hơn.
