/**
 * 상세 검사영역 Header Signature Row(순 | 판정 일자 | 검사 항목 | 검사 중요도 |
 * 판정 기준 | 종합 판정 | 이슈 증상)를 copyPaste로 새로 만들 때, Data Row에 있던
 * 정상 dropdown(Data Validation)이 Header Row에도 함께 복제되는 문제가 있다 —
 * copyPaste(PASTE_NORMAL)는 값·서식과 함께 Data Validation까지 그대로 복사하기
 * 때문이다. Header Row 전체를 다시 쓰거나 서식을 재생성하지 않고, 해당 Row의
 * Data Validation 속성만 제거하는 후처리 요청을 만든다 — 값/서식/병합/테두리 등은
 * 전혀 건드리지 않는다. W2→W3, W3→W4 두 엔진이 이 helper를 공통으로 사용한다.
 *
 * setDataValidation 요청에서 rule을 생략하면 해당 Range의 Data Validation을
 * 제거한다(Google Sheets API 규칙) — 값을 다시 쓰거나 서식을 다시 입히지 않는다.
 */
export function buildClearRowDataValidationRequest(
  sheetId: number,
  rowIndex: number,
  startColumnIndex = 0,
  endColumnIndex = 17,
): Record<string, unknown> {
  return {
    setDataValidation: {
      range: { sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex, endColumnIndex },
    },
  };
}
