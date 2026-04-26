import Anthropic from "@anthropic-ai/sdk";
import {
  researchTopic,
  generateArticleHtml,
  generateMeta,
  extractImagePrompts,
  type ArticleMeta,
  type ResearchResult,
} from "./claude.js";
import {
  createDraftPost,
  loadWpConfigFromEnv,
  type DraftPostResult,
} from "./wordpress.js";

export interface RunOptions {
  keyword: string;
  dryRun: boolean;
}

export interface RunResult {
  research: ResearchResult;
  meta: ArticleMeta;
  contentHtml: string;
  imagePrompts: string[];
  post?: DraftPostResult;
}

export async function run(opts: RunOptions): Promise<RunResult> {
  const client = new Anthropic();

  log("1/4 リサーチ中...");
  const research = await researchTopic(client, opts.keyword);
  log(`  → 重要ファクト ${research.keyFacts.length} 件 / ソース ${research.sources.length} 件`);

  log("2/4 本文生成中...");
  const contentHtml = await generateArticleHtml(client, opts.keyword, research);
  log(`  → ${contentHtml.length} 文字`);

  log("3/4 タイトル/メタ/画像プロンプト生成中...");
  const meta = await generateMeta(client, opts.keyword, contentHtml);
  const imagePrompts = extractImagePrompts(contentHtml);
  log(`  → タイトル: ${meta.title}`);
  log(`  → 画像プロンプト ${imagePrompts.length} 件`);

  if (opts.dryRun) {
    log("4/4 ドライラン: WordPress には投稿しません");
    return { research, meta, contentHtml, imagePrompts };
  }

  log("4/4 WordPress に下書き投稿中...");
  const wp = loadWpConfigFromEnv();
  const post = await createDraftPost(wp, {
    title: meta.title,
    slug: meta.slug,
    excerpt: meta.excerpt,
    contentHtml,
  });
  log(`  → 投稿 ID ${post.id} / 編集 URL: ${post.editUrl}`);

  return { research, meta, contentHtml, imagePrompts, post };
}

function log(msg: string) {
  process.stderr.write(`[article-gen] ${msg}\n`);
}
