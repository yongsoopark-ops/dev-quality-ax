import type { ChatCommand } from "@/lib/chat/types";

/**
 * "W3 자동화"라는 문구가 (순서에 상관없이 앞뒤 공백/조사 없이) 포함되어 있으면 W3
 * 자동화 요청으로 인식한다. "실행"/"해줘"/"해 줘" 등 뒤에 붙는 말은 검사하지 않는다 —
 * 요청사항 3처럼 지원 명령을 하나로 좁게 유지하는 대신, 그 하나를 넓게 인식한다.
 */
const W3_COMMAND_PATTERN = /w3\s*자동화/i;

/** W3와 완전히 같은 방식으로, "3"이 아닌 "4"만 다르게 인식한다 — 서로 다른 숫자라
 * 두 패턴이 같은 문구에서 동시에 매치될 일이 없다(요청사항: 별도 분기). */
const W4_COMMAND_PATTERN = /w4\s*자동화/i;

/** docs.google.com/spreadsheets/d/{id}/... 형태만 Google Spreadsheet URL로 인정한다. */
const GOOGLE_SHEETS_URL_PATTERN = /https:\/\/docs\.google\.com\/spreadsheets\/d\/[a-zA-Z0-9_-]+[^\s]*/i;

/** Google Sheets URL이 아닌 다른 http(s) 링크가 섞여 있는지 확인하기 위한 넓은 패턴. */
const GENERIC_URL_PATTERN = /https?:\/\/\S+/i;

/**
 * Chat 메시지를 순수하게 문자열 패턴만으로 분류한다. AI API를 호출하지 않고,
 * 애매한 자연어를 임의로 해석하지도 않는다(요청사항 2/14) — W3/W4 자동화 문구가
 * 없으면 무조건 UNSUPPORTED다.
 */
export function parseChatCommand(message: string): ChatCommand {
  const trimmed = message.trim();

  const isW3 = W3_COMMAND_PATTERN.test(trimmed);
  const isW4 = W4_COMMAND_PATTERN.test(trimmed);
  if (!isW3 && !isW4) {
    return { type: "UNSUPPORTED" };
  }

  const sheetsMatch = trimmed.match(GOOGLE_SHEETS_URL_PATTERN);
  if (sheetsMatch) {
    return isW3
      ? { type: "W3_AUTOMATION", spreadsheetUrl: sheetsMatch[0] }
      : { type: "W4_AUTOMATION", spreadsheetUrl: sheetsMatch[0] };
  }

  if (GENERIC_URL_PATTERN.test(trimmed)) {
    return { type: "INVALID_URL" };
  }

  return { type: "MISSING_URL" };
}
