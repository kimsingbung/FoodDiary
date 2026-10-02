// Firebase 콘솔 → 프로젝트 설정 → 내 앱 → 웹 앱의 "SDK 설정 및 구성"에 나오는 값을 붙여넣으세요.
// 이 값들은 공개되어도 괜찮습니다. 실제 보호는 firestore.rules 의 이메일 목록이 담당합니다.
export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};
