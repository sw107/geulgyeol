# 다음 기능 선택: 대소문자 미구분 찾기/바꾸기의 원문 범위 보존

이 턴은 재현과 다음 최소범위 선택까지다. 검색/치환 프로덕션 코드를 아직 수정하지 않았다. 완료한 스타일·수식·그룹 항목을 다시 기능목표로 세지 않는다.

기존 FUNCTION_GAPS_DRAFT.md의 일반편집/찾기·바꾸기 항목과 현재 실제소스를 대조했다. 공식 한컴 [찾기](https://help.hancom.com/hoffice/multi/ko_kr/hwp/edit/find/find.htm), [찾아 바꾸기](https://help.hancom.com/hoffice/multi/ko_kr/hwp/edit/replace_with.htm), [찾기 선택 사항](https://help.hancom.com/hoffice/multi/ko_kr/hwp/edit/find/find%28options%29.htm)은 찾기/바꾸기/모두바꾸기, 대소문자구별, 찾은범위선택, 되돌리기 기능을 설명한다. 글결에도 이UI와API는있으므로 새메뉴추가보다 **이미 찾은범위 밖 문자를 삭제하는 데이터보존 결함**을 우선한다. 공식문서는 아래 Turkish dotted-I의 구체적인Unicode 대응정책을 명시하지 않으며 실제한컴으로 해당매칭을 검증했다고 주장하지 않는다. 결함판정은 글결이 스스로찾은매치의 원문범위와 실제삭제범위 불일치에 근거한다.

실제 현재 WASM c258e847…의 새빈문서에서, 대소문자구별=false로 `İA😀TAIL`에서 `i + U+0307 + a`를 검색하면 charOffset0/length3을 반환한다. 매치가 소비하는 원문은 `İA`(Unicode scalar2개)이지만 query의scalar3개를 삭제해 이웃emoji까지 사라진다. Q로치환할때 기대 `Q😀TAIL`, 실제 `QTAIL`이다. 더작은 `İAB`에서는 기대 `QB`, 실제 `Q`. 반대방향으로 `i + U+0307 + AB`에서 `İA`를찾으면 원문3개를소비해야하지만length2로보고하여 기대 `QB`, 실제 `QAB`로 매치일부가남는다.

실제 replaceOne/replaceAll/검색hit를replaceText에전달하는UI와같은API경로에서 이세사례가 모두재현됐다(9개결함). ASCII `IAB`→`ia`→`QB` 제어사례는 세API 모두통과했다. 총12문서,24HWP/HWPX저장·재열기에서 관측한문자열이그대로저장됐고, export content-loss는0이었다. 이것은 exporter의지원모델손실보고가 잘못된편집까지검증하지않는다는뜻이며 exporter새결함으로세지않는다. snapshot undo의원문텍스트복원12회도확인했다. 실제MacGUI/선택강조및한컴Unicode매칭동등성은미검증이다.

원인소스:
- engine/src/document_core/queries/search_query.rs:85~130의find_in_text는 lowercase확장문자별원문index를저장한뒤**시작offset만**반환한다. search_first_body:135~143, push_container_hits:169~175는length를query.chars().count()로만든다. replaceOne/All/본문replaceText는이length를삭제수로쓴다.
- queries/grep.rs:249~269도원문length를query길이로보고한다. 공유matcher의consumer와주소범위가서로어긋나지않게함께확인해야한다.
- rhwp-studio/src/ui/find-dialog.ts:34,361~366은검색hit.length를선택끝/바꾸기삭제길이로사용한다. correctedlength를받을준비가이미돼있고WASM결과schema를새로넓힐필요가없다.

최소개선범위는 **기존매칭규칙은유지하면서 원문[start,end) scalar범위를함께계산**하는것이다. folded매치창의처음/마지막문자를원문index로되돌려length=end-start를구하고, SearchHit와grep주소가그범위를보고하게한다. 검색결과/first-match/전체·nth치환을같은span으로연결한다. 공개offset/length JSON필드와UI경로는유지한다. 새Locale/정규화/정규식/검색컨테이너확장이나전체찾기설계를이결함에섞지않는다. 예상프로덕션변경은search_query.rs와grep.rs 두파일중심이며UI는실제결과소비확인후필요할때만수정한다.

다음완료기준: 위확장양방향과ASCII/한글/emoji 제어에서 정확한원문span·일치수·이웃텍스트가보존될것. 본문/일반셀/이미지원하는경로기반전체치환의주소·glyph/서식경계·다른스타일/참조불변을검사할것. undo/redo, HWP/HWPX저장재열기와재열기후재편집이같은원문범위를소비할것. 현재범위가지원하지않는컨테이너의검색route를이변경에서자동으로넓히지않을것. 실제GUI는도구가복구될때따로확인할것.

재현: `node scripts/repro-search-casefold-span.mjs ENGINE_DIR OUTPUT_DIR`. 스크립트는 발견된결함을수정하지않고기록하는진단도구다. 최신결과는proof.json,합성내보내기24개는저장소밖enter-pagination-profile-qa/next-search-span에있다. 원본문서·기본앱을사용하거나수정하지않는다.
