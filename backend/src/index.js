import express from 'express';
import dotenv from 'dotenv';
import cron from 'node-cron';
import {
  sendAutoReminder,
  sendShiftReminders,
  sendReminderByPhase,
  getAutoReminderTarget,
  getAutoRemindPhases,
} from './services/reminderService.js';
import webhookRouter from './routes/webhook.js';
import notificationRouter from './routes/notification.js';
import deadlineSettingsRouter from './routes/deadlineSettings.js';
import { getNotificationConfig } from './services/lineService.js';
import { newRunId, logCronRun } from './utils/runLog.js';
import { notifyCronRun, notifyCronError } from './services/slackService.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

// ===== Cron可観測性 =====

const config = getNotificationConfig();
const cronSchedule = config.cronSchedule || '0 9 * * *';
const tz = config.settings?.timezone || 'Asia/Tokyo';

// 直近のcron実行サマリ（メモリ保持のみ・DB保存なし）
let lastCronRun = null;

// CronRunSummary を組み立てる（個人情報は含めない: statsは件数のみ）
function buildCronRunSummary({
  runId,
  firedAt,
  result,
  error,
  startedMs,
  targetYear,
  targetMonth,
}) {
  const summary = {
    event: 'cron_run',
    runId,
    firedAt,
    timezone: tz,
    targetYear,
    targetMonth,
    outcome: 'noop',
    phase: null,
    type: null,
    notified: false,
    reason: null,
    stats: null,
    durationMs: Date.now() - startedMs,
    error: null,
  };

  if (error) {
    summary.outcome = 'error';
    summary.error = error.message || String(error);
    return summary;
  }

  summary.notified = Boolean(result?.notified);
  summary.phase = result?.phase ?? result?.skippedPhase ?? null;
  summary.type = result?.type ?? null;
  summary.reason = result?.reason ?? null;

  if (result?.stats) {
    summary.stats = {
      totalCount: result.stats.totalCount,
      submittedCount: result.stats.submittedCount,
      unsubmittedCount: result.stats.unsubmittedCount,
    };
  }

  if (summary.notified) {
    summary.outcome = 'sent';
  } else if (summary.reason === 'No phase matched') {
    summary.outcome = 'noop';
  } else {
    summary.outcome = 'skipped';
  }

  return summary;
}

// 自動リマインドを実行し、計測・ログ・Slack通知・lastCronRun 更新を行う
// （cron と POST /api/send-auto-reminder の両方から呼ばれる）
// year/month 省略時は getAutoReminderTarget()（来月分）を対象にする
async function runObservedAutoReminder({ year, month } = {}) {
  const runId = newRunId();
  const firedAt = new Date().toISOString();
  const startedMs = Date.now();

  // 実送信とサマリで同じ対象月を使う（明示指定があればそれを優先）
  const { targetYear, targetMonth } =
    year && month
      ? { targetYear: year, targetMonth: month }
      : getAutoReminderTarget();

  try {
    const result = await sendAutoReminder(targetYear, targetMonth);
    const summary = buildCronRunSummary({
      runId,
      firedAt,
      result,
      startedMs,
      targetYear,
      targetMonth,
    });
    lastCronRun = summary;
    logCronRun(summary);
    await notifyCronRun(summary);
    return { summary, result };
  } catch (error) {
    const summary = buildCronRunSummary({
      runId,
      firedAt,
      error,
      startedMs,
      targetYear,
      targetMonth,
    });
    lastCronRun = summary;
    logCronRun(summary);
    await notifyCronError({ runId, firedAt, error });
    throw error;
  }
}

// ===== ルート設定 =====

// ヘルスチェック
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Shift Reminder Service',
    timestamp: new Date().toISOString(),
    endpoints: {
      webhook: '/api/webhook/line',
      notification: '/api/notification/*',
      sendReminder: '/api/send-reminder',
      sendReminderPhase: '/api/send-reminder-phase',
      cronStatus: '/api/cron-status',
      deadlineSettings: '/api/liff/deadline-settings',
    },
  });
});

// 直近のcron実行サマリを返す（未発火時は null。個人情報は含めない）
app.get('/api/cron-status', (req, res) => {
  res.json({ lastRun: lastCronRun });
});

// LINE Webhook
app.use('/api/webhook', webhookRouter);

// 通知API（第1案・第2案承認通知）
app.use('/api/notification', notificationRouter);

// 締め切り設定API（管理者向け、Basic Auth）
app.use('/api/liff', deadlineSettingsRouter);

// 手動でリマインダーを送信するエンドポイント（テスト用）
app.post('/api/send-reminder', async (req, res) => {
  try {
    const { year, month } = req.body;

    if (!year || !month) {
      return res.status(400).json({
        success: false,
        error: 'year and month are required',
      });
    }

    const result = await sendShiftReminders(year, month);

    res.json({
      success: true,
      message: `Reminder check completed for ${year}/${month}`,
      ...result,
    });
  } catch (error) {
    console.error('Error sending reminders:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// 自動リマインド実行（テスト用）
// year/month を指定すると対象月を明示できる（省略時は来月分）
app.post('/api/send-auto-reminder', async (req, res) => {
  try {
    const { year, month } = req.body || {};

    if ((year && !month) || (!year && month)) {
      return res.status(400).json({
        success: false,
        error: 'year and month must be specified together (or both omitted)',
      });
    }

    const { result } = await runObservedAutoReminder({ year, month });

    res.json({
      success: true,
      message: 'Auto reminder executed',
      ...result,
    });
  } catch (error) {
    console.error('Error in auto reminder:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// フェーズを指定してリマインダーを送信（手動送信用）
app.post('/api/send-reminder-phase', async (req, res) => {
  try {
    const { year, month, phase } = req.body;

    if (!year || !month || !phase) {
      return res.status(400).json({
        success: false,
        error: 'year, month, and phase are required',
        usage: {
          year: 'number (e.g., 2026)',
          month: 'number (1-12)',
          phase: 'number (1=7日前, 2=3日前, 3=1日前, 4=締切後)',
        },
      });
    }

    const phaseNumber = parseInt(phase, 10);
    if (phaseNumber < 1 || phaseNumber > 4) {
      return res.status(400).json({
        success: false,
        error: 'phase must be 1, 2, 3, or 4',
        phases: {
          1: '7日前リマインド（匿名）',
          2: '3日前リマインド（統計付き）',
          3: '1日前リマインド（名前入り）',
          4: '締切後通知',
        },
      });
    }

    const result = await sendReminderByPhase(year, month, phaseNumber);

    res.json({
      success: true,
      message: `Phase ${phaseNumber} reminder sent for ${year}/${month}`,
      ...result,
    });
  } catch (error) {
    console.error('Error sending phase reminder:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ===== Cronジョブ設定 =====

// 毎日定時にリマインド通知をチェック
// AUTO_REMIND_PHASES で有効化されたフェーズ（デフォルト: 1,2,3,4）を自動送信
// timezone を渡さないと UTC 基準で発火するため、必ず JST を指定する
cron.schedule(
  cronSchedule,
  async () => {
    console.log('⏰ Cron job triggered at', new Date().toISOString());

    try {
      const { summary } = await runObservedAutoReminder();
      console.log('✅ Cron job completed:', summary.outcome);
    } catch (error) {
      console.error('❌ Cron job failed:', error);
    }
  },
  { timezone: tz }
);

// ===== サーバー起動 =====

app.listen(PORT, () => {
  console.log('===========================================');
  console.log(`🚀 Shift Reminder Service running on port ${PORT}`);
  console.log(`📅 Cron schedule: ${cronSchedule} (${tz})`);
  console.log(
    `📋 Cron behavior: auto-send phases [${getAutoRemindPhases().join(', ')}] (AUTO_REMIND_PHASES)`
  );
  console.log(
    `📵 Notification enabled: ${process.env.NOTIFICATION_ENABLED !== 'false'}`
  );
  console.log('===========================================');
  console.log('Available endpoints:');
  console.log('  GET  /                           - Health check');
  console.log('  GET  /api/cron-status            - Last cron run summary');
  console.log('  POST /api/webhook/line           - LINE Webhook');
  console.log('  POST /api/notification/first-plan-approved');
  console.log('  POST /api/notification/second-plan-approved');
  console.log('  POST /api/notification/test      - Test notification');
  console.log(
    '  POST /api/send-reminder          - Manual reminder (day-based)'
  );
  console.log('  POST /api/send-auto-reminder     - Auto reminder');
  console.log(
    '  POST /api/send-reminder-phase    - Manual reminder (phase 1-4)'
  );
  console.log(
    '  GET  /api/liff/deadline-settings - Get deadline settings (admin)'
  );
  console.log(
    '  PUT  /api/liff/deadline-settings - Update deadline settings (admin)'
  );
  console.log('===========================================');
});
