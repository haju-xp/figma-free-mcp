# figma-free-mcp — 포트폴리오

## 한 줄 요약

Figma 무료 플랜에서도 Claude AI와 연동 가능한 오픈소스 MCP 서버.
자동 연결, 100+ 도구, 디자인 토큰 동기화를 지원하며 npm + Smithery에 배포.

---

## 1. 프로젝트 개요

| 항목 | 내용 |
|---|---|
| **이름** | figma-free-mcp |
| **역할** | 1인 개발 (기획 / 개발 / 배포 / 운영) |
| **기간** | 2026.03.31 ~ 현재 (약 5주) |
| **기술 스택** | TypeScript, Node.js, WebSocket, MCP SDK |
| **배포** | npm, Smithery, Render.com |
| **npm 다운로드** | 361+ (월간) |
| **버전** | v1.0.0 → v1.0.13 (14회 릴리스) |
| **라이선스** | MIT |

### 링크

- npm: https://www.npmjs.com/package/figma-free-mcp
- Smithery: https://smithery.ai/servers/haju-xp/figma-free-mcp
- GitHub: https://github.com/haju-xp/figma-free-mcp

---

## 2. 왜 만들었나 (Problem → Solution)

### 기존 문제

| | Figma 공식 MCP | ClaudeTalkToFigma |
|---|---|---|
| 무료 플랜 | 유료만 가능 | 가능 |
| 자동 연결 | 가능 | 수동 (채널 ID 복붙) |
| 도구 수 | 다수 | 70+ |
| 원클릭 설치 | 불가 | 불가 |

### 내 솔루션

- **무료 플랜 지원** — Dev Mode 없이 동작
- **자동 연결** — 열린 Figma 파일 자동 감지 (채널 ID 복붙 불필요)
- **100+ 도구** — 기존 70+ 코어 + 19개 고급 도구(디자인 동기화, 페이지 관리, 코드→Figma)
- **3초 설치** — `npx figma-free-mcp@latest setup` 한 줄

---

## 3. 아키텍처

```
Claude Desktop / Claude Code
    │
    │ stdio (MCP Protocol)
    ▼
figma-free-mcp-server (100+ tools)     ← 핵심 MCP 서버
    │
    │ WebSocket (port 3055)
    ▼
figma-free-mcp-socket                  ← 중계 서버
    │
    │ WebSocket
    ▼
Figma Plugin (auto-connect)            ← Figma 내부 플러그인
    │
    │ Figma Plugin API
    ▼
Figma File
```

### 3개의 런타임 모드

| 모드 | 진입점 | 용도 |
|---|---|---|
| **stdio** | `server.ts` | Claude Desktop 연동 (기본) |
| **WebSocket** | `socket.ts` | 로컬 중계 서버 (포트 3055) |
| **HTTP** | `http-server.ts` | 클라우드 배포 (Render.com) |

---

## 4. 핵심 기능 상세

### 4-1. Auto-Connect (자동 연결)

기존 ClaudeTalkToFigma는 사용자가 Figma 플러그인에서 채널 ID를 복사해서 Claude에 붙여넣어야 했음.

**내가 구현한 방식:**
- WebSocket 서버가 활성 채널 목록을 관리 (`Map<channelId, Set<WebSocket>>`)
- MCP 서버 시작 시 `/list-channels` 호출해서 열린 세션 자동 감지
- 파일이 하나면 즉시 연결, 여러 개면 Claude가 사용자에게 선택 요청

### 4-2. Design System Sync (디자인 토큰 동기화)

| 도구 | 기능 |
|---|---|
| `sync_css_to_figma` | CSS 변수 → Figma 변수 컬렉션 |
| `sync_figma_to_css` | Figma 변수 → CSS custom properties |
| `compare_design_tokens` | CSS ↔ Figma 차이점 리포트 |
| `apply_design_system` | 디자인 정책 문서를 Figma에 적용 |
| `audit_design_consistency` | Figma 파일 내 정책 위반 탐지 |

**CSS 파서 직접 구현** (`css-parser.ts`):
- CSS 변수 파싱 → 카테고리 자동 분류 (Colors, Spacing, Typography 등)
- hex, rgb(), rgba() 색상 포맷 변환
- Figma 변수 구조체로 매핑

### 4-3. Page Manager (페이지 관리)

| 도구 | 기능 |
|---|---|
| `list_all_pages_detailed` | 전체 페이지 + 프레임 수 + 중복 감지 |
| `deduplicate_pages` | 중복 페이지 자동 병합/제거 |
| `organize_pages` | 번호순 또는 알파벳순 정렬 |
| `cleanup_empty_pages` | 빈 페이지 자동 삭제 |

### 4-4. Code → Figma

| 도구 | 기능 |
|---|---|
| `react_to_figma` | React/TSX 컴포넌트 → Figma 프레임 변환 |
| `css_class_to_figma_style` | CSS 클래스 → Figma 로컬 스타일 |
| `generate_component_variants` | hover/active/disabled 변형 자동 생성 |

---

## 5. 개발 타임라인

```
2026.03.31  v1.0.0  최초 릴리스
            ├── ClaudeTalkToFigma fork + 구조 재설계
            ├── 3개 런타임(stdio, socket, http) 분리
            └── npm 배포

2026.04.01  v1.0.1 ~ v1.0.6
            ├── Windows 호환성 수정 (shebang)
            ├── CLI setup 자동화 (플러그인 다운로드)
            ├── Render.com 배포 (HTTP/SSE transport)
            ├── Smithery 레지스트리 등록
            └── README 전면 재작성

2026.04.15  v1.0.7
            ├── socket 서버 로그 stderr로 리다이렉트
            └── Claude Desktop 자동 시작 시도 (→ 버그 발견)

2026.05.04  v1.0.8 ~ v1.0.13
            ├── socket MCP 등록 버그 수정
            ├── 서버 시작 시 config 자동 수정 (기존 사용자 대응)
            ├── 의존성 버전 고정 (latest → ^x.y.z)
            ├── 에러 핸들링 강화
            ├── 구버전 npm deprecate 경고
            └── README 업그레이드 가이드 추가
```

---

## 6. 문제 해결 사례

### Case 1: Socket 서버 MCP 등록 버그

**증상:** Claude Desktop에서 "MCP figma-free-mcp-socket: Server disconnected" 에러 반복

**원인 분석:**
- `setup` 명령이 WebSocket 중계 서버를 MCP 서버로 config에 등록
- WebSocket 서버는 stdio 프로토콜이 아니라 MCP 핸드셰이크 실패

**해결:**
1. `cli.js`에서 socket MCP 등록 코드 제거 (신규 사용자)
2. `server.ts`에 `removeStaleSocketEntry()` 추가 — MCP 서버 시작 시 config 자동 수정 (기존 사용자)
3. `npm deprecate`로 구버전 경고 메시지 (v1.0.0~v1.0.7)

**배운 점:** MCP stdio 서버와 WebSocket 서버는 프로토콜이 다르므로 같은 방식으로 등록하면 안 됨. 자동 수정 메커니즘으로 기존 사용자 영향 최소화.

### Case 2: Windows 호환성

**증상:** Windows에서 `npx figma-free-mcp-socket` 실행 시 "not recognized" 에러

**원인:** dist 파일에 shebang(`#!/usr/bin/env node`) 누락

**해결:** tsup 빌드 설정에 shebang 삽입 + 중복 shebang 제거

### Case 3: 의존성 안정성

**증상:** `@modelcontextprotocol/sdk: "latest"` 사용으로 breaking change 위험

**해결:** 현재 설치된 버전 확인 후 `^x.y.z` 형태로 고정

---

## 7. 프로젝트 구조

```
figma-free-mcp/
├── src/
│   ├── server.ts              # MCP stdio 서버 (진입점)
│   ├── socket.ts              # WebSocket 중계 서버
│   ├── http-server.ts         # HTTP 서버 (클라우드 배포)
│   ├── config/config.ts       # 설정 (포트, URL, 재연결)
│   ├── tools/
│   │   ├── index.ts           # 전체 도구 등록 오케스트레이션
│   │   ├── core/              # 70+ 코어 도구 (10개 모듈)
│   │   ├── design-sync/       # CSS↔Figma 토큰 동기화 (5개)
│   │   ├── page-manager/      # 페이지 관리 자동화 (4개)
│   │   └── code-to-figma/     # 코드→Figma 변환 (3개)
│   ├── utils/
│   │   ├── websocket.ts       # WebSocket 연결/메시지 관리
│   │   ├── css-parser.ts      # CSS 변수 파서
│   │   ├── figma-helpers.ts   # 노드 필터링/직렬화
│   │   ├── logger.ts          # stderr 로거
│   │   └── defaults.ts        # Figma 기본값
│   ├── types/                 # TypeScript 타입 정의
│   └── prompts/               # MCP 프롬프트 (디자인 가이드)
├── plugin/                    # Figma 플러그인 (manifest + code + UI)
├── scripts/cli.js             # setup/uninstall CLI
├── smithery.yaml              # Smithery 레지스트리 설정
├── render.yaml                # Render.com 배포 설정
├── tsup.config.ts             # 빌드 설정 (3 entry points)
└── package.json               # npm 패키지 메타데이터
```

---

## 8. 기술적 의사결정

### 왜 fork했나?

ClaudeTalkToFigma는 좋은 기반이지만:
- 채널 ID 수동 복붙 필수 → UX 마찰
- 디자인 시스템 동기화 기능 없음
- 페이지 관리 도구 없음
- 원클릭 설치 불가

**fork 후 추가한 것:**
- Auto-connect 메커니즘 (채널 자동 감지)
- 19개 고급 도구 (디자인 동기화 5 + 페이지 관리 4 + 코드→Figma 3 + 기타)
- CSS 파서 (`css-parser.ts`) 직접 구현
- CLI 설치 자동화 (`scripts/cli.js`)
- 3개 런타임 모드 (stdio / WebSocket / HTTP)
- Smithery + Render.com 배포

### 왜 3개 런타임인가?

| 모드 | 이유 |
|---|---|
| stdio | Claude Desktop이 MCP 서버를 stdio로 실행 (표준) |
| WebSocket | Figma 플러그인과 실시간 양방향 통신 필요 |
| HTTP | 클라우드 배포 시 stdio 불가 → HTTP/SSE 대안 |

### 왜 CSS 파서를 직접 만들었나?

- PostCSS 같은 라이브러리는 패키지 크기 증가
- 필요한 건 CSS 변수(`--color-primary: #fff`)만 파싱하는 것
- 경량화를 위해 정규식 기반 파서 직접 구현 (~200줄)

---

## 9. 배포 파이프라인

```
코드 수정
    │
    ├── npm run build (tsup → 3개 번들)
    │
    ├── npm publish (npm 레지스트리)
    │   ├── figma-free-mcp-server (MCP)
    │   ├── figma-free-mcp-socket (relay)
    │   └── figma-free-mcp (CLI)
    │
    ├── Smithery (npm 패키지 자동 감지)
    │
    └── Render.com (git push → 자동 빌드/배포)
```

### 버전 관리 전략

- SemVer 준수 (1.0.x patch 릴리스)
- `npm deprecate`로 구버전 경고
- 서버 시작 시 기존 사용자 config 자동 수정 (self-healing)

---

## 10. 성과 및 지표

| 지표 | 수치 |
|---|---|
| npm 월간 다운로드 | 361+ |
| 총 릴리스 | 14회 (v1.0.0 ~ v1.0.13) |
| 등록된 도구 | 100+ |
| 지원 플랫폼 | Windows, macOS, Linux |
| 배포 채널 | npm, Smithery, Render.com |
| 개발 기간 | 5주 (1인 개발) |

---

## 11. 향후 계획

- Figma REST API 연동 (파일 히스토리, 버전 관리)
- 테스트 커버리지 추가 (현재 미구현)
- GitHub Actions CI/CD 파이프라인
- 다국어 프롬프트 지원

---

*© 2026 haju. Built with TypeScript + MCP SDK.*
