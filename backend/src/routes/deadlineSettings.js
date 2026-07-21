import express from 'express';
import { adminAuth } from '../middleware/adminAuth.js';
import {
  getDeadlineSettings,
  upsertDeadlineSettings,
} from '../services/submissionService.js';

const router = express.Router();

const DEADLINE_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * 締め切り設定の取得（管理者向け）
 * GET /api/liff/deadline-settings?tenant_id=3&employment_type=PART_TIME
 */
router.get('/deadline-settings', adminAuth, async (req, res) => {
  try {
    const tenantId = parseInt(req.query.tenant_id, 10);
    const employmentType = req.query.employment_type || 'PART_TIME';

    if (!Number.isInteger(tenantId) || tenantId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'tenant_id is required and must be a positive integer',
      });
    }

    const settings = await getDeadlineSettings(tenantId, employmentType);

    if (!settings) {
      return res.status(404).json({
        success: false,
        error: `No deadline settings found for tenant ${tenantId} / ${employmentType}`,
      });
    }

    res.json({ success: true, settings });
  } catch (error) {
    console.error('❌ Error fetching deadline settings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 締め切り設定の変更（管理者向け）
 * PUT /api/liff/deadline-settings
 *
 * リクエストボディ:
 * {
 *   "tenant_id": 3,
 *   "employment_type": "PART_TIME",
 *   "deadline_day": 10,
 *   "deadline_time": "23:59",
 *   "is_enabled": true  // 任意
 * }
 *
 * core.shift_deadline_settings を UPSERT する。
 * 変更内容は次回 cron 発火時に自動で反映される（毎回DBから再取得）。
 */
router.put('/deadline-settings', adminAuth, async (req, res) => {
  try {
    const { tenant_id, employment_type, deadline_day, deadline_time } =
      req.body;
    const isEnabled = req.body.is_enabled;

    const tenantId = parseInt(tenant_id, 10);
    const deadlineDay = parseInt(deadline_day, 10);

    if (!Number.isInteger(tenantId) || tenantId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'tenant_id is required and must be a positive integer',
      });
    }

    if (!employment_type || typeof employment_type !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'employment_type is required (e.g., "PART_TIME", "FULL_TIME")',
      });
    }

    if (!Number.isInteger(deadlineDay) || deadlineDay < 1 || deadlineDay > 31) {
      return res.status(400).json({
        success: false,
        error: 'deadline_day is required and must be between 1 and 31',
      });
    }

    if (!deadline_time || !DEADLINE_TIME_PATTERN.test(deadline_time)) {
      return res.status(400).json({
        success: false,
        error: 'deadline_time is required and must be in "HH:MM" format',
      });
    }

    if (isEnabled !== undefined && typeof isEnabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'is_enabled must be a boolean when provided',
      });
    }

    const settings = await upsertDeadlineSettings({
      tenantId,
      employmentType: employment_type,
      deadlineDay,
      deadlineTime: deadline_time,
      isEnabled,
    });

    console.log('📝 Deadline settings updated:', settings);

    res.json({
      success: true,
      message: 'Deadline settings updated. Applied on next cron run.',
      settings,
    });
  } catch (error) {
    console.error('❌ Error updating deadline settings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
