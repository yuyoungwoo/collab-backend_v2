const express = require('express')
const { pool } = require('../db')
const authMiddleware = require('../middleware/auth')

const router = express.Router()

// 내 알림 목록
// GET /api/notifications
router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.user.userId]
    )
    res.json(result.rows)
  } catch (e) {
    res.status(500).json({ error: '서버 오류' })
  }
})

// 읽지 않은 알림 개수
// GET /api/notifications/unread-count
router.get('/unread-count', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = FALSE',
      [req.user.userId]
    )
    res.json({ count: parseInt(result.rows[0].count) })
  } catch (e) {
    res.status(500).json({ error: '서버 오류' })
  }
})

// 알림 읽음 처리 (단건)
// PATCH /api/notifications/:id/read
router.patch('/:id/read', authMiddleware, async (req, res) => {
  try {
    await pool.query(
      'UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.userId]
    )
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: '서버 오류' })
  }
})

// 모든 알림 읽음 처리
// PATCH /api/notifications/read-all
router.patch('/read-all', authMiddleware, async (req, res) => {
  try {
    await pool.query(
      'UPDATE notifications SET is_read = TRUE WHERE user_id = $1',
      [req.user.userId]
    )
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: '서버 오류' })
  }
})

// 알림 삭제
// DELETE /api/notifications/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM notifications WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.userId]
    )
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: '서버 오류' })
  }
})

module.exports = router
