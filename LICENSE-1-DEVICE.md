# License: 1 key cho 1 may

Luot kich hoat dau tien se gan license key voi `deviceId` cua extension tren may do.
Sau khi da gan, may khac nhap lai cung key se bi tu choi.

## Can cau hinh Cloudflare KV

Tao KV namespace:

```powershell
npx.cmd wrangler kv namespace create LICENSE_BINDINGS
```

Lenh tren se tra ve `id`. Mo `wrangler.toml`, bo comment block `[[kv_namespaces]]`
va thay `replace-with-your-kv-namespace-id` bang `id` vua tao:

```toml
[[kv_namespaces]]
binding = "LICENSE_BINDINGS"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

Sau do deploy lai Worker:

```powershell
npx.cmd wrangler deploy
```

## Mo khoa de doi may

Nguoi dung co the bam `Huy lien ket license` trong tab `Cai dat` cua tool. Neu dung
may dang giu license, Worker se xoa lien ket va key co the kich hoat tren may khac.

Neu can xu ly thu cong, xoa binding cua key tren Cloudflare KV:

```powershell
npx.cmd wrangler kv key delete "license:FLOW-USER-001" --binding LICENSE_BINDINGS
```

Lan kich hoat tiep theo se gan key voi may moi.

Endpoint server dung cho tool:

- `POST /verify`: kiem tra va tu dong gan key voi may dau tien.
- `POST /unlink`: chi may dang duoc gan key moi co the huy lien ket.

## Luu y

Trinh duyet khong cho extension lay ma phan cung that cua may. `deviceId` o day la ID
ngau nhien duoc tao va luu trong `chrome.storage.local` cua ban cai extension. Neu nguoi
dung go extension/cai lai hoac sua source code, co the tao ID khac. Cach nay phu hop de
chan viec dung chung key thong thuong; phan logic quan trong van nen nam tren server.
