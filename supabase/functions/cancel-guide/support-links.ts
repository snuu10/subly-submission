/** 검색 실패 폴백용 공식 고객센터. 검수된 링크만 둔다. */

export type SupportLink = {
  service_id: string;
  name: string;
  aliases: string[];
  url: string;
  domains: string[];
  country: "KR";
  platform?: "ios" | "android" | "web";
  billing_channel?: "direct_web" | "apple_app_store" | "google_play" | "carrier" | "unknown";
  verified_at: string;
};

export const SUPPORT_LINKS: SupportLink[] = [
  {
    service_id: "netflix",
    name: "넷플릭스",
    aliases: ["넷플릭스", "netflix"],
    url: "https://help.netflix.com/ko/node/407",
    domains: ["help.netflix.com", "netflix.com"],
    country: "KR",
    verified_at: "2026-08-30",
  },
  {
    service_id: "youtube_premium",
    name: "유튜브 프리미엄",
    aliases: [
      "유튜브",
      "유튜브프리미엄",
      "youtube",
      "youtube premium",
      "youtube-premium",
      "youtube_premium",
    ],
    url: "https://support.google.com/youtube/answer/6308278?hl=ko&co=GENIE.Platform%3DAndroid",
    domains: ["support.google.com", "youtube.com"],
    country: "KR",
    platform: "android",
    billing_channel: "google_play",
    verified_at: "2026-08-30",
  },
  {
    service_id: "disney_plus",
    name: "디즈니+",
    aliases: ["디즈니", "디즈니플러스", "disney", "disney+", "disney-plus", "disney_plus"],
    url: "https://help.disneyplus.com/ko/article/disneyplus-cancel",
    domains: ["help.disneyplus.com", "disneyplus.com"],
    country: "KR",
    verified_at: "2026-08-30",
  },
];

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[-_\s+]+/g, "");
}

export function findSupportLink(query: string): SupportLink | undefined {
  const needle = normalize(query);
  if (!needle) return undefined;

  const exact = SUPPORT_LINKS.find((item) => {
    const names = [item.service_id, item.name, ...item.aliases].map(normalize);
    return names.includes(needle);
  });
  if (exact) return exact;

  return SUPPORT_LINKS.find((item) => {
    const names = [item.service_id, item.name, ...item.aliases].map(normalize);
    return names.some((name) => name.length >= 2 && (needle.includes(name) || name.includes(needle)));
  });
}

function matchServiceId(serviceId: string | null): SupportLink | undefined {
  if (!serviceId) return undefined;
  const needle = normalize(serviceId);
  return SUPPORT_LINKS.find((item) => normalize(item.service_id) === needle);
}

function linkApplies(
  link: SupportLink,
  context: {
    country?: string;
    platform?: string | null;
    billingChannel?: string | null;
  },
): boolean {
  if (link.country !== (context.country ?? "KR")) return false;
  if (link.platform && link.platform !== context.platform) return false;
  if (link.billing_channel && link.billing_channel !== context.billingChannel) return false;
  return true;
}

export function domainsFor(serviceId: string | null, query: string): string[] {
  const hit = matchServiceId(serviceId) ?? findSupportLink(query);
  return hit?.domains ?? [];
}

export function fallbackUrl(input: {
  serviceId: string | null;
  query: string;
  country?: string;
  platform?: string | null;
  billingChannel?: string | null;
}): string | null {
  const hit = matchServiceId(input.serviceId) ?? findSupportLink(input.query);
  if (!hit) return null;
  if (!linkApplies(hit, input)) return null;
  return hit.url;
}
