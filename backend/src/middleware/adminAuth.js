import { timingSafeEqual } from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

/**
 * タイミング攻撃を避けた文字列比較
 * @param {string} a
 * @param {string} b
 * @returns {boolean} 一致する場合true
 */
function safeCompare(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  if (bufA.length !== bufB.length) {
    return false;
  }

  return timingSafeEqual(bufA, bufB);
}

/**
 * 管理者向け Basic 認証ミドルウェア
 * 環境変数 ADMIN_BASIC_USER / ADMIN_BASIC_PASS で認証情報を設定する。
 * 未設定の場合は管理者APIを無効化（503）してフェイルセーフにする。
 */
export function adminAuth(req, res, next) {
  const expectedUser = process.env.ADMIN_BASIC_USER;
  const expectedPass = process.env.ADMIN_BASIC_PASS;

  if (!expectedUser || !expectedPass) {
    return res.status(503).json({
      success: false,
      error:
        'Admin API is disabled. Set ADMIN_BASIC_USER and ADMIN_BASIC_PASS to enable it.',
    });
  }

  const header = req.headers.authorization || '';

  if (!header.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Admin API"');
    return res.status(401).json({
      success: false,
      error: 'Authentication required (Basic Auth)',
    });
  }

  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const separatorIndex = decoded.indexOf(':');
  const user = separatorIndex >= 0 ? decoded.slice(0, separatorIndex) : '';
  const pass = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : '';

  if (!safeCompare(user, expectedUser) || !safeCompare(pass, expectedPass)) {
    res.set('WWW-Authenticate', 'Basic realm="Admin API"');
    return res.status(401).json({
      success: false,
      error: 'Invalid credentials',
    });
  }

  next();
}
