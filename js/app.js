import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, query, where, orderBy, limit, startAfter,
  onSnapshot, writeBatch, updateDoc, serverTimestamp, arrayUnion, arrayRemove, increment, Bytes,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

// 카카오톡 인앱 브라우저는 구글 로그인을 막기 때문에 외부 브라우저로 다시 연다
if (/KAKAOTALK/i.test(navigator.userAgent)) {
  location.href = "kakaotalk://web/openExternal?url=" + encodeURIComponent(location.href);
}

const $ = (sel) => document.querySelector(sel);
const MEALS = ["아침", "점심", "저녁", "간식", "야식"];
const MEAL_EMOJI = { 아침: "🌅", 점심: "🍱", 저녁: "🍲", 간식: "🍰", 야식: "🌙" };
const SCREENS = ["loading", "setup-screen", "login-screen", "denied-screen", "app"];
const FEED_PAGE = 10;
const MAX_PHOTO_BYTES = 900_000; // Firestore 문서 한도(1MB) 안에 들어가도록

const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const sameMonth = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
const dayLabel = (s) => { const d = parseYmd(s); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${"일월화수목금토"[d.getDay()]})`; };
const stars = (n) => (n ? "★".repeat(n) + "☆".repeat(5 - n) : "");
const timeOf = (x) => x.createdAt?.toMillis?.() ?? Date.now();
const emojiOf = (meal) => MEAL_EMOJI[meal] ?? "🍽️";

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

function avatar(name, url, cls = "avatar") {
  return url
    ? `<img class="${cls}" src="${esc(url)}" alt="" referrerpolicy="no-referrer">`
    : `<span class="${cls}">${esc((name || "?")[0])}</span>`;
}

if (!firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith("YOUR_")) {
  show("setup-screen");
  throw new Error("js/firebase-config.js 를 채워주세요");
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let me = null;
const state = {
  view: "calendar",
  month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  selected: ymd(new Date()),
  monthMeals: [],
  unsubMonth: null,
  feedCursor: null,
  feedLoading: false,
  editing: null,
  pendingPhoto: null,
  rating: 0,
  detail: null,
};

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
  if (confirm(`${me.displayName ?? me.email} 계정에서 로그아웃할까요?`)) signOut(auth);
};

onAuthStateChanged(auth, async (user) => {
  state.unsubMonth?.();
  state.unsubMonth = null;
  me = null;
  if (!user) return show("login-screen");

  show("loading");
  // 보안 규칙에 등록된 이메일이 아니면 여기서 permission-denied가 난다
  try {
    await getDocs(query(collection(db, "meals"), limit(1)));
  } catch (e) {
    if (e.code === "permission-denied") {
      $("#denied-email").textContent = user.email;
      return show("denied-screen");
    }
    toast("연결 실패: " + e.message);
    return show("login-screen");
  }

  me = user;
  $("#me-btn").innerHTML = avatar(user.displayName, user.photoURL);
  show("app");
  setView("calendar");
});

/* ================= 화면 전환 ================= */

function setView(view) {
  state.view = view;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  $("#calendar-view").classList.toggle("hidden", view !== "calendar");
  $("#feed-view").classList.toggle("hidden", view !== "feed");
  if (view === "calendar" && !state.unsubMonth) subscribeMonth();
  if (view === "feed") loadFeed(true);
}
document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => setView(t.dataset.view)));

/* ================= 캘린더 ================= */

function goMonth(date, selected) {
  state.month = new Date(date.getFullYear(), date.getMonth(), 1);
  state.selected = selected ?? (sameMonth(new Date(), state.month) ? ymd(new Date()) : ymd(state.month));
  subscribeMonth();
}
const shiftMonth = (n) => goMonth(new Date(state.month.getFullYear(), state.month.getMonth() + n, 1));

$("#prev-month").onclick = () => shiftMonth(-1);
$("#next-month").onclick = () => shiftMonth(1);
$("#today-btn").onclick = () => goMonth(new Date());

let touchX = null;
$("#cal-grid").addEventListener("touchstart", (e) => (touchX = e.touches[0].clientX), { passive: true });
$("#cal-grid").addEventListener("touchend", (e) => {
  if (touchX === null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  touchX = null;
  if (Math.abs(dx) > 60) shiftMonth(dx < 0 ? 1 : -1);
});

function subscribeMonth() {
  state.unsubMonth?.();
  const y = state.month.getFullYear(), m = state.month.getMonth();
  const q = query(
    collection(db, "meals"),
    where("date", ">=", ymd(new Date(y, m, 1))),
    where("date", "<=", ymd(new Date(y, m + 1, 0))),
  );
  renderCalendar();
  renderDay();
  state.unsubMonth = onSnapshot(q, (snap) => {
    state.monthMeals = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderCalendar();
    renderDay();
  }, (err) => toast("불러오기 실패: " + err.message));
}

function mealsOf(date) {
  return state.monthMeals
    .filter((x) => x.date === date)
    .sort((a, b) => MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal) || timeOf(a) - timeOf(b));
}

function renderCalendar() {
  const y = state.month.getFullYear(), m = state.month.getMonth();
  $("#month-label").textContent = `${y}년 ${m + 1}월`;
  const todayKey = ymd(new Date());
  let html = "";
  for (let i = 0; i < new Date(y, m, 1).getDay(); i++) html += `<div class="cal-cell empty"></div>`;
  for (let d = 1; d <= new Date(y, m + 1, 0).getDate(); d++) {
    const key = ymd(new Date(y, m, d));
    const list = mealsOf(key);
    const thumb = list.find((x) => x.thumb)?.thumb;
    const cls = ["cal-cell", key === todayKey && "today", key === state.selected && "selected", thumb && "photo"].filter(Boolean).join(" ");
    const dots = list.length
      ? `<span class="dots">${list.some((x) => x.uid === me?.uid) ? `<i class="dot"></i>` : ""}${list.some((x) => x.uid !== me?.uid) ? `<i class="dot partner"></i>` : ""}</span>`
      : "";
    html += `<button class="${cls}" data-date="${key}">
      ${thumb ? `<img src="${esc(thumb)}" alt="">` : list.length ? `<span class="emo">${emojiOf(list[0].meal)}</span>` : ""}
      <span class="num">${d}</span>
      ${list.length > 1 ? `<span class="count">${list.length}</span>` : ""}
      ${dots}
    </button>`;
  }
  $("#cal-grid").innerHTML = html;
}

$("#cal-grid").onclick = (e) => {
  const cell = e.target.closest("[data-date]");
  if (!cell) return;
  state.selected = cell.dataset.date;
  renderCalendar();
  renderDay();
  if (window.innerWidth < 900) $(".day-panel").scrollIntoView({ behavior: "smooth", block: "nearest" });
};

function renderDay() {
  $("#day-label").textContent = dayLabel(state.selected);
  const list = mealsOf(state.selected);
  $("#day-list").innerHTML = list.length
    ? list.map(rowCard).join("")
    : `<p class="empty">아직 기록이 없어요 🍽️<br>이날 뭐 먹었어요?</p>`;
}

function rowCard(x) {
  return `<button class="row-card" data-id="${x.id}">
    ${x.thumb ? `<img class="row-thumb" src="${esc(x.thumb)}" alt="">` : `<span class="row-thumb noimg">${emojiOf(x.meal)}</span>`}
    <span class="row-body">
      <span class="row-top"><span class="badge">${emojiOf(x.meal)} ${esc(x.meal)}</span><span class="stars">${stars(x.rating)}</span></span>
      <strong>${esc(x.title)}</strong>
      <span class="meta">${avatar(x.authorName, x.authorPhoto, "avatar xs")} ${esc(x.authorName)}${x.place ? " · " + esc(x.place) : ""}</span>
    </span>
    <span class="row-stats">${x.likes?.length ? `♥ ${x.likes.length}` : ""} ${x.commentCount ? `💬 ${x.commentCount}` : ""}</span>
  </button>`;
}

$("#day-list").onclick = (e) => {
  const card = e.target.closest("[data-id]");
  if (card) openDetail(card.dataset.id);
};
$("#add-for-day").onclick = () => openEntry(null, state.selected);
$("#fab").onclick = () => openEntry(null, state.view === "calendar" ? state.selected : ymd(new Date()));

/* ================= 피드 ================= */

async function loadFeed(reset = false) {
  if (state.feedLoading) return;
  state.feedLoading = true;
  const list = $("#feed-list");
  if (reset) {
    state.feedCursor = null;
    list.innerHTML = `<p class="empty">불러오는 중…</p>`;
  }
  try {
    const parts = [orderBy("createdAt", "desc"), limit(FEED_PAGE)];
    if (state.feedCursor) parts.push(startAfter(state.feedCursor));
    const snap = await getDocs(query(collection(db, "meals"), ...parts));
    if (reset) {
      list.innerHTML = snap.empty ? `<p class="empty">아직 기록이 없어요. 첫 끼를 올려보세요! 🍙</p>` : "";
    }
    list.insertAdjacentHTML("beforeend", snap.docs.map((d) => feedCard({ id: d.id, ...d.data() })).join(""));
    list.querySelectorAll("img[data-full]:not([data-obs])").forEach((img) => {
      img.dataset.obs = "1";
      photoObserver.observe(img);
    });
    state.feedCursor = snap.docs.at(-1) ?? state.feedCursor;
    $("#feed-more").classList.toggle("hidden", snap.size < FEED_PAGE);
  } catch (e) {
    toast("피드 불러오기 실패: " + e.message);
  } finally {
    state.feedLoading = false;
  }
}
$("#feed-more").onclick = () => loadFeed();

function feedCard(x) {
  const ratio = x.photoW ? `style="aspect-ratio:${Number(x.photoW)}/${Number(x.photoH)}"` : "";
  return `<article class="feed-card" data-id="${x.id}">
    <header class="feed-head">
      ${avatar(x.authorName, x.authorPhoto, "avatar sm")}
      <div><strong>${esc(x.authorName)}</strong><span class="meta">${dayLabel(x.date)} · ${emojiOf(x.meal)} ${esc(x.meal)}</span></div>
    </header>
    ${x.hasPhoto ? `<div class="feed-photo"><img src="${esc(x.thumb)}" data-full="${x.id}" class="blur" alt="" ${ratio}></div>` : ""}
    <div class="feed-body">
      <div class="feed-title"><strong>${esc(x.title)}</strong><span class="stars">${stars(x.rating)}</span></div>
      ${x.place ? `<div class="meta">📍 ${esc(x.place)}</div>` : ""}
      ${x.memo ? `<p class="memo clamp">${esc(x.memo)}</p>` : ""}
      <div class="feed-stats">♥ ${x.likes?.length ?? 0} · 💬 ${x.commentCount ?? 0}</div>
    </div>
  </article>`;
}

$("#feed-list").onclick = (e) => {
  const card = e.target.closest("[data-id]");
  if (card) openDetail(card.dataset.id);
};

/* ================= 사진 ================= */

const photoCache = new Map();
function getPhotoUrl(id) {
  if (!photoCache.has(id)) {
    photoCache.set(id, getDoc(doc(db, "photos", id))
      .then((s) => (s.exists() ? URL.createObjectURL(new Blob([s.data().data.toUint8Array()], { type: "image/jpeg" })) : null))
      .catch(() => null));
  }
  return photoCache.get(id);
}

async function swapToFull(img, id) {
  const url = await getPhotoUrl(id);
  if (!url) return;
  img.onload = () => img.classList.remove("blur");
  img.src = url;
}

const photoObserver = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    photoObserver.unobserve(e.target);
    swapToFull(e.target, e.target.dataset.full);
  }
}, { rootMargin: "400px" });

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

// 캘린더 칸에 쓰는 작은 정사각형 썸네일 (meal 문서 안에 data URL로 저장)
function makeThumb(img, size = 200) {
  const side = Math.min(img.width, img.height);
  const c = document.createElement("canvas");
  c.width = c.height = size;
  c.getContext("2d").drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
  return c.toDataURL("image/jpeg", 0.7);
}

const canvasToBlob = (c, q) => new Promise((res) => c.toBlob(res, "image/jpeg", q));

async function processPhoto(file) {
  const img = await fileToImage(file);
  let max = 1280, q = 0.8, canvas, blob;
  for (;;) {
    canvas = drawScaled(img, max);
    blob = await canvasToBlob(canvas, q);
    if (blob.size <= MAX_PHOTO_BYTES) break;
    q -= 0.1;
    if (q < 0.45) { max = Math.round(max * 0.8); q = 0.75; }
  }
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    w: canvas.width,
    h: canvas.height,
    thumb: makeThumb(img),
    previewUrl: URL.createObjectURL(blob),
  };
}

/* ================= 기록 추가/수정 ================= */

function guessMeal() {
  const h = new Date().getHours();
  return h < 10 ? "아침" : h < 15 ? "점심" : h < 17 ? "간식" : h < 21 ? "저녁" : "야식";
}

function setRating(v) {
  state.rating = v;
  document.querySelectorAll("#f-rating button").forEach((b) => b.classList.toggle("on", Number(b.dataset.v) <= v));
}
$("#f-rating").onclick = (e) => {
  const b = e.target.closest("button");
  if (b) setRating(Number(b.dataset.v) === state.rating ? 0 : Number(b.dataset.v));
};

function setPreview(url) {
  $("#photo-preview").hidden = !url;
  $("#photo-placeholder").hidden = !!url;
  if (url) $("#photo-preview").src = url;
}

function openEntry(x = null, date = state.selected) {
  state.editing = x;
  state.pendingPhoto = null;
  $("#entry-heading").textContent = x ? "기록 수정" : "기록 추가";
  $("#f-date").value = x?.date ?? date;
  $("#f-meal").value = x?.meal ?? guessMeal();
  $("#f-title").value = x?.title ?? "";
  $("#f-place").value = x?.place ?? "";
  $("#f-memo").value = x?.memo ?? "";
  $("#photo-input").value = "";
  $("#photo-placeholder").textContent = "📷 사진 선택";
  setRating(x?.rating ?? 0);
  setPreview(x?.thumb || null);
  if (x?.hasPhoto) getPhotoUrl(x.id).then((url) => { if (url && state.editing === x && !state.pendingPhoto) setPreview(url); });
  $("#entry-dialog").showModal();
}

$("#entry-cancel").onclick = () => $("#entry-dialog").close();

$("#photo-input").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  setPreview(null);
  $("#photo-placeholder").textContent = "사진 처리 중…";
  try {
    state.pendingPhoto = await processPhoto(file);
    setPreview(state.pendingPhoto.previewUrl);
  } catch {
    $("#photo-placeholder").textContent = "📷 사진 선택";
    toast("이 사진은 읽을 수 없어요. JPG/PNG 사진을 골라주세요.");
  }
};

$("#entry-form").onsubmit = async (e) => {
  e.preventDefault();
  const btn = $("#entry-save");
  btn.disabled = true;
  btn.textContent = "저장 중…";
  try {
    const p = state.pendingPhoto;
    const data = {
      date: $("#f-date").value,
      meal: $("#f-meal").value,
      title: $("#f-title").value.trim(),
      place: $("#f-place").value.trim(),
      memo: $("#f-memo").value.trim(),
      rating: state.rating,
      updatedAt: serverTimestamp(),
    };
    if (p) Object.assign(data, { hasPhoto: true, thumb: p.thumb, photoW: p.w, photoH: p.h });

    const batch = writeBatch(db);
    const ref = state.editing ? doc(db, "meals", state.editing.id) : doc(collection(db, "meals"));
    if (state.editing) {
      batch.update(ref, data);
    } else {
      batch.set(ref, {
        hasPhoto: false, thumb: "",
        ...data,
        uid: me.uid,
        authorName: me.displayName ?? me.email.split("@")[0],
        authorPhoto: me.photoURL ?? "",
        likes: [],
        commentCount: 0,
        createdAt: serverTimestamp(),
      });
    }
    if (p) batch.set(doc(db, "photos", ref.id), { uid: me.uid, data: Bytes.fromUint8Array(p.bytes) });
    await batch.commit();

    if (p) photoCache.delete(ref.id);
    $("#entry-dialog").close();
    toast("저장했어요! 😋");
    const d = parseYmd(data.date);
    if (!sameMonth(d, state.month)) {
      goMonth(d, data.date);
    } else {
      state.selected = data.date;
      renderCalendar();
      renderDay();
    }
    if (state.view === "feed") loadFeed(true);
  } catch (err) {
    toast("저장 실패: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "저장";
  }
};

/* ================= 상세 보기 ================= */

let detailUnsubs = [];
const detailDialog = $("#detail-dialog");
detailDialog.addEventListener("close", () => {
  detailUnsubs.forEach((u) => u());
  detailUnsubs = [];
  state.detail = null;
});

function openDetail(id) {
  detailDialog.innerHTML = `<div class="detail">
    <button class="close-x" data-act="close" aria-label="닫기">✕</button>
    <div class="detail-photo" id="d-photo"></div>
    <div id="d-info"><p class="empty">불러오는 중…</p></div>
    <section class="comments">
      <h4>댓글</h4>
      <div id="d-comments"></div>
      <form id="d-comment-form" class="comment-form">
        <input id="d-comment" maxlength="300" placeholder="댓글 달기…" autocomplete="off">
        <button class="btn primary small">등록</button>
      </form>
    </section>
  </div>`;
  detailDialog.showModal();

  let photoShown = false;
  detailUnsubs.push(onSnapshot(doc(db, "meals", id), (snap) => {
    if (!snap.exists()) return detailDialog.close();
    state.detail = { id, ...snap.data() };
    if (!photoShown) { photoShown = true; renderDetailPhoto(state.detail); }
    renderDetailInfo(state.detail);
  }, (err) => toast(err.message)));

  detailUnsubs.push(onSnapshot(query(collection(db, "meals", id, "comments"), orderBy("createdAt")), (snap) => {
    $("#d-comments").innerHTML = snap.empty
      ? `<p class="empty">첫 댓글을 남겨보세요</p>`
      : snap.docs.map((d) => commentHtml(d.id, d.data())).join("");
  }, (err) => toast(err.message)));

  $("#d-comment-form").onsubmit = async (e) => {
    e.preventDefault();
    const input = $("#d-comment");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    const batch = writeBatch(db);
    batch.set(doc(collection(db, "meals", id, "comments")), {
      uid: me.uid,
      name: me.displayName ?? me.email.split("@")[0],
      photo: me.photoURL ?? "",
      text,
      createdAt: serverTimestamp(),
    });
    batch.update(doc(db, "meals", id), { commentCount: increment(1) });
    try { await batch.commit(); } catch (err) { toast("댓글 실패: " + err.message); input.value = text; }
  };
}

async function renderDetailPhoto(x) {
  const box = $("#d-photo");
  if (!x.hasPhoto) {
    box.innerHTML = `<div class="noimg big">${emojiOf(x.meal)}</div>`;
    return;
  }
  const ratio = x.photoW ? `style="aspect-ratio:${Number(x.photoW)}/${Number(x.photoH)}"` : "";
  box.innerHTML = `<img src="${esc(x.thumb)}" class="blur" alt="" ${ratio}>`;
  swapToFull(box.querySelector("img"), x.id);
}

function renderDetailInfo(x) {
  const mine = x.uid === me.uid;
  const liked = x.likes?.includes(me.uid);
  $("#d-info").innerHTML = `
    <div class="detail-head">
      ${avatar(x.authorName, x.authorPhoto, "avatar sm")}
      <div><strong>${esc(x.authorName)}</strong><span class="meta">${dayLabel(x.date)} · ${emojiOf(x.meal)} ${esc(x.meal)}</span></div>
    </div>
    <h2 class="detail-title">${esc(x.title)} <span class="stars">${stars(x.rating)}</span></h2>
    ${x.place ? `<div class="meta">📍 ${esc(x.place)}</div>` : ""}
    ${x.memo ? `<p class="memo">${esc(x.memo)}</p>` : ""}
    <div class="detail-actions">
      <button class="like-btn ${liked ? "on" : ""}" data-act="like">${liked ? "♥" : "♡"} ${x.likes?.length ?? 0}</button>
      ${mine ? `<button class="btn small push" data-act="edit">수정</button><button class="btn small danger" data-act="delete">삭제</button>` : ""}
    </div>`;
}

function commentHtml(cid, c) {
  const t = c.createdAt?.toDate?.() ?? new Date();
  const when = `${t.getMonth() + 1}/${t.getDate()} ${pad(t.getHours())}:${pad(t.getMinutes())}`;
  const canDelete = c.uid === me.uid || state.detail?.uid === me.uid;
  return `<div class="comment">
    ${avatar(c.name, c.photo, "avatar xs")}
    <div class="comment-body"><strong>${esc(c.name)}</strong> ${esc(c.text)}<span class="meta">${when}</span></div>
    ${canDelete ? `<button class="link" data-act="del-comment" data-cid="${cid}">삭제</button>` : ""}
  </div>`;
}

detailDialog.onclick = async (e) => {
  if (e.target === detailDialog) return detailDialog.close(); // 바깥 영역 클릭
  const act = e.target.closest("[data-act]")?.dataset.act;
  const x = state.detail;
  if (act === "close") return detailDialog.close();
  if (!x) return;

  if (act === "like") {
    const liked = x.likes?.includes(me.uid);
    updateDoc(doc(db, "meals", x.id), { likes: liked ? arrayRemove(me.uid) : arrayUnion(me.uid) })
      .catch((err) => toast(err.message));
  } else if (act === "edit") {
    detailDialog.close();
    openEntry(x);
  } else if (act === "delete") {
    if (!confirm("이 기록을 삭제할까요? 사진과 댓글도 함께 지워져요.")) return;
    detailDialog.close();
    try {
      const batch = writeBatch(db);
      (await getDocs(collection(db, "meals", x.id, "comments"))).forEach((c) => batch.delete(c.ref));
      batch.delete(doc(db, "photos", x.id));
      batch.delete(doc(db, "meals", x.id));
      await batch.commit();
      toast("삭제했어요");
      if (state.view === "feed") loadFeed(true);
    } catch (err) {
      toast("삭제 실패: " + err.message);
    }
  } else if (act === "del-comment") {
    const batch = writeBatch(db);
    batch.delete(doc(db, "meals", x.id, "comments", e.target.dataset.cid));
    batch.update(doc(db, "meals", x.id), { commentCount: increment(-1) });
    batch.commit().catch((err) => toast(err.message));
  }
};
