# Pocket Library

UsagiSung의 개인 피처폰 게임 라이브러리 프로젝트입니다. WIE의 WIPI/J2ME 에뮬레이션 엔진을 기반으로 Windows용 게임 서재를 제공합니다.

## 원본과의 관계

- 원본: [dlunch/wie](https://github.com/dlunch/wie), MIT License
- 개인 포크: [UsagiSung/wie](https://github.com/UsagiSung/wie), `personal/phone-library` 브랜치
- 이 브랜치의 변경은 개인 포크 전용입니다. 원본 저장소에 PR을 제출하지 않습니다.
- 검증했던 픽셀 버퍼 최적화와 Enter 키 지원을 기반으로 개발했습니다. 원본 최신 main의 모든 변경을 포함하는 것은 아닙니다.
- 에뮬레이션 엔진과 기존 오디오·저장 구현은 WIE의 작업이며, 개인 작업은 픽셀 처리 최적화, 데스크톱 라이브러리, 자료 수집·분류·중복 검사 도구입니다.

## 기능

- 시작 시 로컬 피처폰 게임 목록 자동 표시
- 게임 검색, KTF/SKT/LGT/J2ME 필터, 즐겨찾기, 최근 플레이, 페이지 이동
- Enter/Space 확인, Backspace CLR, 방향키, 화면 키패드
- 기존 WIE의 MIDI/SMAF 음악과 효과음, 게임 저장 기능
- 별도 브라우저나 Python 서버 없이 실행하는 Tauri/WebView2 Windows 앱
- APK는 수집 및 중복 검사만 수행하며 실행 목록에서는 제외
- 최근 플레이 카드의 빨간 ×에서 확인 후 게임 저장 데이터와 최근 기록 초기화
- 게임 실행 실패 시 라이브러리로 복귀하고 오류 내용 표시

## 개발 및 빌드

Windows에서 Rust MSVC toolchain, Visual Studio C++ Build Tools, Node.js, WebView2가 필요합니다.

```powershell
rustup target add wasm32-unknown-unknown
npm ci
npm run desktop:build -- --no-bundle
```

실행파일은 `target/release/wie-app.exe`입니다. 실행파일 옆에 `library/catalog.json`과 `library/files/`를 두면 수집한 게임이 자동 표시됩니다. 라이브러리가 없어도 앱에서 ZIP/JAR를 추가할 수 있습니다.

게임 추가, 즐겨찾기, 최근 플레이 및 게임 내 저장은 앱의 WebView2 사용자 데이터에 보관됩니다. 게임 종료 전 게임 자체의 저장 기능을 사용하세요. 앱 데이터를 삭제하면 저장 정보가 사라질 수 있습니다.

게임이 저장 API를 호출할 때 기록을 보관합니다. 게임 자체의 자동 저장 또는 수동 저장을 따르며, 종료 순간의 실행 상태를 통째로 저장하는 기능은 없습니다. 최근 플레이 카드 우측 하단의 빨간 ×를 누르면 게임명과 ‘진짜 삭제할까요?’ 확인창이 표시됩니다. 취소 또는 Esc는 데이터를 유지하며, 빨간 ‘삭제’를 누른 경우에만 저장 기록·파일 데이터와 최근 플레이 기록을 삭제합니다. 게임 원본 및 즐겨찾기는 유지합니다. 기존 WIE 저장공간을 공유하는 다른 버전에는 초기화가 함께 적용될 수 있습니다.

## 수집 및 라이브러리 생성

```powershell
python -m pip install -r tools/requirements.txt
python tools/collect_naver.py --output C:/path/to/collection
python tools/prepare_library.py --source C:/path/to/collection --output C:/path/to/app/library --report C:/path/to/reports
```

ALZ/EGG/RAR/7Z가 있으면 설치된 Bandizip 콘솔 도구를 `--archiver "C:/Program Files/Bandizip/bz.exe"`로 지정할 수 있습니다. ZIP 이름으로 저장된 RAR도 파일 헤더로 구분합니다. 목록의 압축 경로와 크기를 검사한 뒤 사본만 해제합니다.

`collection.json`에는 출처 글, 다운로드 주소, 파일명, 크기, SHA-256 및 실패 내역이 남습니다. 재실행하면 완료한 글과 파일은 건너뜁니다. `duplicates.json`에는 원본 바이트가 같은 중복과 압축 내 파일 내용이 같은 중복을 각각 기록합니다. KTF의 AID와 이를 참조하는 메타데이터·파일명만 다른 사본도 비교용 식별자를 정규화해 한 항목으로 표시합니다. 비교 시에만 정규화하며 실행 데이터는 변경하지 않습니다. 원본은 삭제하지 않으며 내용이나 해상도가 다른 통신사·게임 버전은 보존합니다.

## 검증

```powershell
python -m unittest discover -s tools -p "test_*.py"
cargo fmt --all --check
cargo clippy --workspace -- -D warnings
cargo test -p wie-app -p wie-backend -p wie-midp
npx tsc --project wie-web/tsconfig.json --noEmit
node --experimental-strip-types --test wie-web/tests/game_data.test.mjs
```

카탈로그 등록은 파일 구조를 인식했다는 뜻이며 모든 게임의 완전 호환을 보증하지 않습니다. KTF 화장빨인생과 피자타이쿤2를 기반으로 디버그했습니다. 게임별 미구현 API와 데이터 차이에 따른 추가 호환성 작업이 필요할 수 있습니다.

## 포트폴리오 배포

게임 파일과 수집 자료는 소스 저장소에 포함하지 않습니다. 배포판에도 게임을 묶지 않고 사용자가 가진 파일을 가져오는 방식으로 제공합니다. 원본 MIT LICENSE와 WIE 기여자 표기를 유지합니다.
