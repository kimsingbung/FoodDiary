// ① Firebase 콘솔 → 프로젝트 설정 → 내 앱 → 웹 앱의 "SDK 설정 및 구성" 값을 붙여넣으세요.
export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

// ② 카카오 개발자 콘솔 → 내 애플리케이션 → 앱 키의 "JavaScript 키"
export const KAKAO_JS_KEY = "YOUR_KAKAO_JAVASCRIPT_KEY";

// ③ 들어올 수 있는 사람. 이메일은 소문자로, firestore.rules 의 목록과 똑같이 맞춰주세요.
//    id 는 후기 저장에 쓰이니 한 번 정하면 바꾸지 마세요. 이름과 색깔은 언제든 바꿔도 됩니다.
export const MEMBERS = {
  "me@gmail.com": { id: "a", name: "나", color: "#e8743b" },
  "friend@gmail.com": { id: "b", name: "짝꿍", color: "#3f9a8a" },
};

// 이 값들은 공개되어도 괜찮습니다. 실제 보호는 firestore.rules 와 카카오 도메인 등록이 담당합니다.
