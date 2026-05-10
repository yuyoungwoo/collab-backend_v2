const express = require('express')
const authMiddleware = require('../middleware/auth')
const router = express.Router()

// 언어별 파일명 매핑 (Glot.io는 파일명을 요구함)
const FILE_NAME = {
    javascript: 'main.js', python: 'main.py', java: 'Main.java',
    c: 'main.c', cpp: 'main.cpp', typescript: 'main.ts',
    go: 'main.go', rust: 'main.rs',
}

// POST /api/execute
router.post('/', authMiddleware, async (req, res) => {
    const { code, language } = req.body

    if (!code || !language) {
        return res.status(400).json({ error: '코드와 언어를 입력하세요' })
    }

    try {
        const response = await fetch(`https://glot.io/api/run/${language}/latest`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Token ${process.env.GLOT_TOKEN}`,
            },
            body: JSON.stringify({
                files: [{ name: FILE_NAME[language] || 'main.js', content: code }]
            })
        })

        const result = await response.json()

        if (result.stdout) res.json({ output: result.stdout })
        else if (result.stderr) res.json({ output: '오류:\n' + result.stderr })
        else res.json({ output: '결과 없음' })

    } catch (e) {
        res.status(500).json({ error: '실행 실패' })
    }
})

module.exports = router