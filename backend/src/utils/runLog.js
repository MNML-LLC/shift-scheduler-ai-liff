/**
 * cron実行の構造化ログユーティリティ
 * Railwayログで `[CRON]` プレフィックスの1行JSONとして grep できる形式で出力する
 */

/**
 * 実行IDを生成
 * @returns {string} 例: "20260721T001500Z-a3f9"
 */
export function newRunId() {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const rand = Math.random().toString(16).slice(2, 6).padEnd(4, '0');
  return `${stamp}-${rand}`;
}

/**
 * cron実行サマリを1行JSONとして stdout へ出力
 * @param {Object} entry - CronRunSummary
 */
export function logCronRun(entry) {
  console.log(`[CRON] ${JSON.stringify(entry)}`);
}
