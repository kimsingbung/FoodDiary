// 사진 압축과 EXIF(촬영 날짜·위치) 읽기

const MAX_PHOTO_BYTES = 700_000; // Firestore 문서 한도(1MB) 안에 넉넉히 들어가도록

// JPEG의 EXIF에서 촬영일(YYYY-MM-DD)과 GPS 좌표를 읽는다. 없거나 못 읽으면 null.
export async function readExif(file) {
  const result = { date: null, lat: null, lng: null };
  try {
    const buf = await file.slice(0, 128 * 1024).arrayBuffer();
    const v = new DataView(buf);
    if (v.getUint16(0) !== 0xffd8) return result;
    let off = 2;
    while (off + 10 < v.byteLength) {
      const marker = v.getUint16(off);
      if ((marker & 0xff00) !== 0xff00) break;
      if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) { // "Exif"
        const tiff = off + 10;
        const le = v.getUint16(tiff) === 0x4949;
        const u16 = (o) => v.getUint16(o, le);
        const u32 = (o) => v.getUint32(o, le);
        const find = (ifd, tag) => {
          const n = u16(ifd);
          for (let i = 0; i < n; i++) if (u16(ifd + 2 + i * 12) === tag) return ifd + 2 + i * 12;
          return null;
        };
        const ifd0 = tiff + u32(tiff + 4);

        const exifPtr = find(ifd0, 0x8769);
        const dateEntry = (exifPtr && find(tiff + u32(exifPtr + 8), 0x9003)) || find(ifd0, 0x0132);
        if (dateEntry) {
          const s = new TextDecoder().decode(new Uint8Array(buf, tiff + u32(dateEntry + 8), 10));
          const m = s.match(/^(\d{4}):(\d{2}):(\d{2})/);
          if (m && m[1] !== "0000") result.date = `${m[1]}-${m[2]}-${m[3]}`;
        }

        const gpsPtr = find(ifd0, 0x8825);
        if (gpsPtr) {
          const gps = tiff + u32(gpsPtr + 8);
          const deg = (entry) => {
            const o = tiff + u32(entry + 8);
            let r = 0;
            for (let i = 0; i < 3; i++) {
              const den = u32(o + i * 8 + 4);
              if (den) r += u32(o + i * 8) / den / [1, 60, 3600][i];
            }
            return r;
          };
          const ref = (entry) => (entry ? String.fromCharCode(v.getUint8(entry + 8)) : "");
          const latE = find(gps, 2), lngE = find(gps, 4);
          if (latE && lngE) {
            const lat = deg(latE) * (ref(find(gps, 1)) === "S" ? -1 : 1);
            const lng = deg(lngE) * (ref(find(gps, 3)) === "W" ? -1 : 1);
            if (lat || lng) Object.assign(result, { lat, lng });
          }
        }
        return result;
      }
      off += 2 + v.getUint16(off + 2);
    }
  } catch {
    // EXIF가 깨져 있어도 사진 업로드는 계속 진행
  }
  return result;
}

async function fileToImage(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    const img = new Image();
    img.src = URL.createObjectURL(file);
    await img.decode();
    return img;
  }
}

function drawScaled(img, max) {
  const s = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * s);
  c.height = Math.round(img.height * s);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c;
}

// 앨범·리스트용 정사각형 썸네일 (방문 기록 문서 안에 data URL로 저장)
function makeThumb(img, size = 240) {
  const side = Math.min(img.width, img.height);
  const c = document.createElement("canvas");
  c.width = c.height = size;
  c.getContext("2d").drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
  return c.toDataURL("image/jpeg", 0.7);
}

const toBlob = (c, q) => new Promise((res) => c.toBlob(res, "image/jpeg", q));

export async function processPhoto(file) {
  const img = await fileToImage(file);
  let max = 1440, q = 0.8, canvas, blob;
  for (;;) {
    canvas = drawScaled(img, max);
    blob = await toBlob(canvas, q);
    if (blob.size <= MAX_PHOTO_BYTES) break;
    q -= 0.1;
    if (q < 0.45) { max = Math.round(max * 0.8); q = 0.75; }
  }
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    w: canvas.width,
    h: canvas.height,
    thumb: makeThumb(img),
  };
}
