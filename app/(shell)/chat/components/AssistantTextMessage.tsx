/**
 * 일반 Assistant 텍스트 응답 — ChatGPT처럼 작은 말풍선/카드에 가두지 않고
 * Conversation Column 대부분 폭을 그대로 쓴다(요청사항 3). border/배경 카드를
 * 남발하지 않는다 — 구조화된 결과(ChatResultCard)와 시각적으로 구분되도록
 * 여기는 카드가 아니라 순수 텍스트다.
 *
 * 지금 이 Chat은 실제 생성형 AI가 아니라 결정적 Command Parser가 만든
 * 안내 문구만 message로 내려온다(예: "유효한 Google Spreadsheet URL을
 * 확인해주세요.") — 실제 Markdown 문법(#, **, 표 등)이 생성되는 경우는
 * 아직 없다. 그래도 향후 그런 응답이 오더라도 줄바꿈/여백이 자연스럽도록
 * whitespace-pre-wrap + 넉넉한 line-height만 기본으로 갖춰 둔다 — 새
 * Markdown 파서 라이브러리는 추가하지 않는다(성능 아키텍처 원칙, 실제
 * 필요가 생기면 그때 판단).
 */
export function AssistantTextMessage({ message }: { message: string }) {
  return (
    <div className="w-full">
      <p className="max-w-[75ch] whitespace-pre-wrap break-words text-sm leading-relaxed text-navy-950/80">
        {message}
      </p>
    </div>
  );
}
