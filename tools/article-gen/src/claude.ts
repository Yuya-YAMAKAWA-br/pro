import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const MODEL = "claude-opus-4-7";

let cachedSystemBlocks: Anthropic.TextBlockParam[] | null = null;

async function loadSystemBlocks(): Promise<Anthropic.TextBlockParam[]> {
  if (cachedSystemBlocks) return cachedSystemBlocks;

  const here = path.dirname(fileURLToPath(import.meta.url));
  const promptsDir = path.resolve(here, "..", "prompts");
  const styleGuide = await readFile(path.join(promptsDir, "style-guide.md"), "utf8");
  const sampleArticle = await readFile(path.join(promptsDir, "sample-article.md"), "utf8");

  const blocks: Anthropic.TextBlockParam[] = [
    {
      type: "text",
      text:
        "あなたは日本語の Web メディアのライターです。以下のスタイルガイドとサンプル記事を厳格に守って、" +
        "WordPress に下書き投稿する記事を執筆します。スタイルガイドの指示は最優先で、ユーザーの追加指示と矛盾する場合はスタイルガイドを優先してください。",
    },
    {
      type: "text",
      text: `# スタイルガイド\n\n${styleGuide}`,
    },
    {
      type: "text",
      text: `# サンプル記事\n\n${sampleArticle}`,
      cache_control: { type: "ephemeral" },
    },
  ];

  cachedSystemBlocks = blocks;
  return blocks;
}

export interface ResearchResult {
  summary: string;
  keyFacts: string[];
  sources: { title: string; url: string }[];
}

export async function researchTopic(
  client: Anthropic,
  keyword: string,
): Promise<ResearchResult> {
  const system = await loadSystemBlocks();

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    system,
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }],
    messages: [
      {
        role: "user",
        content:
          `次のキーワードで日本語の記事を書くために、最新のリサーチをしてください: 「${keyword}」\n\n` +
          `必要に応じて web_search を使って、信頼できる情報源(公式ドキュメント、大手メディア、最新ニュース)を中心に調べてください。\n\n` +
          `終わったら、以下を日本語の自然文で出力してください(JSON ではなく素のテキストで OK):\n` +
          `1. 「## 要約」: 2〜4 文の要約\n` +
          `2. 「## 重要ファクト」: 5〜10 個の箇条書き(数字や固有名詞を必ず含める)\n` +
          `3. 「## 参考にしたソース」: タイトルと URL を箇条書き\n`,
      },
    ],
  });

  const message = await stream.finalMessage();

  let text = "";
  for (const block of message.content) {
    if (block.type === "text") text += block.text;
  }

  return parseResearchText(text);
}

function parseResearchText(text: string): ResearchResult {
  const summary = sectionAfter(text, /^##\s*要約/m);
  const factsBlock = sectionAfter(text, /^##\s*重要ファクト/m);
  const sourcesBlock = sectionAfter(text, /^##\s*参考にしたソース/m);

  const keyFacts = factsBlock
    .split("\n")
    .map((l) => l.replace(/^[-*・\d.\s]+/, "").trim())
    .filter((l) => l.length > 0);

  const sources: { title: string; url: string }[] = [];
  for (const line of sourcesBlock.split("\n")) {
    const m = line.match(/(https?:\/\/\S+)/);
    if (!m || !m[1]) continue;
    const url = m[1].replace(/[)\].,]+$/, "");
    const title = line.replace(/^[-*・\d.\s]+/, "").replace(url, "").replace(/[\[\](){}]/g, "").trim() || url;
    sources.push({ title, url });
  }

  return { summary: summary.trim(), keyFacts, sources };
}

function sectionAfter(text: string, headerRe: RegExp): string {
  const match = headerRe.exec(text);
  if (!match) return "";
  const start = match.index + match[0].length;
  const rest = text.slice(start);
  const nextHeader = /^##\s/m.exec(rest);
  return nextHeader ? rest.slice(0, nextHeader.index) : rest;
}

export async function generateArticleHtml(
  client: Anthropic,
  keyword: string,
  research: ResearchResult,
): Promise<string> {
  const system = await loadSystemBlocks();

  const userPrompt =
    `# 執筆依頼\n\n` +
    `**キーワード**: ${keyword}\n\n` +
    `## リサーチ要約\n${research.summary}\n\n` +
    `## 押さえるべきファクト\n${research.keyFacts.map((f) => `- ${f}`).join("\n")}\n\n` +
    `## 参考ソース\n${research.sources.map((s) => `- ${s.title} ${s.url}`).join("\n")}\n\n` +
    `---\n\n` +
    `スタイルガイドに従って WordPress 用の記事本文を HTML で書いてください。\n` +
    `- 出力は HTML 本文のみ(マークダウンや前置き・後書きの説明は一切含めない)\n` +
    `- \`<h1>\` は使わない(WP のタイトルと重複するため)。\`<h2>\` から始める\n` +
    `- 各 H2 セクションには必ず \`<!-- IMAGE: ... -->\` を 1 つ入れる(英語の生成プロンプト)\n` +
    `- 操作手順は \`<ol><li>\` で番号付きリスト化\n` +
    `- 重要な注意は段落末尾に \`<p><strong>重要:</strong> ...</p>\` で置く\n` +
    `- 末尾は \`<h2>まとめ</h2>\` の段落 + \`<!-- RELATED -->\` で締める\n`;

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    system,
    messages: [{ role: "user", content: userPrompt }],
  });

  const message = await stream.finalMessage();

  let html = "";
  for (const block of message.content) {
    if (block.type === "text") html += block.text;
  }

  return stripCodeFence(html).trim();
}

function stripCodeFence(text: string): string {
  const fence = /^```(?:html|HTML)?\s*\n([\s\S]*?)\n```\s*$/m;
  const m = fence.exec(text.trim());
  return m ? (m[1] ?? "") : text;
}

const MetaSchema = z.object({
  title: z.string().describe("SEO に強い 32 文字以内の記事タイトル"),
  slug: z.string().describe("URL に使う英数ハイフンのスラッグ。30 文字以内"),
  excerpt: z.string().describe("検索結果に出る抜粋。120 文字以内"),
  featured_image_prompt: z
    .string()
    .describe("アイキャッチ画像の英語プロンプト(nanobanana 用)"),
});

export type ArticleMeta = z.infer<typeof MetaSchema>;

export async function generateMeta(
  client: Anthropic,
  keyword: string,
  articleHtml: string,
): Promise<ArticleMeta> {
  const system = await loadSystemBlocks();

  const userPrompt =
    `次の記事のメタ情報を出力してください。\n\n` +
    `## キーワード\n${keyword}\n\n` +
    `## 記事本文(HTML)\n${articleHtml}\n`;

  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 4000,
    system,
    messages: [{ role: "user", content: userPrompt }],
    output_config: {
      format: zodToJsonSchemaFormat(MetaSchema),
    },
  });

  if (!response.parsed_output) {
    throw new Error("Failed to parse meta JSON from Claude response");
  }
  return MetaSchema.parse(response.parsed_output);
}

function zodToJsonSchemaFormat(schema: z.ZodObject<z.ZodRawShape>) {
  const properties: Record<string, { type: string; description?: string }> = {};
  const required: string[] = [];
  for (const [key, value] of Object.entries(schema.shape)) {
    const desc = value.description;
    properties[key] = desc ? { type: "string", description: desc } : { type: "string" };
    required.push(key);
  }
  return {
    type: "json_schema" as const,
    schema: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    },
  };
}

export function extractImagePrompts(html: string): string[] {
  const re = /<!--\s*IMAGE:\s*([\s\S]*?)\s*-->/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[1]) out.push(m[1].trim());
  }
  return out;
}
