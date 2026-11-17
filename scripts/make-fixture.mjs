import { zipSync, strToU8 } from 'fflate'
import fs from 'node:fs'

const iso = (offsetMinutes = 0) =>
  new Date(Date.now() - offsetMinutes * 60000).toISOString().replace(/\.\d+Z$/, '.000Z')

const msg = (id, parent, role, content, status = 'FINISHED', offset = 0) => ({
  id,
  parent_id: parent,
  role,
  status,
  thinking_enabled: false,
  search_enabled: false,
  accumulated_token_usage: 0,
  inserted_at: iso(offset),
  fragments: [
    role === 'USER' ? { type: 'REQUEST', content } : { type: 'RESPONSE', content },
  ],
})

const longBody = Array.from(
  { length: 20 },
  (_, i) =>
    `　　${i + 1}. 景泰${i === 0 ? '元年' : `${i + 1}年`}相关条目：凡涉及边镇粮饷、京营调遣、漕运改道者，一律先录《明实录》原文，再附《明通鉴》互证；两书抵牾处单列「按」语说明取舍依据，不并入正文。`
).join('\n')

const sessionOne = {
  id: 'sess-jingtai-001',
  title: '明史项目·景泰朝词条梳理',
  pinned: false,
  current_message_id: 8,
  inserted_at: iso(3000),
  updated_at: iso(120),
  messages: [
    msg(1, null, 'USER', '我在做景泰朝的词条梳理，先把「土木之变」到「夺门之变」的时间线拉一下。', 'FINISHED', 3000),
    msg(2, 1, 'ASSISTANT', '好的。时间线如下：\n\n| 时间 | 事件 |\n|---|---|\n| 1449年7月 | 也先分四路南犯 |\n| 1449年8月 | 土木堡之变，英宗被俘 |\n| 1449年9月 | 郕王即位，改元景泰 |\n| 1450年8月 | 英宗还京，居南宫 |\n| 1457年1月 | 夺门之变，英宗复辟 |', 'FINISHED', 2900),
    msg(3, 2, 'USER', '第二个词条我想写「南宫复辟」的准备过程，重点是徐有贞、石亨、曹吉祥三人的分工。', 'FINISHED', 2500),
    msg(4, 3, 'ASSISTANT', '三人的分工可以这样切：\n\n1. **徐有贞**——主谋与舆论准备，借「星变」说服孙太后。\n2. **石亨**——掌握京营兵权，负责武力打开长安门。\n3. **曹吉祥**——内廷宦官，负责宫中接应与消息传递。\n\n词条里建议把「星变」这条谶纬线索单列，它解释了为什么选择正月十七动手。', 'FINISHED', 2400),
    msg(5, 4, 'USER', '这批词条最后要出一份对照表，风格统一用短句、不用形容词，史料一律标《明实录》卷次。', 'FINISHED', 1500),
    msg(6, 5, 'ASSISTANT', '记下了三条约定：\n\n- 句式：短句，不用形容词\n- 引证：《明实录》必须标卷次\n- 交付：最终汇总成对照表\n\n需要我现在就把已完成的词条按这个规范重排一遍吗？', 'FINISHED', 1400),
    msg(7, 6, 'USER', '先按这个规范把体例说明写出来，我要放进项目开头的凡例。', 'FINISHED', 1300),
    msg(8, 7, 'ASSISTANT', `体例说明（凡例）草稿：\n\n${longBody}\n\n以上二十条为总则，以下各卷不再重复。`, 'FINISHED', 1200),
  ],
}

const sessionTwo = {
  id: 'sess-python-002',
  title: 'Python 环境依赖冲突排查',
  pinned: false,
  current_message_id: 4,
  inserted_at: iso(6000),
  updated_at: iso(4000),
  messages: [
    msg(1, null, 'USER', '我的项目跑 numpy 时提示 _multiarray_umath 加载失败，Python 是 3.12。', 'FINISHED', 6000),
    msg(2, 1, 'ASSISTANT', '典型的多版本 numpy 残留。先确认解释器：\n\n```bash\npython -c "import sys; print(sys.executable)"\n```\n\n如果路径在用户目录下的 venv 里，再检查 `pip list | grep numpy`。', 'FINISHED', 5900),
    msg(3, 2, 'USER', '确认了是 venv 里的 2.1.0，和全局的 1.26 冲突。', 'FINISHED', 4100),
    msg(4, 3, 'ASSISTANT', '那就把 venv 里的清干净再重装，别用 `--user`：\n\n```bash\npip uninstall -y numpy\npip install numpy==2.1.0\n```\n\n装完用 `python -c "import numpy; print(numpy.__version__, numpy.__file__)"` 复核路径。', 'FINISHED', 4000),
  ],
}

const index = [sessionOne, sessionTwo].map((session) => ({
  id: session.id,
  title: session.title,
  pinned: false,
  message_count: session.messages.length,
  inserted_at: session.inserted_at,
  updated_at: session.updated_at,
}))

const files = {
  'manifest.json': strToU8(JSON.stringify({ export_format_version: 3 })),
  [`chat_sessions/${sessionOne.id}.json`]: strToU8(JSON.stringify(sessionOne)),
  [`chat_sessions/${sessionTwo.id}.json`]: strToU8(JSON.stringify(sessionTwo)),
  'chat_session_index.json': strToU8(JSON.stringify(index)),
}

fs.writeFileSync('fixture-chat-demo.zip', Buffer.from(zipSync(files)))
console.log('written', fs.statSync('fixture-chat-demo.zip').size, 'bytes')
