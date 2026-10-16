# 웹 폰트 목록

웹 배포에 사용하는 WOFF2 폰트의 저장소 내 기준 목록이다. Git에는 8개 계열의 WOFF2 25개,
총 15,932,260 bytes가 포함된다. Studio와 legacy `/web`은 각각의 `fonts/` runtime URL을 유지하면서
이 디렉토리를 참조하고, extension build는 여기에서 배포 산출물로 복사한다.

이 수치는 현재 포함 파일의 목록이며, 모든 파일의 upstream 원본 출처나 배포 적합성을
입증하는 것은 아니다. 내부 메타데이터·라이선스 및 패키지 대조 범위는
[검토 기록](../../verification/final-package-font-audit.md)을 따른다.
후속 원본 대조와 남은 배포 조건은 [출처 조사](../../verification/font-source-provenance.md),
파일별 해시·공식 URL과 저작권 보충 고지는
[`FONT_SOURCE_NOTICE.md`](../../desktop/web/licenses/FONT_SOURCE_NOTICE.md)에 기록한다.

저작권 보호가 필요한 폰트는 Git에 포함하지 않으며, 별도로 준비해야 한다.

## 저작권 폰트 (Git 미포함)

로컬에 직접 배치해야 한다. 웹 배포 시 대응되는 폰트 폴백으로 대체 가능하다.

### 한컴 폰트

| 파일명 | 폰트명 | 폴백 대체 |
|--------|--------|----------|
| hamchob-r.woff2 | 함초롬바탕 | Pretendard 또는 시스템 세리프 |
| hamchod-r.woff2 | 함초롬돋움 | Pretendard 또는 시스템 산세리프 |
| h2hdrm.woff2 | HY헤드라인M | Pretendard-Bold |
| hygprm.woff2 | HY고딕 | Pretendard |
| hygtre.woff2 | HY그래픽 | Pretendard |
| hymjre.woff2 | HY명조 | Pretendard 또는 시스템 세리프 |

### Microsoft 폰트

| 파일명 | 폰트명 | 폴백 대체 |
|--------|--------|----------|
| ArialW05-Regular.woff2 | Arial | 시스템 산세리프 |
| Calibri.woff2 | Calibri | Pretendard |
| CourierNewW05-Regular.woff2 | Courier New | 시스템 모노스페이스 |
| TahomaW05-Regular.woff2 | Tahoma | Pretendard |
| TimesNewRomanW05-Regular.woff2 | Times New Roman | 시스템 세리프 |
| VerdanaW05-Regular.woff2 | Verdana | Pretendard |
| MalgunGothicW35-Regular.woff2 | 맑은 고딕 | Pretendard |
| WebdingsW95-Regular.woff2 | Webdings | — |
| WingdingsW95-3.woff2 | Wingdings 3 | — |

## 오픈 라이선스 폰트 (Git 포함)

### Serif (명조체 계열)

| 파일명 | 폰트명 | 라이선스 | 출처 | 대체 대상 |
|--------|--------|---------|------|----------|
| NotoSerifKR-Regular.woff2 | Noto Serif KR Regular | SIL OFL 1.1 | Google Fonts | 바탕, 한컴바탕, 함초롬바탕 |
| NotoSerifKR-Bold.woff2 | Noto Serif KR Bold | SIL OFL 1.1 | Google Fonts | 바탕 Bold |
| NanumMyeongjo-Regular.woff2 | 나눔명조 Regular | SIL OFL 1.1 | Google Fonts | HY명조, 휴먼명조 |
| NanumMyeongjo-Bold.woff2 | 나눔명조 Bold | SIL OFL 1.1 | Google Fonts | HY명조 Bold |
| NanumMyeongjo-ExtraBold.woff2 | 나눔명조 ExtraBold | SIL OFL 1.1 | Google Fonts | HY명조 ExtraBold |
| GowunBatang-Regular.woff2 | 고운바탕 Regular | SIL OFL 1.1 | Google Fonts | 궁서 대체 |
| GowunBatang-Bold.woff2 | 고운바탕 Bold | SIL OFL 1.1 | Google Fonts | 궁서 Bold |

### Sans-serif (고딕체 계열)

| 파일명 | 폰트명 | 라이선스 | 출처 | 대체 대상 |
|--------|--------|---------|------|----------|
| Pretendard-*.woff2 (9종) | Pretendard | SIL OFL 1.1 | GitHub | 맑은 고딕, 함초롬돋움 |
| NotoSansKR-Regular.woff2 | Noto Sans KR Regular | SIL OFL 1.1 | Google Fonts | 한컴돋움(=함초롬돋움 별칭), CanvasKit 기본 typeface |
| NotoSansKR-Bold.woff2 | Noto Sans KR Bold | SIL OFL 1.1 | Google Fonts | 돋움 Bold |
| NotoSansKR-ExtraLight.woff2 | Noto Sans KR ExtraLight | SIL OFL 1.1 | Google Fonts 공식 variable TTF의 wght=200 glyph 대조 일치; 원래 변환 절차는 미확인 | Haansoft Dotum·돋움·굴림 |
| NanumGothic-Regular.woff2 | 나눔고딕 Regular | SIL OFL 1.1 | Google Fonts | 나눔고딕 (동일) |
| NanumGothic-Bold.woff2 | 나눔고딕 Bold | SIL OFL 1.1 | Google Fonts | 나눔고딕 Bold |
| NanumGothic-ExtraBold.woff2 | 나눔고딕 ExtraBold | SIL OFL 1.1 | Google Fonts | 나눔고딕 ExtraBold |
| GowunDodum-Regular.woff2 | 고운돋움 Regular | SIL OFL 1.1 | Google Fonts | HY고딕 대체 |

### Noto Sans KR Regular 서브셋 재생성

CanvasKit은 브라우저 시스템 폰트 폴백을 사용하지 않으므로 `NotoSansKR-Regular.woff2`에 필요한
글머리/도형 glyph가 실제로 포함돼야 한다. Regular asset은 기존 한글/라틴 cmap에 다음 범위를 추가한다.

- `U+2500-257F`: 표 테두리용 Box Drawing
- `U+25A0-25FF`: KS X 1001 글머리와 Geometric Shapes

현재 Regular 파일의 cmap에서 `■`, `▪`, `□`, `○`, `─`가 실제 glyph로 연결되는 것은
확인했다. 그러나 이 저장소에는 이전 안내의 `ttfs/opensource/NotoSansKR-Regular.ttf`와
`tools/subset_noto_sans_kr_regular.py`가 없다. 기존에 적힌 입력 해시나 생성 설명만으로
현재 파일을 재현했다고 주장할 수 없다. 생성 입력·변환 과정·이름 보존 조건을 검토하기 전에는
폰트를 재생성하거나 교체하지 않는다. 실제 CanvasKit 및 인쇄 모양 검증도 별도다.

### Monospace (고정폭)

| 파일명 | 폰트명 | 라이선스 | 출처 | 대체 대상 |
|--------|--------|---------|------|----------|
| NanumGothicCoding-Regular.woff2 | 나눔고딕코딩 Regular | SIL OFL 1.1 | Google Fonts | 보조 Monospace |
| NanumGothicCoding-Bold.woff2 | 나눔고딕코딩 Bold | SIL OFL 1.1 | Google Fonts | 보조 Monospace Bold |

### 현재 번들에 없는 선택 글꼴

이전 목록의 SpoqaHanSans, D2Coding, Cafe24, Happiness Sans,
SourceHanSerifK-OldHangul-subset, LatinModernMath 파일은 현재 Git WOFF2 목록에 없다.
라이선스 고지 파일이나 폴백 코드가 남아 있다는 사실만으로 해당 폰트가 포함됐다고 보지 않는다.
별도 글꼴을 추가할 때는 원본 출처·정확한 파일·라이선스·변환 내역을 다시 검토해야 한다.

### 내부 메타데이터 주의점

2026-10-16에 포함 WOFF2 25개를 모두 해석했다. 파일명 ExtraLight인 Noto Sans KR의
`OS/2.usWeightClass`는 400이며, Bold 파일의 내부 family 이름에는 `Thin`이 남아 있다.
Regular의 unique ID에도 `Thin`이 남아 있다. Noto Serif KR Regular·Bold 내부 family에는
`ExtraLight`가 남아 있다. 후속 대조에서 Noto 다섯 파일의 모든 Unicode 매핑 glyph가 각각
공식 TTF의 200/400/700 인스턴스와 outline·metrics·힌팅 명령까지 일치했다. 따라서
ExtraLight의 실제 매핑 glyph는 200 인스턴스와 일치하지만 내부 weight 표기는 400이다.
이 비교는 실제 앱의 두께 선택이나 인쇄 결과 검증을 대신하지 않는다.

Noto Sans KR ExtraLight·Regular의 `.notdef` outline은 비어 있으며 공식 참조에는 5개 contour가
있다. Unicode 매핑 glyph의 일치를 전체 글꼴 동작의 동일성으로 해석하지 않는다.
이번 조사에서 폰트 바이너리는 변경하지 않았다.

### 공식 파일과 배포 조건의 확인 범위

고운바탕 Regular·Bold와 고운돋움은 공식 Google Fonts 제공 파일과 바이트가 일치한다.
기존 Pretendard 9개를 합쳐 25개 중 12개의 공식 바이너리 일치를 확인했다.
나머지 13개는 공식 TTF/weight 인스턴스와 Unicode 매핑 glyph를 대조했지만 원래의
변환 절차와 전체 GSUB/GPOS 동작 동일성은 확인하지 못했다.

나눔 8개는 전체 공식 TTF보다 문자가 적은 subset이며 Nanum 이름을 유지한다.
현재 수정본의 RFN 허용 근거를 확보하지 못했으므로 배포 조건 검토를 완료했다고 보지 않는다.
이름·전체 glyph·metrics·layout table을 유지한 전체 TTF 압축 대안은 QA 사본으로만 준비했다.
제품에 적용하거나 실제 Mac·한글·IME·인쇄 검증을 완료한 것은 아니며 베타 배포는 계속 보류한다.
