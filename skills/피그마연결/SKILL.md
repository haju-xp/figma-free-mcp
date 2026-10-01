---
name: 피그마연결
description: Figma 데스크탑 앱에 열려 있는 파일에 figma-free-mcp 플러그인 채널로 연결한다. 중계 서버 확인·채널 접속·대상 파일과 페이지 확인까지 한 번에 처리하고, 설치·연결 문제를 점검한다. 공식 Figma MCP(mcp.figma.com)가 함께 설치돼 있어도 이 명령은 반드시 figma-free-mcp 를 쓴다. "피그마 연결", "피그마 붙여줘", "플러그인 연결", "figma connect", "다시 연결", "피그마 연결 확인", "피그마 설치", "피그마 업데이트", "피그마 점검" 요청에 사용.
---

# 피그마 연결

`figma-free-mcp` 플러그인 채널에 붙는다. **공식 Figma MCP(`mcp.figma.com`)는 쓰지 않는다.**

| | `figma-free-mcp` (이 명령) | 공식 Figma MCP |
| --- | --- | --- |
| 대상 | 데스크탑 앱에 **지금 열려 있는 파일** | 클라우드의 Figma 파일 |
| 그리기 | 좌표·색·크기를 1px 단위로 직접 지정 | 자동 생성 — 세밀한 좌표 제어 불가 |

사용자는 명령어를 몰라도 된다. 아래 명령은 **네가** 실행한다. 승인 창이 뜨면 "허용을 눌러주세요"라고 한 번 알린다.

## 요청별 처리

### "연결 확인"만 물었을 때

```bash
curl -s localhost:3055/channels
```

한 번만 실행하고 채널·접속 수만 답한다. 플러그인 호출이나 문서 조회는 하지 않는다 —
플러그인이 응답하지 않으면 그 호출들은 타임아웃까지 기다린다.
접속 수 2 = 플러그인과 Claude가 둘 다 붙은 상태, 1 = 플러그인만.

### "연결해줘" / `/피그마연결`

1. `mcp__figma-free-mcp__auto_connect` 를 부른다. 중계 서버가 꺼져 있으면 **도구가 스스로 띄운다.**
2. 결과별로:

| 결과 | 할 일 |
| --- | --- |
| `Auto-connected to channel: …` | 3번으로 |
| `Relay server was just started …` | 서버를 방금 띄웠다. 사용자에게 "피그마에서 플러그인을 다시 실행해주세요"라고 요청 → 답을 받으면 `auto_connect` 재호출 |
| `No active Figma channels found` | "피그마 데스크탑 앱에서 작업할 파일을 열고 Plugins → Development → **Figma Free MCP** 를 실행해주세요" → 답을 받으면 재호출 |
| 채널 2개 이상 | 플러그인을 다시 열어서 생긴 이전 채널이 남은 것. `list_active_channels` 로 파일명을 보고, 애매하면 **사용자에게 묻는다.** 파일명을 알면 `connect_to_file` |
| `WebSocket server not running (…)` | 자동 기동 실패. 아래 "점검"으로 |
| 피그마 도구 자체가 없음 | 설치가 안 됐거나 Claude Code 재시작 전. 아래 "설치"로 |

**사용자 대신 Figma 화면을 조작하지 않는다.**

3. 붙은 뒤 `mcp__figma-free-mcp__get_document_info` 로 대상을 확인해 보고한다.

```
연결됨 — 채널 xxxx
파일: <파일명>
현재 페이지: <페이지명> (요소 N개)
```

현재 페이지에 이미 요소가 있으면 그대로 그리지 말고 물어본다.

### "설치해줘" / "업데이트해줘"

```bash
node -v
npx -y figma-free-mcp@latest install
```

- `node -v` 가 실패하면 멈추고 안내한다: <https://nodejs.org> 에서 LTS 설치(비밀번호는 사용자가 직접) → 터미널 재시작.
  Homebrew가 있으면 `brew install node` 는 네가 해도 된다.
- `install` 이 하는 일: 모든 폴더에서 쓰이게 도구 등록, 피그마 플러그인 파일 복사, 이 스킬 설치,
  예전 방식 잔재(폴더 전용 등록·전역 구버전) 정리, 플러그인 폴더 열기. **다시 실행하면 업데이트.**
- 끝나면 사용자에게 안내한다:
  1. (이 PC에서 처음일 때만) 피그마 데스크탑 앱 → Plugins → Development → **Import plugin from manifest…** →
     방금 열린 폴더의 `manifest.json` 선택
  2. **Claude Code를 껐다 켠다** — 도구는 시작할 때만 붙는다
  3. 그다음부터는 피그마에서 플러그인 실행 → `/피그마연결`

### "점검해줘" — 뭔가 안 될 때

```bash
npx -y figma-free-mcp@latest doctor
```

Node·도구 등록 범위·플러그인 파일 버전·예전 전역 설치·중계 서버·채널을 한 번에 보여준다.
`!` 줄이 문제다. 대부분 `install` 재실행으로 고쳐진다. 결과를 쉬운 말로 풀어서 알려준다.

자동 기동이 계속 실패하면 중계 서버를 수동으로 띄운다 (창은 켜둔 채로):

```bash
npx -y figma-free-mcp@latest socket
```

## 자주 겪는 것

| 증상 | 원인·해결 |
| --- | --- |
| `Must join a channel before sending commands` | 작업 중 채널이 끊겼다. `auto_connect` 재호출 |
| `Port 3055 is already in use` | 정상. 이미 떠 있다는 안내 |
| 도구는 보이는데 반응 없음 | 피그마 플러그인 창이 닫혔다. 다시 실행 후 재연결 |
| 중계 서버가 재시작됨 (재부팅 등) | 채널이 사라진다. 플러그인을 다시 실행 → 재연결 |
| 어떤 폴더에선 피그마 도구가 없음 | 예전에 폴더 전용으로 등록됨. `install` 재실행 |

## 그리기 전에 알아둘 것

- `batch` 의 `opsFile` 을 쓴다. 수백 개 명령을 도구 인자로 직접 쓰지 말고, 스크립트로 JSON 파일을 만들어 경로만 넘긴다.
  `"$N"` = 같은 목록 N번째 명령이 만든 노드 id (예: `parentId: "$0"`). 색은 hex 그대로 된다.
  `idsFile` 을 주면 id 목록을 파일로 받고 응답은 한 줄이다.
- `create_text` 에 `fontFamily`·`fontStyle` 을 바로 준다. 폰트를 나중에 다시 지정하지 않는다.
- 특정 작업용 스킬(예: 화면 실측 도면)이 따로 있으면 그 지침을 따른다.
