# Flow Tools Chrome Extension

Tiện ích Chrome Manifest V3 gồm 2 chức năng:

- Quét URL video hiển thị trong Google Flow và tải bằng Chrome Downloads.
- Nạp file TXT, mỗi dòng là 1 prompt, sau đó gửi hàng loạt vào ô prompt của Flow.
- Tùy chỉnh tốc độ quét, tốc độ tải, tiền tố tên file và độ trễ khi chạy prompt.
- Kéo thả panel, ghi nhớ tab đang mở, trạng thái thu gọn và vị trí panel.

Chỉ dùng với nội dung và tài khoản bạn có quyền truy cập.

## Cài đặt

1. Mở Chrome và vào `chrome://extensions`.
2. Bật `Developer mode`.
3. Chọn `Load unpacked`.
4. Chọn thư mục này: `D:\AUTO FLOW AI`.
5. Mở Google Flow, bấm icon `Flow Tools` trên thanh extension.

## Cách dùng

Tab `Công cụ` - phần tải video:

1. Bấm `Tải video`.
2. Tiện ích sẽ tự xóa danh sách cũ, quét lại video từ đầu rồi tải toàn bộ.
3. Khi đang chạy, nút sẽ đổi thành `Dừng tải`.
4. Bấm `Dừng tải` nếu muốn dừng quá trình quét hoặc tải hiện tại.
5. Sau khi dừng hoặc tải xong, nút sẽ đổi lại thành `Tải video`.

Tab `Công cụ` - phần prompt hàng loạt:

1. Bấm `Nhập tệp TXT`.
2. Chọn file `.txt`, mỗi dòng là 1 prompt.
3. Hoặc dán prompt trực tiếp vào ô `Nhập prompt`, mỗi dòng là 1 prompt.
4. Bấm `Bắt đầu` để chạy batch.
5. Khi đang chạy, nút `Bắt đầu` sẽ đổi thành `Tạm dừng`.
6. Bấm `Tạm dừng` thì nút đổi thành `Tiếp tục`; bấm `Tiếp tục` để chạy tiếp.
7. Bấm `Dừng` để dừng hẳn và đưa nút chính về `Bắt đầu`.
8. Bấm `Xóa nhật ký` để làm sạch vùng log.
9. Nếu bật `Tự tải video sau mỗi prompt`, sau khi gửi từng prompt tool sẽ chờ video mới xuất hiện và tải về trước khi chạy prompt tiếp theo.

Tab `Cài đặt`:

1. Đổi `Tiền tố tên file` nếu muốn tên file tải xuống có tiền tố riêng.
2. Tăng `Nghỉ giữa mỗi file tải` nếu Chrome hoặc Flow giới hạn tải quá nhanh.
3. Tăng `Nghỉ giữa mỗi prompt` nếu Flow cần thêm thời gian xử lý.
4. Bấm `Lưu cài đặt`; tiện ích sẽ ghi nhớ cho lần mở sau.
5. Bấm `Khôi phục mặc định` nếu muốn quay lại cấu hình ban đầu.
6. Bấm `Cài đặt tải xuống` để mở trang `chrome://settings/downloads`.
7. Bật `Giữ tab Flow hoạt động` nếu muốn tool chạy nhanh khi Chrome định làm chậm tab nền. Khi bật, Chrome có thể tự đưa tab Flow về trước trong lúc đang chạy.
8. Bật `Tự tải video sau mỗi prompt` nếu muốn chạy prompt nào xong thì tải video mới của prompt đó ngay.

Các cài đặt thời gian trong giao diện đều tính bằng giây.
Nút `−` ở góc phải dùng để thu gọn panel, nút `+` dùng để mở rộng lại.
Giữ chuột vào phần tiêu đề panel để kéo panel sang vị trí khác.

## Ghi chú kỹ thuật

- Extension không export HTML.
- Phần tải file dùng `chrome.downloads.download`, nên ổn định hơn so với tạo blob và click thẻ `a`.
- Nếu Google Flow đổi DOM, có thể cần cập nhật selector trong `content.js`.

## License online

Tool có lớp kiểm tra license online trước khi mở panel và trước khi chạy tác vụ chính.

1. Tạo Cloudflare Worker từ file `license-worker-example.js`.
2. Tạo secret `LICENSES_JSON` chứa danh sách key.
3. Deploy Worker.
4. Mở `content.js` và đổi `licenseApiUrl` thành URL Worker thật, ví dụ:

```js
licenseApiUrl: "https://flow-tools-license.pqchien1905.workers.dev/verify"
```

5. Gửi extension cho người dùng và cấp license key.
6. Muốn thu hồi ai thì đổi key đó thành `active: false` trong secret `LICENSES_JSON` rồi deploy lại.

Ví dụ giá trị `LICENSES_JSON`:

```json
{
  "FLOW-KHACH-001": {
    "active": true,
    "name": "Khach 001"
  }
}
```

Không commit license key thật vào GitHub. Các key đã từng được push lên GitHub nên được xem là đã lộ và cần đổi key mới.

Lưu ý: nếu gửi source code đầy đủ cho người dùng kỹ thuật cao, họ vẫn có thể sửa code để bỏ kiểm tra license. License online giúp quản lý người dùng thông thường, không phải cơ chế chống crack tuyệt đối.
