# 🍚 냠냠일기

둘이서만 쓰는 맛집 지도. 같이 간 음식점을 지도에 핀으로 찍고, 사진·메뉴·가격과 각자의 평점·후기를 남깁니다.

- **지도**: 다녀온 가게가 핀으로 표시돼요. 핀 색은 평균 평점(빨강 ★4.5↑, 주황 ★3.5↑)
- **리스트**: 월별/연도별로 묶어서 보고, 기간별 방문 횟수와 쓴 돈도 함께 보여줘요
- **앨범**: 올린 사진을 월별/연도별 사진첩으로 보기
- **기록**: 카카오맵 가게 검색, 사진 최대 10장, 메뉴별 가격(합계 자동), 각자 평점·후기
- **지난 기록 올리기**: 사진의 촬영 정보로 날짜를 자동 입력하고, 찍은 위치 근처 음식점을 추천해 줘요
- 지정한 구글 계정 2개만 접근 가능. 후기는 본인 것만 수정 가능

## 처음 설정하기

> 개인 프로젝트이므로 Firebase·GitHub는 **kimsingbung@gmail.com 계정**으로 진행합니다.

### 1. Firebase (로그인 + 데이터 저장)
1. https://console.firebase.google.com → **프로젝트 추가** (이름 예: `nyamnyam-diary`, 애널리틱스는 꺼도 됨)
2. **Authentication** → 시작하기 → Sign-in method → **Google** 사용 설정
3. **Firestore Database** → 데이터베이스 만들기 → 위치 `asia-northeast3 (서울)` → **프로덕션 모드**
4. Firestore → **규칙** 탭 → [`firestore.rules`](firestore.rules) 내용을 붙여넣고, 이메일 2개를 실제 구글 이메일(소문자)로 바꾼 뒤 **게시**
5. 프로젝트 설정(⚙️) → 내 앱 → **웹 앱(`</>`) 추가** → 나오는 `firebaseConfig` 값을 [`js/config.js`](js/config.js) ①에 붙여넣기

### 2. 카카오맵 (지도 + 가게 검색)
1. https://developers.kakao.com → 카카오계정으로 로그인 → **내 애플리케이션 → 애플리케이션 추가하기** (앱 이름: 냠냠일기)
2. **앱 키**의 **JavaScript 키**를 [`js/config.js`](js/config.js) ②에 붙여넣기
3. **플랫폼 → Web 플랫폼 등록** → 사이트 도메인에 아래 2개 등록
   - `https://kimsingbung.github.io`
   - `http://localhost:8000` (내 PC에서 테스트할 때)
4. **제품 설정 → 카카오맵** → 사용 설정 **ON** (새로 만든 앱은 이걸 켜야 지도가 나와요)

### 3. 들어올 사람 지정
[`js/config.js`](js/config.js) ③의 `MEMBERS`에 두 사람의 구글 이메일, 표시 이름, 색깔을 적어요.
**firestore.rules의 이메일 목록과 똑같아야** 합니다.

### 4. GitHub Pages로 배포
1. GitHub(kimsingbung)에서 새 저장소 `food-diary` 생성 (**Public**. 무료 계정의 Private 저장소는 Pages를 쓸 수 없어요)
2. 이 폴더를 push
3. 저장소 **Settings → Pages** → Source: `Deploy from a branch`, Branch: `main` / `(root)` → Save
4. 1~2분 뒤 `https://kimsingbung.github.io/food-diary/` 로 접속
5. Firebase 콘솔 → Authentication → **설정 → 승인된 도메인**에 `kimsingbung.github.io` 추가

이후로는 수정해서 push하면 사이트가 자동으로 갱신됩니다.

## 알아두기
- 저장소가 공개여도 괜찮아요. config.js의 키들은 원래 공개되는 값이고, 데이터는 Firestore 규칙(이메일 목록)으로, 지도 키는 카카오 도메인 등록으로 보호됩니다. 사진과 기록은 GitHub이 아니라 Firebase에 저장돼요.
- 같이 쓸 사람을 바꾸려면 config.js와 firestore.rules의 이메일을 함께 고치면 됩니다.
- 사진은 올리기 전에 자동 압축됩니다(장당 약 0.2~0.7MB). Firebase 무료 저장 용량은 1GB라 사진 2,000장 이상 올릴 수 있어요.
- 사진의 촬영 날짜·위치는 원본 사진에 정보가 남아 있을 때만 자동으로 채워져요. PC에서 원본을 올리면 잘 되고, 폰은 브라우저에 따라 위치 정보가 지워진 채로 올라올 수 있어요.
- 카카오톡에서 링크를 열면 구글 로그인이 막혀 있어서 자동으로 외부 브라우저로 열립니다.
- 폰 홈 화면에 추가하면 앱처럼 쓸 수 있어요 (Safari 공유 → 홈 화면에 추가 / Chrome 메뉴 → 홈 화면에 추가).

## 데이터 구조 (Firestore)
| 컬렉션 | 내용 |
|---|---|
| `places/{k카카오ID}` | 가게 이름, 주소, 좌표, 카테고리, 카카오맵 링크 |
| `visits/{id}` | 가게 ID, 날짜, 메뉴·가격, 사진 썸네일 목록, `reviews.{멤버id}` = 평점·후기 |
| `photos/{id}` | 원본(압축) 사진 |
