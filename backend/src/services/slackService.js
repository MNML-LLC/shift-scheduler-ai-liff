/**
 * Slack Incoming Webhook 通知サービス
 * cron発火サマリ・エラーアラートを #agent-alerts へ投稿する
 *
 * - SLACK_WEBHOOK_URL 未設定時は no-op（warn のみ、falseを返す）
 * - 投稿失敗・タイムアウトは内部で握り、呼び出し元へ throw しない
 * - ログに webhook URL 自体は出力しない
 */

const SLACK_TIMEOUT_MS = 5000;

/**
 * Slack Incoming Webhook へペイロードを POST
 * @param {Object} payload - Slack webhook ペイロード（例: { text: '...' }）
 * @returns {Promise<boolean>} 投稿成功なら true（未設定・失敗は false、throwしない）
 */
export async function postSlack(payload) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;

  if (!webhookUrl) {
    console.warn(
      '⚠️ SLACK_WEBHOOK_URL is not set, skipping Slack notification'
    );
    return false;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SLACK_TIMEOUT_MS);

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn(`⚠️ Slack webhook returned status ${response.status}`);
      return false;
    }

    return true;
  } catch (error) {
    console.warn(`⚠️ Slack webhook post failed: ${error.message}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * cron実行の成功サマリをSlackへ投稿
 * SLACK_NOTIFY_ON_SUCCESS === 'false' の場合は投稿を抑制する
 * @param {Object} summary - CronRunSummary
 * @returns {Promise<boolean>} 投稿成功なら true
 */
export async function notifyCronRun(summary) {
  if (process.env.SLACK_NOTIFY_ON_SUCCESS === 'false') {
    return false;
  }

  const lines = [
    `:alarm_clock: シフトリマインダー cron 実行 (${summary.timezone})`,
    `• runId: ${summary.runId}`,
    `• 発火時刻: ${summary.firedAt}`,
    `• 対象月: ${summary.targetYear}/${summary.targetMonth}`,
    `• 結果: ${summary.outcome}${summary.reason ? ` (${summary.reason})` : ''}`,
  ];

  if (summary.stats) {
    lines.push(
      `• 提出状況: ${summary.stats.submittedCount}/${summary.stats.totalCount} 提出済み（未提出 ${summary.stats.unsubmittedCount}名）`
    );
  }

  lines.push(`• 所要時間: ${summary.durationMs}ms`);

  return postSlack({ text: lines.join('\n') });
}

/**
 * cron実行のエラーアラートをSlackへ投稿（常時投稿）
 * @param {Object} ctx - { runId, firedAt, error }
 * @returns {Promise<boolean>} 投稿成功なら true
 */
export async function notifyCronError({ runId, firedAt, error }) {
  const text = [
    ':rotating_light: シフトリマインダー cron 実行失敗',
    `• runId: ${runId}`,
    `• 発火時刻: ${firedAt}`,
    `• エラー: ${error?.message || String(error)}`,
  ].join('\n');

  return postSlack({ text });
}
