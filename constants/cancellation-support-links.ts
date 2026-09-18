export type SupportLink = {
  service_id: string;
  name: string;
  url: string;
  country: "KR";
  platform?: "ios" | "android" | "web";
  billing_channel?: "direct_web" | "apple_app_store" | "google_play" | "carrier" | "unknown";
  verified_at: string;
};

/**
 * 검색 실패 폴백. Edge Function `support-links.ts`와 동일해야 한다.
 * 플랫폼·결제 채널이 있는 항목은 그 조건이 맞을 때만 표시한다.
 */
export const CANCELLATION_SUPPORT_LINKS: SupportLink[] = [
  {
    service_id: "netflix",
    name: "넷플릭스",
    url: "https://help.netflix.com/ko/node/407",
    country: "KR",
    verified_at: "2026-08-30",
  },
  {
    service_id: "youtube_premium",
    name: "유튜브 프리미엄",
    url: "https://support.google.com/youtube/answer/6308278?hl=ko&co=GENIE.Platform%3DAndroid",
    country: "KR",
    platform: "android",
    billing_channel: "google_play",
    verified_at: "2026-08-30",
  },
  {
    service_id: "disney_plus",
    name: "디즈니+",
    url: "https://help.disneyplus.com/ko/article/disneyplus-cancel",
    country: "KR",
    verified_at: "2026-08-30",
  },
];
