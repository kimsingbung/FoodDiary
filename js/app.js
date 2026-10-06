import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, deleteField, query, where, orderBy, limit,
  onSnapshot, writeBatch, serverTimestamp, Bytes,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { firebaseConfig, KAKAO_JS_KEY, MEMBERS } from "./config.js";
import { readExif, processPhoto } from "./photo.js";

// 카카오톡 인앱 브라우저는 구글 로그인을 막기 때문에 외부 브라우저로 다시 연다
if (/KAKAOTALK/i.test(navigator.userAgent)) {
  location.href = "kakaotalk://web/openExternal?url=" + encodeURIComponent(location.href);
}

const $ = (sel) => document.querySelector(sel);
const SCREENS = ["loading", "setup-screen", "login-screen", "denied-screen", "app"];
const MEMBER_LIST = Object.values(MEMBERS);
const MAX_PHOTOS = 10;

const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateLabel = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return `${y}.${pad(m)}.${pad(d)} (${"일월화수목금토"[new Date(y, m - 1, d).getDay()]})`;
};
const won = (n) => `${Number(n || 0).toLocaleString("ko-KR")}원`;
const stars = (n) => (n ? "★".repeat(n) + "☆".repeat(5 - n) : "");
const digits = (s) => Number(String(s).replace(/[^\d]/g, "")) || 0;

function show(id) {
  for (const s of SCREENS) $("#" + s).classList.toggle("hidden", s !== id);
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  // popover로 띄워야 열려 있는 대화상자 위에도 보인다
  try { t.hidePopover(); } catch {}
  try { t.showPopover(); } catch {}
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { try { t.hidePopover(); } catch {} }, 2600);
}

function avatar(member, cls = "avatar") {
  return `<span class="${cls}" style="--c:${esc(member?.color ?? "#999")}">${esc((member?.name ?? "?")[0])}</span>`;
}

function ratingInput(el, value) {
  el.dataset.value = value;
  el.innerHTML = [1, 2, 3, 4, 5].map((i) => `<button type="button" data-star="${i}" class="${i <= value ? "on" : ""}">★</button>`).join("");
}

if ([firebaseConfig.apiKey, KAKAO_JS_KEY].some((k) => !k || k.startsWith("YOUR_"))) {
  show("setup-screen");
  throw new Error("js/config.js 를 채워주세요");
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

const kakaoReady = new Promise((resolve, reject) => {
  const s = document.createElement("script");
  s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(KAKAO_JS_KEY)}&libraries=services&autoload=false`;
  s.onload = () => kakao.maps.load(resolve);
  s.onerror = () => reject(new Error("카카오맵을 불러오지 못했어요. 앱 키와 도메인 등록을 확인해 주세요."));
  document.head.appendChild(s);
});
kakaoReady.catch((e) => toast(e.message));

let me = null; // { id, name, color, uid, email }
const state = {
  view: "map",
  group: (() => { try { return localStorage.getItem("group") || "month"; } catch { return "month"; } })(),
  places: new Map(),
  visits: [],
  unsubs: [],
  form: null,
  openVisitId: null,
  openPlaceId: null,
  reviewEditing: false,
};

const placeOf = (v) => state.places.get(v.placeId) ?? { id: v.placeId, name: v.placeName ?? "(알 수 없는 가게)" };
const visitById = (id) => state.visits.find((v) => v.id === id);
const memberById = (id) => MEMBER_LIST.find((m) => m.id === id);

/* ================= 로그인 ================= */

$("#login-btn").onclick = async () => {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment") {
      await signInWithRedirect(auth, provider);
    } else if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") {
      toast("로그인 실패: " + e.message);
    }
  }
};
$("#denied-logout").onclick = () => signOut(auth);
$("#me-btn").onclick = () => {
  if (confirm(`${me.name} (${me.email}) 계정에서 로그아웃할까요?`)) signOut(auth);
};

function deny(email, extra = "") {
  $("#denied-email").textContent = email + extra;
  show("denied-screen");
}

onAuthStateChanged(auth, (user) => {
  state.unsubs.forEach((u) => u());
  state.unsubs = [];
  me = null;
  if (!user) return show("login-screen");

  const member = MEMBERS[(user.email ?? "").toLowerCase()];
  if (!member) return deny(user.email);
  me = { ...member, uid: user.uid, email: user.email };
  $("#me-btn").innerHTML = avatar(me);
  show("loading");
  startData();
});

function startData() {
  let gotPlaces = false, gotVisits = false;
  const onError = (err) => {
    if (err.code === "permission-denied") deny(me?.email ?? "", "\n(Firestore 규칙의 이메일 목록을 확인해 주세요)");
    else toast("불러오기 실패: " + err.message);
  };
  const ready = () => {
    if (!gotPlaces || !gotVisits) return;
    if ($("#app").classList.contains("hidden")) {
      show("app");
      document.documentElement.style.setProperty("--topbar-h", $(".topbar").offsetHeight + "px");
      setView(state.view);
    }
    renderAll();
  };
  state.unsubs.push(onSnapshot(collection(db, "places"), (snap) => {
    state.places = new Map(snap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
    gotPlaces = true;
    ready();
  }, onError));
  state.unsubs.push(onSnapshot(query(collection(db, "visits"), orderBy("date", "desc")), (snap) => {
    state.visits = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    gotVisits = true;
    ready();
  }, onError));
}

function renderAll() {
  renderList();
  renderAlbum();
  renderMap(false);
  if ($("#visit-dialog").open && !state.reviewEditing) renderVisitInfo();
  if ($("#place-dialog").open) renderPlace();
}

/* ================= 화면 전환 ================= */

function setView(view) {
  state.view = view;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  for (const v of ["map", "list", "album"]) $(`#${v}-view`).classList.toggle("hidden", v !== view);
  document.querySelectorAll("[data-group]").forEach((b) => b.classList.toggle("on", b.dataset.group === state.group));
  if (view === "map") showMap();
  else window.scrollTo(0, 0);
}
document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => setView(t.dataset.view)));
window.addEventListener("resize", () => {
  const bar = $(".topbar");
  if (bar.offsetHeight) document.documentElement.style.setProperty("--topbar-h", bar.offsetHeight + "px");
});

function setGroup(g) {
  state.group = g;
  try { localStorage.setItem("group", g); } catch {}
  document.querySelectorAll("[data-group]").forEach((b) => b.classList.toggle("on", b.dataset.group === g));
  renderList();
  renderAlbum();
}

/* ================= 통계 ================= */

function placeStats(placeId) {
  const visits = state.visits.filter((v) => v.placeId === placeId);
  const all = [];
  const byMember = {};
  for (const m of MEMBER_LIST) {
    const rs = visits.map((v) => v.reviews?.[m.id]?.rating).filter(Boolean);
    byMember[m.id] = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
    all.push(...rs);
  }
  return {
    visits,
    count: visits.length,
    total: visits.reduce((s, v) => s + (v.total || 0), 0),
    avg: all.length ? all.reduce((a, b) => a + b, 0) / all.length : null,
    byMember,
  };
}

const tier = (avg) => (avg == null ? "none" : avg >= 4.5 ? "best" : avg >= 3.5 ? "good" : "meh");

function groupVisits() {
  const groups = [];
  let cur = null;
  for (const v of state.visits) {
    const key = state.group === "year" ? v.date.slice(0, 4) : v.date.slice(0, 7);
    if (cur?.key !== key) groups.push((cur = { key, items: [] }));
    cur.items.push(v);
  }
  return groups;
}
const periodLabel = (key) => {
  const [y, m] = key.split("-");
  return m ? `${y}년 ${Number(m)}월` : `${y}년`;
};

/* ================= 지도 ================= */

let map = null;
let overlays = [];

async function showMap() {
  try {
    await kakaoReady;
  } catch (e) {
    $("#map").innerHTML = `<p class="empty">${esc(e.message)}</p>`;
    return;
  }
  if (!map) {
    map = new kakao.maps.Map($("#map"), { center: new kakao.maps.LatLng(37.5665, 126.978), level: 8 });
    renderMap(true);
  } else {
    map.relayout();
  }
}

function renderMap(fit) {
  if (!map) return;
  overlays.forEach((o) => o.setMap(null));
  overlays = [];
  const bounds = new kakao.maps.LatLngBounds();
  let count = 0, last = null;
  for (const p of state.places.values()) {
    const s = placeStats(p.id);
    if (!s.count || !p.lat || !p.lng) continue;
    const pos = new kakao.maps.LatLng(p.lat, p.lng);
    const el = document.createElement("div");
    el.className = "pin-wrap";
    el.innerHTML = `<button class="pin ${tier(s.avg)}">${s.avg ? `<b>★${s.avg.toFixed(1)}</b>` : "🍽️"}<span>${esc(p.name)}</span></button>`;
    el.firstChild.onclick = () => openPlace(p.id);
    const ov = new kakao.maps.CustomOverlay({ position: pos, content: el, yAnchor: 1, clickable: true });
    ov.setMap(map);
    overlays.push(ov);
    bounds.extend(pos);
    last = pos;
    count++;
  }
  if (fit && count > 1) map.setBounds(bounds, 80, 40, 40, 40);
  else if (fit && count === 1) { map.setCenter(last); map.setLevel(4); }
  $("#map-summary").textContent = `가게 ${count}곳 · 방문 ${state.visits.length}번`;
  $("#map-empty").classList.toggle("hidden", count > 0);
}

/* ================= 리스트 ================= */

function visitRow(v) {
  const p = placeOf(v);
  const cover = v.photos?.[0];
  const menus = (v.menus ?? []).map((m) => m.name).filter(Boolean).join(", ");
  return `<button class="visit-row" data-visit="${esc(v.id)}">
    ${cover ? `<img class="row-thumb" src="${esc(cover.thumb)}" alt="">` : `<span class="row-thumb noimg">🍽️</span>`}
    <span class="row-body">
      <strong>${esc(p.name)}</strong>
      <span class="meta">${dateLabel(v.date)}${v.total ? " · " + won(v.total) : ""}${v.photos?.length > 1 ? ` · 📷${v.photos.length}` : ""}</span>
      ${menus ? `<span class="meta ellipsis">${esc(menus)}</span>` : ""}
    </span>
    <span class="row-reviews">${MEMBER_LIST.map((m) => {
      const r = v.reviews?.[m.id];
      return r?.rating ? `<span class="mini-rating" style="--c:${esc(m.color)}">${esc(m.name)} ★${r.rating}</span>` : "";
    }).join("")}</span>
  </button>`;
}

function renderList() {
  const groups = groupVisits();
  $("#list").innerHTML = groups.length
    ? groups.map((g) => `<section class="group">
        <h3 class="group-head"><span>${periodLabel(g.key)}</span>
          <span class="muted">${g.items.length}번 · ${won(g.items.reduce((s, v) => s + (v.total || 0), 0))}</span></h3>
        ${g.items.map(visitRow).join("")}
      </section>`).join("")
    : `<p class="empty">아직 기록이 없어요.<br>+ 버튼으로 첫 맛집을 남겨보세요 🍜</p>`;
}

/* ================= 앨범 ================= */

function renderAlbum() {
  const html = groupVisits().map((g) => {
    const items = g.items.flatMap((v) => (v.photos ?? []).map((ph, i) => ({ v, ph, i })));
    if (!items.length) return "";
    return `<section class="group">
      <h3 class="group-head"><span>${periodLabel(g.key)}</span><span class="muted">${items.length}장</span></h3>
      <div class="album-grid">${items.map(({ v, ph, i }) =>
        `<button class="album-cell" data-visit="${esc(v.id)}" data-index="${i}" title="${esc(placeOf(v).name)}"><img src="${esc(ph.thumb)}" alt=""></button>`).join("")}
      </div>
    </section>`;
  }).join("");
  $("#album").innerHTML = html || `<p class="empty">아직 사진이 없어요 📷</p>`;
}

/* ================= 원본 사진 ================= */

const photoCache = new Map();
function photoUrl(id) {
  if (!photoCache.has(id)) {
    photoCache.set(id, getDoc(doc(db, "photos", id))
      .then((s) => (s.exists() ? URL.createObjectURL(new Blob([s.data().data.toUint8Array()], { type: "image/jpeg" })) : null))
      .catch(() => null));
  }
  return photoCache.get(id);
}

async function swapToFull(img, id) {
  const url = await photoUrl(id);
  if (!url) return;
  img.onload = () => img.classList.remove("blur");
  img.src = url;
}

/* ================= 가게 상세 ================= */

const placeDialog = $("#place-dialog");

function openPlace(id) {
  state.openPlaceId = id;
  renderPlace();
  if (!placeDialog.open) placeDialog.showModal();
}

function renderPlace() {
  const p = state.places.get(state.openPlaceId);
  if (!p) return placeDialog.close();
  const s = placeStats(p.id);
  placeDialog.innerHTML = `<div class="sheet">
    <button class="close-x" data-close aria-label="닫기">✕</button>
    <div>
      <h2>${esc(p.name)}</h2>
      <div class="meta">${esc(p.category ?? "")}</div>
      <div class="meta">${esc(p.roadAddress || p.address || "")}</div>
    </div>
    <div class="stat-row">
      ${MEMBER_LIST.map((m) => `<span class="stat">${avatar(m, "avatar xs")} ${s.byMember[m.id] ? "★" + s.byMember[m.id].toFixed(1) : "-"}</span>`).join("")}
      <span class="stat">방문 ${s.count}번</span>
      ${s.total ? `<span class="stat">총 ${won(s.total)}</span>` : ""}
    </div>
    <div class="actions">
      ${p.url ? `<a class="btn small" href="${esc(p.url)}" target="_blank" rel="noopener">카카오맵에서 보기</a>` : ""}
      <button class="btn small primary" data-act="add-visit">+ 방문 추가</button>
    </div>
    <div>${s.visits.map(visitRow).join("")}</div>
  </div>`;
}

/* ================= 방문 상세 ================= */

const visitDialog = $("#visit-dialog");
visitDialog.addEventListener("close", () => { state.reviewEditing = false; });

function openVisit(id, index = 0) {
  const v = visitById(id);
  if (!v) return;
  state.openVisitId = id;
  state.reviewEditing = false;
  const photos = v.photos ?? [];
  visitDialog.innerHTML = `<div class="sheet visit">
    <button class="close-x" data-close aria-label="닫기">✕</button>
    ${photos.length ? `<div class="carousel-wrap">
      <div class="carousel">${photos.map((ph) =>
        `<div class="slide"><img class="blur" src="${esc(ph.thumb)}" data-photo="${esc(ph.id)}" alt=""></div>`).join("")}</div>
      ${photos.length > 1 ? `<span class="counter">${index + 1} / ${photos.length}</span>` : ""}
    </div>` : ""}
    <div id="v-info" class="v-info"></div>
  </div>`;
  if (!visitDialog.open) visitDialog.showModal();
  renderVisitInfo();

  const car = visitDialog.querySelector(".carousel");
  if (car) {
    car.scrollLeft = index * car.clientWidth;
    car.onscroll = () => {
      const c = visitDialog.querySelector(".counter");
      if (c) c.textContent = `${Math.round(car.scrollLeft / car.clientWidth) + 1} / ${photos.length}`;
    };
    const imgs = [...car.querySelectorAll("img")];
    // 지금 보는 사진부터 원본을 불러온다
    [imgs[index], ...imgs.filter((_, i) => i !== index)].forEach((img) => img && swapToFull(img, img.dataset.photo));
  }
}

function renderVisitInfo() {
  const v = visitById(state.openVisitId);
  if (!v) return visitDialog.close();
  const p = placeOf(v);
  const menus = v.menus ?? [];
  $("#v-info").innerHTML = `
    <div>
      <button class="place-link" data-place="${esc(v.placeId)}">📍 ${esc(p.name)} <span>›</span></button>
      <div class="meta">${dateLabel(v.date)}${p.category ? " · " + esc(p.category) : ""}</div>
    </div>
    ${menus.length ? `<table class="menu-table">
      ${menus.map((m) => `<tr><td>${esc(m.name)}</td><td>${m.price ? won(m.price) : ""}</td></tr>`).join("")}
      <tr class="total"><td>합계</td><td>${won(v.total)}</td></tr>
    </table>` : ""}
    <div class="reviews">${MEMBER_LIST.map((m) => reviewCard(v, m)).join("")}</div>
    <div class="actions">
      <button class="btn small" data-act="edit-visit">기록 수정</button>
      <button class="btn small danger" data-act="delete-visit">삭제</button>
    </div>`;
}

function reviewCard(v, m) {
  const r = v.reviews?.[m.id];
  const mine = m.id === me.id;
  return `<div class="review" style="--c:${esc(m.color)}">
    <div class="review-head">
      ${avatar(m, "avatar xs")} <strong>${esc(m.name)}</strong> <span class="stars">${stars(r?.rating)}</span>
      ${mine ? `<button class="link push" data-act="edit-review">${r ? "수정" : "후기 쓰기"}</button>` : ""}
    </div>
    ${r?.text ? `<p class="memo">${esc(r.text)}</p>` : `<p class="muted small">${mine ? "아직 내 후기가 없어요" : "아직 후기를 안 썼어요"}</p>`}
  </div>`;
}

function startReviewEdit() {
  const v = visitById(state.openVisitId);
  const r = v?.reviews?.[me.id];
  const cards = visitDialog.querySelectorAll(".review");
  const idx = MEMBER_LIST.findIndex((m) => m.id === me.id);
  state.reviewEditing = true;
  cards[idx].outerHTML = `<div class="review editing" style="--c:${esc(me.color)}">
    <div class="review-head">${avatar(me, "avatar xs")} <strong>${esc(me.name)}</strong></div>
    <span class="rating-input" id="r-rating"></span>
    <textarea id="r-text" rows="3" maxlength="500" placeholder="맛은 어땠어요?">${esc(r?.text ?? "")}</textarea>
    <div class="actions end">
      <button class="btn small" data-act="cancel-review">취소</button>
      <button class="btn small primary" data-act="save-review">저장</button>
    </div>
  </div>`;
  ratingInput($("#r-rating"), r?.rating ?? 0);
  $("#r-text").focus();
}

async function saveReview() {
  const rating = Number($("#r-rating").dataset.value);
  const text = $("#r-text").value.trim();
  try {
    await updateDoc(doc(db, "visits", state.openVisitId), {
      [`reviews.${me.id}`]: rating || text ? { rating, text, at: serverTimestamp() } : deleteField(),
    });
    state.reviewEditing = false;
    renderVisitInfo();
  } catch (err) {
    toast("후기 저장 실패: " + err.message);
  }
}

async function cleanupPlace(placeId) {
  // 남은 방문 기록이 없는 가게는 지도에서도 지운다
  const rest = await getDocs(query(collection(db, "visits"), where("placeId", "==", placeId), limit(1)));
  if (rest.empty) await deleteDoc(doc(db, "places", placeId)).catch(() => {});
}

async function deleteVisit(v) {
  const name = placeOf(v).name;
  if (!confirm(`${dateLabel(v.date)} ${name} 기록을 삭제할까요?\n사진과 두 사람의 후기가 모두 지워져요.`)) return;
  visitDialog.close();
  try {
    const batch = writeBatch(db);
    (v.photos ?? []).forEach((ph) => batch.delete(doc(db, "photos", ph.id)));
    batch.delete(doc(db, "visits", v.id));
    await batch.commit();
    await cleanupPlace(v.placeId);
    toast("삭제했어요");
  } catch (err) {
    toast("삭제 실패: " + err.message);
  }
}

/* ================= 기록 추가/수정 폼 ================= */

const formDialog = $("#form-dialog");

function openForm(v = null, place = null) {
  state.form = {
    editing: v,
    place: v ? placeOf(v) : place,
    photos: (v?.photos ?? []).map((ph) => ({ ...ph, key: ph.id })),
    removed: [],
    dateTouched: !!v,
    exifUsed: !!v,
    results: [],
  };
  $("#form-title").textContent = v ? "기록 수정" : "맛집 기록";
  $("#f-date").value = v?.date ?? ymd(new Date());
  $("#photo-hint").textContent = "";
  $("#place-q").value = "";
  $("#place-results").innerHTML = "";
  $("#menu-rows").innerHTML = "";
  const menus = v?.menus?.length ? v.menus : [{ name: "", price: 0 }];
  menus.forEach((m) => addMenuRow(m));
  updateTotal();
  const r = v?.reviews?.[me.id];
  ratingInput($("#f-rating"), r?.rating ?? 0);
  $("#f-review").value = r?.text ?? "";
  renderPlacePicked();
  renderStrip();
  formDialog.showModal();
  formDialog.scrollTop = 0;
}

$("#fab").onclick = () => openForm();

// 사진

function renderStrip() {
  const f = state.form;
  $("#photo-strip").innerHTML = f.photos.map((p, i) => `<div class="strip-item">
      ${p.loading ? `<span class="strip-loading">처리 중…</span>` : `<img src="${esc(p.thumb)}" alt="">`}
      ${i === 0 && !p.loading ? `<span class="cover-badge">대표</span>` : ""}
      <button type="button" class="x" data-act="remove-photo" data-key="${esc(p.key)}" aria-label="사진 빼기">✕</button>
    </div>`).join("")
    + (f.photos.length < MAX_PHOTOS
      ? `<label class="strip-add">📷<br>사진 추가<input type="file" id="photo-input" accept="image/*" multiple hidden></label>`
      : "");
  const input = $("#photo-input");
  if (input) input.onchange = () => addFiles([...input.files]);
}

async function addFiles(files) {
  const f = state.form;
  const room = MAX_PHOTOS - f.photos.length;
  if (files.length > room) toast(`사진은 한 기록에 ${MAX_PHOTOS}장까지 올릴 수 있어요`);
  const items = files.slice(0, room).map((file) => ({ key: crypto.randomUUID(), loading: true, file }));
  f.photos.push(...items);
  renderStrip();
  for (const item of items) {
    try {
      const [exif, out] = await Promise.all([readExif(item.file), processPhoto(item.file)]);
      Object.assign(item, { loading: false, thumb: out.thumb, w: out.w, h: out.h, bytes: out.bytes, file: null });
      if (state.form === f) applyExif(exif);
    } catch {
      f.photos.splice(f.photos.indexOf(item), 1);
      toast("읽을 수 없는 사진이 있어서 뺐어요 (JPG/PNG 사진을 골라주세요)");
    }
    if (state.form === f) renderStrip();
  }
}

// 지난 사진을 올리면 촬영 날짜와 장소를 자동으로 채운다
function applyExif(exif) {
  const f = state.form;
  if (f.exifUsed) return;
  const hints = [];
  if (exif.date && !f.dateTouched) {
    $("#f-date").value = exif.date;
    hints.push("📅 촬영 날짜로 설정");
  }
  if (exif.lat && !f.place) {
    searchNearby(exif.lat, exif.lng);
    hints.push("📍 찍은 곳 근처 가게 추천");
  }
  if (exif.date || exif.lat) f.exifUsed = true;
  $("#photo-hint").textContent = hints.join(" · ");
}

$("#f-date").oninput = () => { if (state.form) state.form.dateTouched = true; };

// 가게 검색

const kakaoSearch = (method, arg, opts) => new Promise((res) => {
  const ps = new kakao.maps.services.Places();
  ps[method](arg, (data, status) => res(status === kakao.maps.services.Status.OK ? data : []), opts);
});

const fromKakao = (d) => ({
  id: "k" + d.id,
  kakaoId: d.id,
  name: d.place_name,
  category: d.category_name.split(" > ").pop(),
  categoryFull: d.category_name,
  address: d.address_name,
  roadAddress: d.road_address_name,
  lat: Number(d.y),
  lng: Number(d.x),
  url: d.place_url,
  phone: d.phone,
  distance: d.distance ? Number(d.distance) : null,
});

async function searchPlaces() {
  const q = $("#place-q").value.trim();
  if (!q) return;
  $("#place-results").innerHTML = `<p class="muted small">검색 중…</p>`;
  const ours = [...state.places.values()].filter((p) => p.name.includes(q)).slice(0, 5);
  let found = [];
  try {
    await kakaoReady;
    found = (await kakaoSearch("keywordSearch", q, { size: 15 })).map(fromKakao).filter((p) => !state.places.has(p.id));
  } catch (e) {
    toast(e.message);
  }
  showResults([
    ...(ours.length ? [{ title: "💛 우리가 간 곳" }, ...ours] : []),
    ...(found.length ? [{ title: "🔎 검색 결과" }, ...found] : []),
  ], "검색 결과가 없어요. 지역명을 같이 넣어보세요 (예: 성수 카페)");
}

async function searchNearby(lat, lng) {
  try {
    await kakaoReady;
  } catch { return; }
  const opts = { location: new kakao.maps.LatLng(lat, lng), radius: 200, sort: kakao.maps.services.SortBy.DISTANCE };
  const [food, cafe] = await Promise.all([kakaoSearch("categorySearch", "FD6", opts), kakaoSearch("categorySearch", "CE7", opts)]);
  const list = [...food, ...cafe].map(fromKakao).sort((a, b) => a.distance - b.distance).slice(0, 8);
  if (state.form && !state.form.place && list.length) showResults([{ title: "📷 사진 찍은 곳 근처" }, ...list], "");
}

function showResults(list, emptyText) {
  state.form.results = list;
  $("#place-results").innerHTML = list.length
    ? list.map((p, i) => p.title
      ? `<div class="results-title">${p.title}</div>`
      : `<button type="button" class="result" data-act="pick-place" data-index="${i}">
          <strong>${esc(p.name)}</strong>
          <span class="meta">${esc(p.category ?? "")}${p.distance != null ? ` · ${p.distance}m` : ""} · ${esc(p.roadAddress || p.address || "")}</span>
        </button>`).join("")
    : `<p class="muted small">${emptyText}</p>`;
}

$("#place-go").onclick = searchPlaces;
$("#place-q").onkeydown = (e) => {
  if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); searchPlaces(); }
};

function renderPlacePicked() {
  const p = state.form.place;
  $("#place-picked").classList.toggle("hidden", !p);
  $("#place-search").classList.toggle("hidden", !!p);
  if (p) {
    $("#place-picked").innerHTML = `<div><strong>📍 ${esc(p.name)}</strong>
      <span class="meta">${esc(p.category ?? "")} · ${esc(p.roadAddress || p.address || "")}</span></div>
      <button type="button" class="link" data-act="change-place">변경</button>`;
  }
}

// 메뉴

function addMenuRow(m = { name: "", price: 0 }) {
  const row = document.createElement("div");
  row.className = "menu-row";
  row.innerHTML = `<input class="m-name" maxlength="40" placeholder="메뉴" value="${esc(m.name)}">
    <input class="m-price" inputmode="numeric" placeholder="가격" value="${m.price ? m.price.toLocaleString("ko-KR") : ""}">
    <span class="muted">원</span>
    <button type="button" class="x-btn" data-act="del-menu" aria-label="메뉴 삭제">✕</button>`;
  $("#menu-rows").appendChild(row);
  return row;
}

function collectMenus() {
  return [...document.querySelectorAll(".menu-row")]
    .map((r) => ({ name: r.querySelector(".m-name").value.trim(), price: digits(r.querySelector(".m-price").value) }))
    .filter((m) => m.name || m.price);
}

function updateTotal() {
  const total = collectMenus().reduce((s, m) => s + m.price, 0);
  $("#menu-total").textContent = total ? `합계 ${won(total)}` : "";
}

$("#menu-add").onclick = () => addMenuRow().querySelector(".m-name").focus();
$("#menu-rows").addEventListener("input", (e) => {
  if (e.target.classList.contains("m-price")) {
    const n = digits(e.target.value);
    e.target.value = n ? n.toLocaleString("ko-KR") : "";
  }
  updateTotal();
});

// 입력칸에서 엔터를 눌러도 폼이 저장되지 않게
$("#visit-form").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.tagName === "INPUT") e.preventDefault();
});

// 저장

$("#visit-form").onsubmit = async (e) => {
  e.preventDefault();
  const f = state.form;
  if (!f.place) return toast("가게를 선택해 주세요");
  if (f.photos.some((p) => p.loading)) return toast("사진을 처리하는 중이에요. 잠시만요!");
  const btn = $("#form-save");
  btn.disabled = true;
  try {
    const place = f.place;
    if (!state.places.has(place.id)) {
      const { id, distance, title, ...data } = place;
      await setDoc(doc(db, "places", id), { ...data, createdBy: me.id, createdAt: serverTimestamp() });
    }

    const visitRef = f.editing ? doc(db, "visits", f.editing.id) : doc(collection(db, "visits"));
    const fresh = f.photos.filter((p) => p.bytes);
    const photos = [];
    let done = 0;
    for (const p of f.photos) {
      if (p.bytes) {
        btn.textContent = `사진 올리는 중 ${++done}/${fresh.length}`;
        const ref = doc(collection(db, "photos"));
        await setDoc(ref, { visitId: visitRef.id, by: me.id, data: Bytes.fromUint8Array(p.bytes) });
        p.id = ref.id;
        p.bytes = null;
      }
      photos.push({ id: p.id, thumb: p.thumb, w: p.w, h: p.h });
    }

    btn.textContent = "저장 중…";
    const menus = collectMenus();
    const rating = Number($("#f-rating").dataset.value);
    const text = $("#f-review").value.trim();
    const review = rating || text ? { rating, text, at: serverTimestamp() } : null;
    const data = {
      placeId: place.id,
      placeName: place.name,
      date: $("#f-date").value,
      menus,
      total: menus.reduce((s, m) => s + m.price, 0),
      photos,
      updatedAt: serverTimestamp(),
    };
    if (f.editing) {
      await updateDoc(visitRef, { ...data, [`reviews.${me.id}`]: review ?? deleteField() });
    } else {
      await setDoc(visitRef, { ...data, reviews: review ? { [me.id]: review } : {}, createdBy: me.id, createdAt: serverTimestamp() });
    }

    await Promise.all(f.removed.map((id) => deleteDoc(doc(db, "photos", id)).catch(() => {})));
    if (f.editing && f.editing.placeId !== place.id) await cleanupPlace(f.editing.placeId);

    formDialog.close();
    toast("저장했어요! 😋");
    if (map && place.lat) map.panTo(new kakao.maps.LatLng(place.lat, place.lng));
  } catch (err) {
    toast("저장 실패: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "저장";
  }
};

/* ================= 공통 클릭 처리 ================= */

document.addEventListener("click", (e) => {
  const t = e.target;
  if (t.tagName === "DIALOG") return t.close(); // 바깥(어두운 영역) 클릭

  if (t.closest("[data-close]")) return t.closest("dialog").close();

  const star = t.closest("[data-star]");
  if (star) {
    const box = star.closest(".rating-input");
    const n = Number(star.dataset.star);
    return ratingInput(box, Number(box.dataset.value) === n ? 0 : n);
  }

  const group = t.closest("[data-group]");
  if (group) return setGroup(group.dataset.group);

  const act = t.closest("[data-act]");
  if (act) return handleAct(act.dataset.act, act);

  const visit = t.closest("[data-visit]");
  if (visit) return openVisit(visit.dataset.visit, Number(visit.dataset.index || 0));

  const place = t.closest("[data-place]");
  if (place) return openPlace(place.dataset.place);
});

function handleAct(act, el) {
  const v = visitById(state.openVisitId);
  const f = state.form;
  switch (act) {
    case "add-visit": {
      const p = state.places.get(state.openPlaceId);
      return openForm(null, p);
    }
    case "edit-visit":
      visitDialog.close();
      return openForm(v);
    case "delete-visit":
      return v && deleteVisit(v);
    case "edit-review":
      return startReviewEdit();
    case "cancel-review":
      state.reviewEditing = false;
      return renderVisitInfo();
    case "save-review":
      return saveReview();
    case "remove-photo": {
      const i = f.photos.findIndex((p) => p.key === el.dataset.key);
      if (i < 0) return;
      const [p] = f.photos.splice(i, 1);
      if (p.id && !p.bytes) f.removed.push(p.id);
      return renderStrip();
    }
    case "pick-place":
      f.place = f.results[Number(el.dataset.index)];
      return renderPlacePicked();
    case "change-place":
      f.place = null;
      renderPlacePicked();
      return $("#place-q").focus();
    case "del-menu":
      el.closest(".menu-row").remove();
      if (!document.querySelector(".menu-row")) addMenuRow();
      return updateTotal();
  }
}
