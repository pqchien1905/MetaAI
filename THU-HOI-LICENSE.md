# Thu hoi va quan ly license

Tai lieu nay dung cho Worker hien tai trong `license-worker-example.js`.

Co che dang ap dung:

- Moi khach nen co mot license key rieng.
- Key co `active: true` moi duoc kich hoat.
- Lan kich hoat dau tien se gan key voi mot `deviceId` va luu vao Cloudflare KV `LICENSE_BINDINGS`.
- May khac nhap lai cung key se bi tu choi.
- Nguoi dung co the bam `Huy lien ket license` trong tool de chuyen key sang may khac.
- Moi lan tool kiem tra license thanh cong, Worker se cap nhat `lastSeenAt` va gia han
  binding them 7 ngay.
- Neu nguoi dung go tien ich ma khong bam `Huy lien ket license`, binding se tu het han
  sau 7 ngay khong hoat dong. Khi do key co the kich hoat lai tren may khac.

Worker dang chay tai:

```text
https://flow-tools-license.pqchien1905.workers.dev
```

## 1. Them license moi

Khong luu key that trong source code. Tao hoac cap nhat Cloudflare secret
`LICENSES_JSON`:

```json
{
  "FLOW-KHACH-001": {
    "active": true,
    "name": "Khach 001"
  },
  "FLOW-KHACH-002": {
    "active": true,
    "name": "Khach 002"
  }
}
```

Lenh dat secret:

```powershell
npx.cmd wrangler secret put LICENSES_JSON
```

Sau khi cap nhat secret xong, deploy lai Worker:

```powershell
npx.cmd wrangler deploy
```

## 2. Thu hoi license vinh vien

Dung cach nay khi khach het han, vi pham, hoac ban muon khoa key khong cho dung nua.

Vi du key dang hoat dong:

```json
"FLOW-KHACH-001": {
  "active": true,
  "name": "Khach 001"
}
```

Doi trong `LICENSES_JSON` thanh:

```json
"FLOW-KHACH-001": {
  "active": false,
  "name": "Khach 001"
}
```

Deploy lai Worker:

```powershell
npx.cmd wrangler deploy
```

Tu lan kiem tra tiep theo, tool goi:

```text
POST https://flow-tools-license.pqchien1905.workers.dev/verify
```

Worker se tra:

```json
{
  "active": false,
  "message": "License da bi thu hoi."
}
```

Va tool se khong cho su dung.

## 3. Mo khoa cho khach doi may

Neu khach van duoc dung license nhung muon chuyen sang may khac, khong can dat
`active: false`. Chi can xoa lien ket trong KV.

Cach de khach tu lam:

1. Khach mo tool tren may cu.
2. Vao tab `Cai dat`.
3. Bam `Huy lien ket license`.
4. Sang may moi, nhap lai cung key do.

Worker chi cho may dang giu key duoc huy lien ket. May khac khong the huy thay.

## 4. Mo khoa doi may thu cong

Neu khach khong con truy cap duoc may cu, ban co the xoa binding truc tiep trong KV.

Lenh:

```powershell
npx.cmd wrangler kv key delete "license:FLOW-KHACH-001" --binding LICENSE_BINDINGS
```

Sau do key `FLOW-KHACH-001` co the kich hoat lai tren may moi.

Luu y: lenh nay chi xoa lien ket may, khong thu hoi key. Neu key trong `LICENSES`
van la `active: true`, key do van dung duoc.

## 5. Xem key dang luu trong KV

Liet ke cac license da duoc gan may:

```powershell
npx.cmd wrangler kv key list --binding LICENSE_BINDINGS --prefix "license:"
```

Xem chi tiet mot key:

```powershell
npx.cmd wrangler kv key get "license:FLOW-KHACH-001" --binding LICENSE_BINDINGS
```

Du lieu mau trong KV:

```json
{
  "deviceId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "licenseKey": "FLOW-KHACH-001",
  "name": "Khach 001",
  "extensionId": "abcdefghijk",
  "version": "1.0.0",
  "boundAt": "2026-05-13T16:00:00.000Z",
  "lastSeenAt": "2026-05-18T10:00:00.000Z",
  "expiresAt": "2026-05-25T10:00:00.000Z"
}
```

## 6. Cac endpoint cua Worker

`POST /verify`

- Kiem tra key co ton tai khong.
- Kiem tra `active`.
- Neu key chua gan may, tu dong gan voi `deviceId` dau tien.
- Neu key da gan may khac va binding chua het han, tu choi.
- Neu binding cu da het han, may moi duoc kich hoat lai key.
- Neu dung may dang giu key, Worker cap nhat `lastSeenAt` va gia han `expiresAt`.

`POST /unlink`

- Huy lien ket key khoi may hien tai.
- Chi may dang giu key moi huy duoc.
- Sau khi huy, key co the kich hoat tren may khac.

## 7. Nen quan ly key nhu the nao

Nen cap moi khach mot key rieng:

```js
"FLOW-NGUYEN-VAN-A": {
  active: true,
  name: "Nguyen Van A"
},
"FLOW-TRAN-VAN-B": {
  active: true,
  name: "Tran Van B"
}
```

Khong nen cho nhieu khach dung chung mot key. Khi can thu hoi, ban chi can doi
key cua khach do thanh `active: false` va deploy lai Worker.

## 8. Truong hop khach go tien ich nhung quen huy key

Chrome extension khong co hook uninstall dang tin cay de goi API huy key. Vi vay
khong nen khoa key vinh vien theo `deviceId`.

Worker hien tai dung co che tu het han:

- Tool con duoc dung: moi lan `/verify` se gia han binding them 7 ngay.
- Tool bi go hoac may cu khong con dung: khong con `/verify`, binding tu het han
  trong KV sau 7 ngay.
- Neu khach can chuyen may gap hon, ban xoa binding thu cong bang lenh o muc 4.
- Cac binding cu chua co `expiresAt` se duoc tinh han theo `lastSeenAt` hoac
  `boundAt`, nen khong bi ket vinh vien sau khi deploy Worker moi.

Co the doi thoi gian cho key tu mo lai bang hang:

```js
const LICENSE_BINDING_TTL_SECONDS = 7 * 24 * 60 * 60;
```

Giam xuong 1-3 ngay neu muon ho tro chuyen may nhanh hon. Tang len neu muon khoa
thiet bi chat hon.

## 9. Luu y bao mat

Co che nay chan viec dung chung key thong thuong, nhung khong phai chong crack
tuyet doi. Neu nguoi dung co source code va biet sua extension, ho van co the tim
cach bo qua kiem tra client. Phan quan trong nhat nen nam tren server.
