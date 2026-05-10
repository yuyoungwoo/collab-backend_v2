const express = require('express')
const { pool } = require('../db')
const authMiddleware = require('../middleware/auth')

const router = express.Router()

// 스니펫 목록 (검색, 언어 필터)
router.get('/', authMiddleware, async (req, res) => {
  const { search, language } = req.query
  try {
    let query = `
      SELECT s.*, u.name as author_name
      FROM snippets s
      LEFT JOIN users u ON s.author_id = u.id
      WHERE 1=1
    `
    const params = []

    if (language) {
      params.push(language)
      query += ` AND s.language = $${params.length}`
    }
    if (search) {
      params.push(`%${search}%`)
      query += ` AND (s.title ILIKE $${params.length} OR s.code ILIKE $${params.length} OR $${params.length} ILIKE ANY(s.tags::text[]))`
    }

    query += ' ORDER BY s.created_at DESC'

    const result = await pool.query(query, params)
    res.json(result.rows.map(row => ({
      id: row.id, title: row.title, code: row.code,
      language: row.language, tags: row.tags || [],
      createdAt: row.created_at,
      author_id: row.author_id,
      author: { name: row.author_name },
    })))
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: '서버 오류' })
  }
})

// 스니펫 저장
router.post('/', authMiddleware, async (req, res) => {
  const { title, code, language, tags } = req.body
  if (!title || !code) return res.status(400).json({ error: '제목과 코드를 입력하세요' })

  try {
    const result = await pool.query(
      'INSERT INTO snippets (title, code, language, tags, author_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [title, code, language || 'javascript', tags || [], req.user.userId]
    )
    const row = result.rows[0]
    res.status(201).json({
      id: row.id, title: row.title, code: row.code,
      language: row.language, tags: row.tags,
      createdAt: row.created_at,
      author: { name: req.user.name },
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: '서버 오류' })
  }
})

// 스니펫 삭제
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM snippets WHERE id = $1 AND author_id = $2', [req.params.id, req.user.userId])
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: '서버 오류' })
  }
})

module.exports = router
