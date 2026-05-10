const express = require('express')
const { pool } = require('../db')
const authMiddleware = require('../middleware/auth')

const router = express.Router()

// 특정 세션의 내 권한 조회
// GET /api/permissions/:sessionId
router.get('/:sessionId', authMiddleware, async (req, res) => {
  const { sessionId } = req.params
  try {
    // 세션 관리자인지 확인
    const session = await pool.query('SELECT author_id FROM sessions WHERE id = $1', [sessionId])
    if (!session.rows[0]) return res.status(404).json({ error: '세션 없음' })

    const isAdmin = session.rows[0].author_id === req.user.userId
    if (isAdmin) return res.json({ canEdit: true, isOwner: true })

    // 권한 테이블 조회
    const perm = await pool.query(
      'SELECT can_edit FROM session_permissions WHERE session_id = $1 AND user_id = $2',
      [sessionId, req.user.userId]
    )
    res.json({ canEdit: perm.rows[0]?.can_edit || false, isOwner: false })
  } catch (e) {
    res.status(500).json({ error: '서버 오류' })
  }
})

// 세션 참여자 목록 + 권한 조회 (오너 전용)
// GET /api/permissions/:sessionId/members
router.get('/:sessionId/members', authMiddleware, async (req, res) => {
  const { sessionId } = req.params
  try {
    const session = await pool.query('SELECT author_id FROM sessions WHERE id = $1', [sessionId])
    if (session.rows[0]?.author_id !== req.user.userId) {
      return res.status(403).json({ error: '게시자만 권한을 관리할 수 있습니다' })
    }
    const result = await pool.query(`
      SELECT u.id, u.name, u.student_id,
        COALESCE(sp.can_edit, FALSE) as can_edit
      FROM users u
      LEFT JOIN session_permissions sp
        ON sp.user_id = u.id AND sp.session_id = $1
      WHERE u.id != $2
    `, [sessionId, req.user.userId])
    res.json(result.rows)
  } catch (e) {
    res.status(500).json({ error: '서버 오류' })
  }
})

// 특정 유저 권한 변경 (오너 전용)
// PATCH /api/permissions/:sessionId
// body: { targetUserId, canEdit }
router.patch('/:sessionId', authMiddleware, async (req, res) => {
  const { sessionId } = req.params
  const { targetUserId, canEdit } = req.body

  try {
    const session = await pool.query('SELECT author_id FROM sessions WHERE id = $1', [sessionId])
    if (session.rows[0]?.author_id !== req.user.userId) {
      return res.status(403).json({ error: '게시자만 권한을 변경할 수 있습니다' })
    }

    // UPSERT — 있으면 업데이트, 없으면 삽입
    await pool.query(`
      INSERT INTO session_permissions (session_id, user_id, can_edit)
      VALUES ($1, $2, $3)
      ON CONFLICT (session_id, user_id)
      DO UPDATE SET can_edit = $3
    `, [sessionId, targetUserId, canEdit])

    // 권한 변경 알림 생성
    const msg = canEdit ? '코드 편집 권한이 부여되었습니다' : '코드 편집 권한이 제거되었습니다'
    await pool.query(
      'INSERT INTO notifications (user_id, type, message, link) VALUES ($1, $2, $3, $4)',
      [targetUserId, 'permission', msg, `/editor/${sessionId}`]
    )

    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: '서버 오류' })
  }
})

module.exports = router
