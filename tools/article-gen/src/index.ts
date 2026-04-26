import "dotenv/config";
import { run } from "./pipeline.js";

interface ParsedArgs {
  keyword: string;
  dryRun: boolean;
  showHelp: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  let keyword = "";
  let dryRun = false;
  let showHelp = false;
  for (const a of args) {
    if (a === "--help" || a === "-h") showHelp = true;
    else if (a === "--dry-run") dryRun = true;
    else if (a.startsWith("--keyword=")) keyword = a.slice("--keyword=".length);
    else if (!a.startsWith("--") && keyword === "") keyword = a;
  }
  return { keyword, dryRun, showHelp };
}

function printHelp() {
  process.stdout.write(
    `Usage: npm run gen -- "<keyword>" [--dry-run]\n\n` +
      `  --dry-run    Generate the article and print to stdout, without posting to WordPress\n` +
      `  --help, -h   Show this help\n\n` +
      `Required env vars (set in .env):\n` +
      `  ANTHROPIC_API_KEY\n` +
      `  WP_BASE_URL, WP_USERNAME, WP_APP_PASSWORD (omit when --dry-run)\n`,
  );
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.showHelp || !args.keyword) {
    printHelp();
    process.exit(args.showHelp ? 0 : 1);
  }

  const result = await run({ keyword: args.keyword, dryRun: args.dryRun });

  if (args.dryRun) {
    process.stdout.write("\n=== TITLE ===\n" + result.meta.title + "\n");
    process.stdout.write("\n=== SLUG ===\n" + result.meta.slug + "\n");
    process.stdout.write("\n=== EXCERPT ===\n" + result.meta.excerpt + "\n");
    process.stdout.write(
      "\n=== FEATURED IMAGE PROMPT ===\n" + result.meta.featured_image_prompt + "\n",
    );
    process.stdout.write("\n=== IMAGE PROMPTS (in body) ===\n");
    result.imagePrompts.forEach((p, i) => {
      process.stdout.write(`[${i + 1}] ${p}\n`);
    });
    process.stdout.write("\n=== HTML ===\n" + result.contentHtml + "\n");
    return;
  }

  if (result.post) {
    process.stdout.write(`\n下書きを作成しました:\n  ${result.post.editUrl}\n\n`);
    if (result.imagePrompts.length > 0) {
      process.stdout.write(`各 H2 用の画像プロンプト(nanobanana 等で生成して手動アップロード):\n`);
      result.imagePrompts.forEach((p, i) => {
        process.stdout.write(`  [${i + 1}] ${p}\n`);
      });
    }
    process.stdout.write(`\nアイキャッチ用プロンプト:\n  ${result.meta.featured_image_prompt}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`\nエラー: ${err instanceof Error ? err.message : String(err)}\n`);
  if (err instanceof Error && err.stack) {
    process.stderr.write(err.stack + "\n");
  }
  process.exit(1);
});
