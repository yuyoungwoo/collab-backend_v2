// ================================================================
// 파일명  : sessions.js
// 위치    : src/routes/sessions.js
// 역할    : 코드 리뷰 세션 및 댓글 REST API
//
// [쉬운 설명]
// 코드 리뷰 "방(세션)"을 만들고, 목록을 보고,
// 댓글을 달 수 있는 기능들을 처리해요.
// 댓글에 @이름을 쓰면 자동으로 그 사람에게 알림도 가요.
// ================================================================

const express = require('express')
const { pool } = require('../db')
const authMiddleware = require('../middleware/auth')  // JWT 검사 미들웨어

const router = express.Router()

// ────────────────────────────────────────────────────────────────
// API 1: 전체 세션 목록 조회
// URL: GET /api/sessions
// ────────────────────────────────────────────────────────────────
router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        s.*,                          -- sessions 테이블의 모든 컬럼
        u.name as author_name,        -- users 테이블에서 작성자 이름 가져옴 (별칭: author_name)
        -- 서브쿼리: 각 세션의 댓글 수 계산
        -- s.id를 기준으로 그 세션의 댓글 수를 COUNT
        (SELECT COUNT(*) FROM comments c WHERE c.session_id = s.id) as comment_count
      FROM sessions s
      -- LEFT JOIN: 작성자가 탈퇴해도 세션 데이터는 표시됨
      LEFT JOIN users u ON s.author_id = u.id
      ORDER BY s.created_at DESC  -- 최신 순 정렬
    `)

    // DB 컬럼명(snake_case)을 프론트에서 쓰기 좋은 형태(camelCase)로 변환
    // map() = 배열의 각 항목을 변환하는 메서드
    res.json(result.rows.map(row => ({
      id: row.id,
      title: row.title,
      language: row.language,
      isActive: row.is_active,       // is_active → isActive
      createdAt: row.created_at,     // created_at → createdAt
      participantCount: 0,           // 실시간 참여자 수 (소켓에서 관리)
      commentCount: row.comment_count,
      author: { name: row.author_name },
    })))

  } catch (e) {
    res.status(500).json({ error: '서버 오류' })
  }
})

// ────────────────────────────────────────────────────────────────
// API 2: 특정 세션 상세 조회
// URL: GET /api/sessions/:id
// :id = URL 경로의 세션 ID (req.params.id로 접근)
// ────────────────────────────────────────────────────────────────
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      // $1에 req.params.id 값이 들어감
      'SELECT s.*, u.name as author_name FROM sessions s LEFT JOIN users u ON s.author_id = u.id WHERE s.id = $1',
      [req.params.id]
    )

    // 결과가 없으면 (세션 ID가 없는 경우) 404 반환
    if (result.rows.length === 0) return res.status(404).json({ error: '세션을 찾을 수 없습니다' })

    const row = result.rows[0]
    res.json({
      id: row.id,
      title: row.title,
      language: row.language,
      code: row.code,          // 현재 저장된 코드 전체 (에디터 초기값으로 사용)
      isActive: row.is_active,
      createdAt: row.created_at,
      authorId: row.author_id, // 오너 확인용 (권한 관리에 사용)
      author: { name: row.author_name },
    })

  } catch (e) {
    res.status(500).json({ error: '서버 오류' })
  }
})

// ────────────────────────────────────────────────────────────────
// API 3: 세션 생성
// URL: POST /api/sessions
// 요청 body: { title, language }
// ────────────────────────────────────────────────────────────────
router.post('/', authMiddleware, async (req, res) => {
  const { title, language } = req.body

  if (!title) return res.status(400).json({ error: '제목을 입력하세요' })

  try {
    const result = await pool.query(
      // req.user.userId = authMiddleware가 저장한 현재 로그인 유저 ID
      // language || 'javascript' = language가 없으면 'javascript'를 기본값으로
      'INSERT INTO sessions (title, language, author_id) VALUES ($1, $2, $3) RETURNING *',
      [title, language || 'javascript', req.user.userId]
    )

    const row = result.rows[0]
    // 201 Created = 새 자원이 성공적으로 생성됨
    res.status(201).json({
      id: row.id, title: row.title, language: row.language,
      code: row.code, isActive: row.is_active, createdAt: row.created_at,
    })

  } catch (e) {
    res.status(500).json({ error: '서버 오류' })
  }
})

// ────────────────────────────────────────────────────────────────
// API 4: 코드 저장 (HTTP 방식)
// URL: PATCH /api/sessions/:id/code
// PATCH = 일부 수정 (전체 교체는 PUT, 일부 수정은 PATCH)
// ────────────────────────────────────────────────────────────────
router.patch('/:id/code', authMiddleware, async (req, res) => {
  const { code } = req.body
  try {
    // UPDATE = 기존 데이터 수정
    // SET code = $1 → code 컬럼을 새 값으로 업데이트
    // WHERE id = $2 → 이 세션 ID의 것만 수정
    await pool.query('UPDATE sessions SET code = $1 WHERE id = $2', [code, req.params.id])
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: '서버 오류' })
  }
})

// ────────────────────────────────────────────────────────────────
// API 5: 댓글 목록 조회
// URL: GET /api/sessions/:id/comments
// ────────────────────────────────────────────────────────────────
router.get('/:id/comments', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.*, u.name as author_name
      FROM comments c
      LEFT JOIN users u ON c.author_id = u.id
      WHERE c.session_id = $1   -- 이 세션의 댓글만 조회
      ORDER BY c.created_at DESC -- 최신 댓글이 위에
    `, [req.params.id])

    res.json(result.rows.map(row => ({
      id: row.id,
      lineNumber: row.line_number,  // 줄 번호 (없으면 null)
      content: row.content,
      createdAt: row.created_at,
      author: { name: row.author_name },
    })))

  } catch (e) {
    res.status(500).json({ error: '서버 오류' })
  }
})

// ────────────────────────────────────────────────────────────────
// API 6: 댓글 등록 + @멘션 감지 → 알림 자동 생성
// URL: POST /api/sessions/:id/comments
// 요청 body: { lineNumber, content }
// ────────────────────────────────────────────────────────────────
router.post('/:id/comments', authMiddleware, async (req, res) => {
  const { lineNumber, content } = req.body

  // content?.trim() = content가 없으면 undefined, 있으면 앞뒤 공백 제거
  if (!content?.trim()) return res.status(400).json({ error: '내용을 입력하세요' })

  try {
    // 댓글 DB에 저장
    // lineNumber || null = lineNumber가 없으면 null 저장
    const result = await pool.query(
      'INSERT INTO comments (session_id, author_id, line_number, content) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.params.id, req.user.userId, lineNumber || null, content]
    )
    const row = result.rows[0]

    // ── @멘션 감지 ──────────────────────────────────────────────
    // 정규식 /@(\S+)/g 로 댓글에서 @이름 패턴을 모두 찾음
    // @ = @ 문자
    // \S+ = 공백이 아닌 문자 1개 이상
    // g = global = 전체에서 모두 찾기 (없으면 첫 번째만 찾음)
    // match() = 정규식과 일치하는 모든 문자열을 배열로 반환
    // || [] = 매칭 결과가 없으면 빈 배열
    const mentions = content.match(/@(\S+)/g) || []

    // 각 멘션마다 반복
    for (const mention of mentions) {
      // mention.slice(1) = 첫 글자(@)를 제거해서 순수 이름/학번만 추출
      const keyword = mention.slice(1)

      // 이름 또는 학번으로 유저 검색
      // OR 조건: 이름과 학번 중 하나만 일치해도 찾음
      const mentionedUser = await pool.query(
        'SELECT id FROM users WHERE name = $1 OR student_id = $1',
        [keyword]
      )

      // 유저가 존재하고, 자기 자신이 아닌 경우에만 알림 생성
      if (mentionedUser.rows[0] && mentionedUser.rows[0].id !== req.user.userId) {
        await pool.query(
          'INSERT INTO notifications (user_id, type, message, link) VALUES ($1, $2, $3, $4)',
          [
            mentionedUser.rows[0].id,  // 알림 받을 유저
            'mention',                 // 알림 타입
            // 알림 메시지: "홍길동님이 댓글에서 회원님을 언급했습니다: "..."
            `${req.user.name}님이 댓글에서 회원님을 언급했습니다: "${content.slice(0, 50)}..."`,
            `/editor/${req.params.id}` // 클릭 시 이동할 URL
          ]
        )
      }
    }

    // 저장된 댓글 데이터 응답 (소켓으로 실시간 전파는 프론트에서 처리)
    res.status(201).json({
      id: row.id,
      lineNumber: row.line_number,
      content: row.content,
      createdAt: row.created_at,
      author: { name: req.user.name },
    })

  } catch (e) {
    res.status(500).json({ error: '서버 오류' })
  }
})

module.exports = router
// 세션 삭제 (오너만 가능)
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    // 오너인지 확인
    const session = await pool.query(
        'SELECT author_id FROM sessions WHERE id = $1',
        [req.params.id]
    )
    if (!session.rows[0]) return res.status(404).json({ error: '세션 없음' })
    if (session.rows[0].author_id !== req.user.userId) {
      return res.status(403).json({ error: '오너만 삭제할 수 있습니다' })
    }
    await pool.query('DELETE FROM sessions WHERE id = $1', [req.params.id])
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: '서버 오류' })
  }
})
