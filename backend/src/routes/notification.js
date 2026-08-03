import express from 'express';
import {
  getGroupIdByTenant,
  sendGroupMessage,
  sendIndividualMessage,
  formatMessage,
  getLiffUrl,
  getNotificationConfig,
} from '../services/lineService.js';
import { getDeadlineString } from '../services/reminderService.js';
import { getPartTimeDeadlineSettings } from '../services/submissionService.js';
import pool from '../config/database.js';

const router = express.Router();

/**
 * 重複通知排除用キャッシュ
 * 同一 tenant_id + year + month + type の通知を一定時間内は1回のみ送信
 */
const recentNotifications = new Map();
const DUPLICATE_WINDOW_MS = 60 * 1000; // 1分間

/**
 * 重複チェック（重複の場合true）
 * @param {string} key - 重複チェック用キー
 * @returns {boolean} 重複している場合true
 */
function isDuplicateNotification(key) {
  const lastSent = recentNotifications.get(key);
  const now = Date.now();

  if (lastSent && now - lastSent < DUPLICATE_WINDOW_MS) {
    console.log(`🔄 Duplicate notification skipped: ${key}`);
    return true;
  }

  recentNotifications.set(key, now);
  return false;
}

/**
 * 古いキャッシュエントリを定期的にクリーンアップ
 */
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of recentNotifications.entries()) {
    if (now - timestamp > DUPLICATE_WINDOW_MS * 2) {
      recentNotifications.delete(key);
    }
  }
}, DUPLICATE_WINDOW_MS * 2);

/**
 * シフト確定通知のメッセージ本文を組み立てる
 * @param {string} name - スタッフ名
 * @param {number} year - 年
 * @param {number} month - 月
 * @param {Array<{shift_date: string|Date, start_time: string, end_time: string}>} shifts - シフトの配列
 * @returns {string} 通知メッセージ
 */
function buildShiftMessage(name, year, month, shifts) {
  const header = `${name}さんの${year}年${month}月のシフトが確定しました。\n`;
  const lines = shifts.map(({ shift_date, start_time, end_time }) => {
    const dateStr =
      typeof shift_date === 'string'
        ? shift_date.slice(0, 10)
        : shift_date.toISOString().slice(0, 10);
    const [, mm, dd] = dateStr.split('-');
    return `${parseInt(mm)}/${parseInt(dd)} ${start_time.slice(0, 5)}〜${end_time.slice(0, 5)}`;
  });
  return header + lines.join('\n');
}

/**
 * 第1案承認通知
 * POST /api/notification/first-plan-approved
 *
 * shift-scheduler-ai から呼び出される
 * グループに「シフト希望入力開始」を通知
 */
router.post('/first-plan-approved', async (req, res) => {
  try {
    const { tenant_id, store_id, plan_id, year, month } = req.body;

    console.log('📢 First plan approved notification request:', {
      tenant_id,
      store_id,
      plan_id,
      year,
      month,
    });

    // バリデーション
    if (!tenant_id || !year || !month) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: tenant_id, year, month',
      });
    }

    // 重複チェック
    const dedupeKey = `first_${tenant_id}_${year}_${month}`;
    if (isDuplicateNotification(dedupeKey)) {
      return res.json({
        success: true,
        message: 'Duplicate notification skipped',
        notified: false,
        skipped: true,
      });
    }

    // グループID取得
    const groupId = getGroupIdByTenant(tenant_id);
    if (!groupId) {
      console.warn(`⚠️ No group configured for tenant ${tenant_id}`);
      return res.json({
        success: true,
        message: 'No group configured for this tenant. Notification skipped.',
        notified: false,
      });
    }

    // DBからアルバイトの締切設定を取得
    const deadlineSettings = await getPartTimeDeadlineSettings(tenant_id);
    console.log('📋 Deadline settings from DB:', deadlineSettings);

    // メッセージ作成（DBの締切日・締切時刻を使用）
    const config = getNotificationConfig();
    const template = config.approvalMessages.firstPlanApproved;
    const message = formatMessage(template, {
      targetMonth: month,
      deadline: getDeadlineString(
        year,
        month,
        deadlineSettings.deadline_day,
        deadlineSettings.deadline_time
      ),
      liffUrl: getLiffUrl(),
    });

    // グループに送信
    const sent = await sendGroupMessage(groupId, message);

    res.json({
      success: true,
      message: sent
        ? 'Notification sent to group'
        : 'Notification skipped (disabled)',
      notified: sent,
    });
  } catch (error) {
    console.error('❌ Error in first-plan-approved:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * 第2案承認通知（フェーズ5）
 * POST /api/notification/second-plan-approved
 *
 * shift-scheduler-ai から呼び出される
 * グループに「シフト確定」を通知
 */
router.post('/second-plan-approved', async (req, res) => {
  try {
    const { tenant_id, store_id, plan_id, year, month } = req.body;

    console.log('📢 Second plan approved notification request:', {
      tenant_id,
      store_id,
      plan_id,
      year,
      month,
    });

    // バリデーション
    if (!tenant_id || !year || !month) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: tenant_id, year, month',
      });
    }

    // 重複チェック
    const dedupeKey = `second_${tenant_id}_${year}_${month}`;
    if (isDuplicateNotification(dedupeKey)) {
      return res.json({
        success: true,
        message: 'Duplicate notification skipped',
        notified: false,
        skipped: true,
      });
    }

    // グループID取得
    const groupId = getGroupIdByTenant(tenant_id);
    if (!groupId) {
      console.warn(`⚠️ No group configured for tenant ${tenant_id}`);
      return res.json({
        success: true,
        message: 'No group configured for this tenant. Notification skipped.',
        notified: false,
      });
    }

    // メッセージ作成
    const config = getNotificationConfig();
    const template = config.approvalMessages.secondPlanApproved;
    const message = formatMessage(template, {
      targetMonth: month,
      liffUrl: getLiffUrl(),
    });

    // グループに送信
    const sent = await sendGroupMessage(groupId, message);

    res.json({
      success: true,
      message: sent
        ? 'Notification sent to group'
        : 'Notification skipped (disabled)',
      notified: sent,
    });
  } catch (error) {
    console.error('❌ Error in second-plan-approved:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * テスト用：手動で通知を送信
 * POST /api/notification/test
 *
 * ローカル開発・テスト用エンドポイント
 */
router.post('/test', async (req, res) => {
  try {
    const { tenant_id, message } = req.body;

    if (!tenant_id || !message) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: tenant_id, message',
      });
    }

    const groupId = getGroupIdByTenant(tenant_id);
    if (!groupId) {
      return res.status(400).json({
        success: false,
        error: `No group configured for tenant ${tenant_id}`,
      });
    }

    const sent = await sendGroupMessage(groupId, message);

    res.json({
      success: true,
      message: sent ? 'Test message sent' : 'Test message skipped (disabled)',
      groupId: groupId,
    });
  } catch (error) {
    console.error('❌ Error in test notification:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * シフト確定通知（全スタッフへの個別LINE通知）
 * POST /api/notification/shift-confirmed
 *
 * shift-scheduler-ai から呼び出される
 * 対象テナント・店舗の LINE 連携済みスタッフ全員に、個人シフト情報を個別送信する
 */
router.post('/shift-confirmed', async (req, res) => {
  try {
    const { tenant_id, store_id, plan_id, year, month } = req.body;

    console.log('📢 Shift confirmed notification request:', {
      tenant_id,
      store_id,
      plan_id,
      year,
      month,
    });

    if (!tenant_id || !store_id || !plan_id || !year || !month) {
      return res.status(400).json({
        success: false,
        error:
          'Missing required parameters: tenant_id, store_id, plan_id, year, month',
      });
    }

    const dedupeKey = `shift_confirmed_${tenant_id}_${store_id}_${year}_${month}`;
    if (isDuplicateNotification(dedupeKey)) {
      return res.json({
        success: true,
        message: 'Duplicate notification skipped',
        notified: false,
        skipped: true,
      });
    }

    const query = `
      SELECT
        s.staff_id,
        s.name,
        sla.line_user_id,
        sh.shift_date,
        sh.start_time,
        sh.end_time
      FROM hr.staff s
      JOIN hr.staff_line_accounts sla
        ON s.staff_id = sla.staff_id
        AND s.tenant_id = sla.tenant_id
        AND sla.is_active = true
      JOIN ops.shifts sh
        ON sh.staff_id = s.staff_id
        AND sh.tenant_id = s.tenant_id
        AND sh.plan_id = $3
      WHERE s.tenant_id = $1
        AND s.store_id = $2
        AND s.is_active = true
      ORDER BY s.staff_id, sh.shift_date
    `;

    const result = await pool.query(query, [tenant_id, store_id, plan_id]);

    const staffShifts = new Map();
    for (const row of result.rows) {
      if (!staffShifts.has(row.staff_id)) {
        staffShifts.set(row.staff_id, {
          name: row.name,
          line_user_id: row.line_user_id,
          shifts: [],
        });
      }
      staffShifts.get(row.staff_id).shifts.push({
        shift_date: row.shift_date,
        start_time: row.start_time,
        end_time: row.end_time,
      });
    }

    let sent = 0;
    let errors = 0;
    for (const [staffId, { name, line_user_id, shifts }] of staffShifts) {
      const message = buildShiftMessage(name, year, month, shifts);
      const ok = await sendIndividualMessage(line_user_id, message);
      if (ok) {
        sent++;
      } else {
        errors++;
        console.error(`Failed to send to staff ${staffId}`);
      }
    }

    const total = staffShifts.size;
    console.log(
      `shift-confirmed: sent=${sent}, errors=${errors}, total=${total}`
    );
    res.json({
      success: true,
      message: `Notifications sent: ${sent}/${total}`,
      sent,
      errors,
      total,
    });
  } catch (error) {
    console.error('❌ Error in shift-confirmed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
