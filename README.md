# Pocket Library — 개인 Windows 포크

UsagiSung의 피처폰 게임 라이브러리입니다. 설치·빌드·수집·중복 검사와 원본 기여 표기는 [Pocket Library 안내](POCKET_LIBRARY.md)를 참고하세요. 이 브랜치는 개인 프로젝트이며 원본 저장소에 변경을 제출하지 않습니다.

---

# WIE

[Homepage](https://wie-site.dlunch.net) | [Try in browser](https://wie.dlunch.net)

A standalone emulator for old mobile apps based on WIPI, SKVM or J2ME.

This project is dedicated to digital preservation and educational research. Our goal is to revive the legacy of classic mobile games and allow them to be experienced in modern environments.

- [Contribution guide](https://github.com/dlunch/wie/blob/main/CONTRIBUTING.md)
- Architecture docs: [Emulator](docs/architecture.md) | [KTF](docs/ktf.md) | [LGT](docs/lgt.md)

## Frontend

The web and Android/iOS frontends are maintained in this repository under `wie-web` and `wie-app`.

```bash
npm install
npm run build:dev   # development web build
npm run build:prod  # production web build
npm start           # web development server
```

## Related projects

- [RustJava](https://github.com/dlunch/RustJava)
- [smaf](https://github.com/dlunch/smaf)
