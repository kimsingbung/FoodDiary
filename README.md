# 🍚 냠냠 일기

둘이서만 쓰는 음식 일기. 그날 먹은 음식 사진과 메모를 올리고, 캘린더와 피드로 같이 봅니다.

- **캘린더**: 날짜 칸에 음식 사진 썸네일, 점 색깔로 누가 올렸는지 표시 (모바일에서는 좌우로 밀어서 달 이동)
- **피드**: 최신 기록이 위로 쌓이는 타임라인
- 별점, 장소, 메모, 좋아요, 댓글
- 구글 로그인 + **등록한 이메일 2개만 접근 가능**
- 사이트는 GitHub Pages, 데이터는 Firebase(무료 Spark 플랜)

## 처음 설정하기

### 1. Firebase 프로젝트 만들기
1. https://console.firebase.google.com 에서 **프로젝트 추가** (Google 애널리틱스는 꺼도 됩니다)
2. **Authentication** → 시작하기 → Sign-in method → **Google** 사용 설정
3. **Firestore Database** → 데이터베이스 만들기 → 위치 `asia-northeast3 (서울)` → **프로덕션 모드**
4. Firestore → **규칙** 탭 → [`firestore.rules`](firestore.rules) 내용을 붙여넣고, 이메일 2개를 실제 구글 이메일로 바꾼 뒤 **게시**
5. 프로젝트 설정(⚙️) → 내 앱 → **웹 앱(`</>`) 추가** → 나오는 `firebaseConfig` 값을 [`js/firebase-config.js`](js/firebase-config.js)에 붙여넣기

### 2. GitHub Pages로 배포
1. GitHub에서 새 저장소 생성 (예: `food-diary`, **Public**. 무료 계정에서 Private 저장소는 Pages를 쓸 수 없어요)
2. 이 폴더를 push
3. 저장소 **Settings → Pages** → Source: `Deploy from a branch`, Branch: `main` / `(root)` → Save
4. 1~2분 뒤 `https://<깃허브아이디>.github.io/food-diary/` 로 접속
5. Firebase 콘솔 → Authentication → **설정 → 승인된 도메인**에 `<깃허브아이디>.github.io` 추가

이후로는 코드를 수정해서 push하면 사이트가 자동으로 갱신됩니다.

## 알아두기
- 저장소가 공개여도 괜찮아요. `firebase-config.js` 값은 원래 공개되는 값이고, 데이터는 Firestore 규칙의 이메일 목록으로만 보호됩니다. 음식 사진·메모는 GitHub이 아니라 Firebase에 저장됩니다.
- 같이 쓸 사람을 바꾸려면 Firebase 콘솔에서 규칙의 이메일 목록만 고쳐서 다시 게시하면 됩니다.
- 사진은 업로드 전에 자동으로 압축됩니다(장당 약 0.2~0.9MB). 무료 저장 용량은 1GB라 하루 6장 기준 대략 1~2년 정도 쓸 수 있어요.
- 카카오톡으로 링크를 열면 구글 로그인이 막혀 있어서 자동으로 외부 브라우저로 열립니다. iPhone에서는 Safari로 열어주세요.
- 폰 홈 화면에 추가하면 앱처럼 쓸 수 있어요 (Safari 공유 → 홈 화면에 추가 / Chrome 메뉴 → 홈 화면에 추가).

## 로컬에서 실행
```
python -m http.server 8000
```
→ http://localhost:8000 (localhost는 Firebase 승인된 도메인에 기본 포함)
