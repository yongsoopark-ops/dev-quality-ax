import { runW3AutomationPreflight } from "@/lib/sheetAutomation/write/w3Preflight";
import { runW4AutomationPreflight } from "@/lib/sheetAutomation/w3ToW4/w4Preflight";
import type { ChatCommand, ChatCommandResult } from "@/lib/chat/types";

/**
 * 인식된 Command를 실제 처리로 연결한다. 향후 DRIVE_SEARCH/KPI_QUERY 등을 추가할 때
 * 이 switch에 case만 늘리면 되도록 parseCommand와 분리해 두었다.
 */
export async function routeChatCommand(command: ChatCommand): Promise<ChatCommandResult> {
  switch (command.type) {
    case "W3_AUTOMATION": {
      const preflight = await runW3AutomationPreflight(command.spreadsheetUrl);
      return { kind: "W3_PREFLIGHT", preflight };
    }
    case "W4_AUTOMATION": {
      const preflight = await runW4AutomationPreflight(command.spreadsheetUrl);
      return { kind: "W4_PREFLIGHT", preflight };
    }
    case "MISSING_URL":
      return { kind: "TEXT", message: "Google Spreadsheet URL을 함께 입력해주세요." };
    case "INVALID_URL":
      return { kind: "TEXT", message: "유효한 Google Spreadsheet URL을 확인해주세요." };
    case "UNSUPPORTED":
      return { kind: "TEXT", message: "현재 지원하는 작업은 W3 자동화 실행, W4 자동화 실행입니다." };
  }
}
