// ① Firebase 웹 앱 설정 (Firebase 콘솔 → 프로젝트 설정 → 내 앱)
export const firebaseConfig = {
  apiKey: "AIzaSyDLZutEzy_8Zu3Dp7XUisQWbZPPsZGwArM",
  authDomain: "yamyam-diary.firebaseapp.com",
  projectId: "yamyam-diary",
  storageBucket: "yamyam-diary.firebasestorage.app",
  messagingSenderId: "979840525494",
  appId: "1:979840525494:web:0dceb0a6bdb12d167f3217",
};

// ② 카카오 개발자 콘솔 → 내 애플리케이션 → 앱 키의 "JavaScript 키"
export const KAKAO_JS_KEY = "YOUR_KAKAO_JAVASCRIPT_KEY";

// ③ 들어올 수 있는 사람. 공개 저장소에 이메일이 드러나지 않도록 "소문자 이메일의 SHA-256 해시"를 키로 씁니다.
//    해시 구하기 (PowerShell):
//      $e="someone@gmail.com"; -join ([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($e)) | % { $_.ToString("x2") })
//    id 는 후기 저장에 쓰이니 한 번 정하면 바꾸지 마세요. 이름과 색깔은 언제든 바꿔도 됩니다.
//    실제 접근 제한은 Firestore 규칙(private/firestore.rules)이 담당하니 두 곳을 함께 맞춰주세요.
export const MEMBERS = {
  "37815a655aa847b9ee3981b279192e8b81afbc348b5de29da9bfb97530f1d436": { id: "a", name: "유미", color: "#e5677f" },
  "182a148e986f3b7a59ba61bc19967ec9aaf062372adf8f2d6155f834d8517649": { id: "b", name: "거니", color: "#e0a100" },
};

// 이 값들은 공개되어도 괜찮습니다. 데이터는 Firestore 규칙이, 지도 키는 카카오 도메인 등록이 보호합니다.
