# scripts/

## 테스터 비서 API 확인

화면 클릭 없이 `assistant-turn` 맥락만 검사합니다. 비밀번호는 인자나 루트 `.env`로만 넣고 git에 커밋하지 않습니다.

```bash
TESTER_EMAIL=tester@subly.app TESTER_PASSWORD='…' node scripts/verify-assistant-turn.mjs
```

접속·화면 체크리스트는 [docs/ACCESS.md](../docs/ACCESS.md)를 보세요.

앱/웹 실행은 루트와 `web/`의 `package.json` 스크립트를 씁니다.

## 브랜드 자산 다시 만들기

원본 투명 심볼 PNG를 전달하면 앱 아이콘, Android 적응형 아이콘, 스플래시,
파비콘과 가로형 로고를 같은 색상·여백 규칙으로 다시 만듭니다.

```bash
CLANG_MODULE_CACHE_PATH=/tmp/subly-clang-cache \
SWIFT_MODULECACHE_PATH=/tmp/subly-swift-cache \
swift scripts/generate-brand-assets.swift <source-symbol.png> assets/images
```
