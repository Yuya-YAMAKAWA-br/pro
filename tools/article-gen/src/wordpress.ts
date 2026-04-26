export interface WpConfig {
  baseUrl: string;
  username: string;
  appPassword: string;
  defaultCategoryIds?: number[];
  defaultTagIds?: number[];
  defaultAuthorId?: number;
}

export interface DraftPostInput {
  title: string;
  slug: string;
  excerpt: string;
  contentHtml: string;
}

export interface DraftPostResult {
  id: number;
  link: string;
  editUrl: string;
}

export function loadWpConfigFromEnv(): WpConfig {
  const baseUrl = required("WP_BASE_URL").replace(/\/$/, "");
  const username = required("WP_USERNAME");
  const appPassword = required("WP_APP_PASSWORD").replace(/\s+/g, "");
  return {
    baseUrl,
    username,
    appPassword,
    defaultCategoryIds: parseIdList(process.env["WP_DEFAULT_CATEGORY_IDS"]),
    defaultTagIds: parseIdList(process.env["WP_DEFAULT_TAG_IDS"]),
    defaultAuthorId: parseId(process.env["WP_DEFAULT_AUTHOR_ID"]),
  };
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function parseIdList(s: string | undefined): number[] | undefined {
  if (!s) return undefined;
  const ids = s
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0)
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n));
  return ids.length > 0 ? ids : undefined;
}

function parseId(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const n = Number(s.trim());
  return Number.isFinite(n) ? n : undefined;
}

export async function createDraftPost(
  cfg: WpConfig,
  input: DraftPostInput,
): Promise<DraftPostResult> {
  const url = `${cfg.baseUrl}/wp-json/wp/v2/posts`;
  const auth = Buffer.from(`${cfg.username}:${cfg.appPassword}`).toString("base64");

  const body: Record<string, unknown> = {
    title: input.title,
    slug: input.slug,
    excerpt: input.excerpt,
    content: input.contentHtml,
    status: "draft",
  };
  if (cfg.defaultCategoryIds) body["categories"] = cfg.defaultCategoryIds;
  if (cfg.defaultTagIds) body["tags"] = cfg.defaultTagIds;
  if (cfg.defaultAuthorId) body["author"] = cfg.defaultAuthorId;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `WordPress API ${res.status} ${res.statusText}: ${text.slice(0, 500)}`,
    );
  }

  const data = (await res.json()) as { id: number; link: string };
  const editUrl = `${cfg.baseUrl}/wp-admin/post.php?post=${data.id}&action=edit`;
  return { id: data.id, link: data.link, editUrl };
}
