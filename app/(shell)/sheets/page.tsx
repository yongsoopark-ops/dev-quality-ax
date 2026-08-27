import { MappingPreviewClient } from "./MappingPreviewClient";
import { WritePlanClient } from "./WritePlanClient";

export default function SheetsAutomationPage() {
  return (
    <div className="p-8">
      <h1 className="text-lg font-semibold text-navy-950">W2 → W3 자동입력</h1>
      <p className="mt-1 max-w-[1000px] text-sm text-navy-950/60">
        W2(품질검증설계 승인서)에 이미 입력된 값을 W3(품질 적합성 평가 보고서) 작성 시
        재사용하기 위한 Mapping Preview입니다. 이번 단계는 미리보기까지만 지원하며,
        실제로 W3 Sheet에 값을 입력하지는 않습니다. W2/W3는 프로젝트마다 별도
        Spreadsheet 사본을 사용하므로, 아래에 이번 프로젝트의 실제 Sheet 주소를
        입력해 주세요(별도로 저장되지 않으며, Google Sheet는 읽기만 합니다).
      </p>

      <MappingPreviewClient />

      <div className="mt-10 border-t border-navy-100 pt-8">
        <h2 className="text-lg font-semibold text-navy-950">W2 → W3 검사 Block 자동 생성 (Write)</h2>
        <p className="mt-1 max-w-[1000px] text-sm text-navy-950/60">
          W2 검사 계획을 기준으로 W3에 반복 검사 Block(Header+Data 행)을 자동으로 만들고
          계획 정보만 입력합니다. 이미 값이 있는 Cell은 건드리지 않고, 산출물 ID나
          담당자가 검사 후 입력하는 값(판정 일자·종합 판정·이슈 증상)은 자동 입력하지
          않습니다. &quot;Write 계획 확인&quot;은 읽기만 하는 안전한 미리보기이고,
          실제로 W3가 바뀌는 것은 아래 &quot;실행&quot; 버튼을 명시적으로 누른 뒤
          확인 절차를 거친 경우뿐입니다.
        </p>

        <WritePlanClient />
      </div>
    </div>
  );
}
