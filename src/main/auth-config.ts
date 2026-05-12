/**
 * 앱의 인증 전용 Supabase 프로젝트 정보 (=로그인 백엔드).
 *
 * 이 값은 RLS로 보호되는 anon key라 클라이언트 노출되어도 안전합니다.
 * 사용자가 환경설정(secrets.json)에 넣는 크롤링 데이터 저장용 키와는 별개.
 * (지금은 같은 프로젝트지만 향후 분리 가능)
 */
export const AUTH_SUPABASE_URL = "https://xsjyvxbnmwwsdvyofjfy.supabase.co";
export const AUTH_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhzanl2eGJubXd3c2R2eW9mamZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzMTcyOTksImV4cCI6MjA3MDg5MzI5OX0.ElgHe_GtShBBl8uN2D9oX6EAUqIV7DxLgTcQA54s6x8";

/**
 * 이메일별 환경설정 기본값.
 * 로그인 성공 시 SettingsPage에 prefill 됩니다.
 * (사용자가 이미 secrets.json에 다른 값 저장해 뒀으면 그대로 유지)
 */
export const DEFAULT_SETTINGS_BY_EMAIL: Record<
  string,
  { url: string; anonKey: string; table: string }
> = {
  "jungsik.jeong@lcnine.kr": {
    url: "https://xsjyvxbnmwwsdvyofjfy.supabase.co",
    anonKey: AUTH_SUPABASE_ANON_KEY,
    table: "",
  },
};

export function getDefaultSettingsForEmail(email: string) {
  return DEFAULT_SETTINGS_BY_EMAIL[email.toLowerCase().trim()];
}
