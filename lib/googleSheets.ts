import { JWT } from "google-auth-library";

// W2→W3 반복 검사 블록 자동 생성(Write) 기능을 위해 쓰기 가능 Scope로 확장했다(사용자 승인).
// Drive API 권한은 추가하지 않는다 — 이 Scope는 이미 공유된 개별 Spreadsheet에 대한
// 읽기/쓰기만 허용하고, 새 파일 생성/복제/목록 조회 등 Drive 차원의 권한은 포함하지 않는다.
// 실제로 값을 쓸 수 있는지는 각 Spreadsheet를 이 서비스 계정에 Editor로 공유했는지에
// 별도로 달려 있다 — 이 Scope 변경만으로 어떤 문서에도 자동으로 쓰기 권한이 생기지 않는다.
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
const API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

let cachedClient: JWT | null = null;

function getServiceAccountClient() {
  if (cachedClient) return cachedClient;

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

  if (!email || !rawKey) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY 환경변수가 설정되지 않았습니다.",
    );
  }

  cachedClient = new JWT({
    email,
    key: rawKey.replace(/\\n/g, "\n"),
    scopes: SCOPES,
  });

  return cachedClient;
}

async function callSheetsApi<T>(
  path: string,
  init?: { method?: "GET" | "POST"; body?: unknown },
): Promise<T> {
  const client = getServiceAccountClient();
  // getRequestHeaders()는 (스프레드로는 값이 전부 사라지는) 네이티브 Headers 인스턴스를
  // 반환한다 — 반드시 Headers 생성자로 복사한 뒤 set()으로 추가해야 Authorization이 보존된다.
  const headers = new Headers(await client.getRequestHeaders());
  if (init?.method === "POST") {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${API_BASE}/${path}`, {
    method: init?.method ?? "GET",
    headers,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Google Sheets API 오류 (${res.status}): ${body.slice(0, 300) || res.statusText}`,
    );
  }

  return res.json() as Promise<T>;
}

/** Google Sheets URL에서 spreadsheetId를 추출한다. */
export function extractSpreadsheetId(url: string): string | null {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

export interface SpreadsheetMetadata {
  title: string;
  sheetNames: string[];
}

/** 스프레드시트 존재 여부, 접근 권한, 시트 목록을 확인한다. */
export async function getSpreadsheetMetadata(
  spreadsheetId: string,
): Promise<SpreadsheetMetadata> {
  const data = await callSheetsApi<{
    properties?: { title?: string };
    sheets?: { properties?: { title?: string } }[];
  }>(`${spreadsheetId}?fields=properties.title,sheets.properties.title`);

  return {
    title: data.properties?.title ?? "",
    sheetNames: (data.sheets ?? [])
      .map((sheet) => sheet.properties?.title)
      .filter((title): title is string => Boolean(title)),
  };
}

export interface SheetValues {
  headers: string[];
  rows: string[][];
}

/** 지정한 시트의 Header 행과 데이터 행을 읽어온다. */
export async function getSheetValues(
  spreadsheetId: string,
  sheetName: string,
  headerRow: number,
): Promise<SheetValues> {
  const range = encodeURIComponent(`'${sheetName}'`);
  const data = await callSheetsApi<{ values?: string[][] }>(
    `${spreadsheetId}/values/${range}`,
  );

  const values = data.values ?? [];
  const headerIndex = Math.max(0, headerRow - 1);
  const headers = values[headerIndex] ?? [];
  const rows = values.slice(headerIndex + 1);

  return { headers, rows };
}

/** 시트 Tab 이름으로 batchUpdate 등에 필요한 숫자 sheetId(gid)를 찾는다. */
export async function getSheetIdByName(
  spreadsheetId: string,
  sheetName: string,
): Promise<number> {
  const data = await callSheetsApi<{ sheets?: { properties?: { title?: string; sheetId?: number } }[] }>(
    `${spreadsheetId}?fields=sheets.properties.sheetId,sheets.properties.title`,
  );
  const sheet = (data.sheets ?? []).find((s) => s.properties?.title === sheetName);
  if (!sheet || sheet.properties?.sheetId === undefined) {
    throw new Error(`Tab "${sheetName}"을(를) 찾을 수 없습니다.`);
  }
  return sheet.properties.sheetId;
}

/** headerRow 개념 없이, 시트에 실제로 입력된 값 전체를 Grid(2차원 배열) 그대로 읽는다. */
export async function getRawGridValues(
  spreadsheetId: string,
  sheetName: string,
): Promise<string[][]> {
  const range = encodeURIComponent(`'${sheetName}'`);
  const data = await callSheetsApi<{ values?: string[][] }>(`${spreadsheetId}/values/${range}`);
  return data.values ?? [];
}

/**
 * spreadsheets.batchUpdate — 행 삽입/Cell 복사(copyPaste)/Merge 등 "구조" 변경 전용.
 * 값(Value) 입력에는 사용하지 않는다(batchUpdateValues 참고) — Structure와 Value 입력을
 * 한 함수에서 뒤섞지 않기 위함이다.
 */
export async function batchUpdateSpreadsheet(
  spreadsheetId: string,
  requests: Record<string, unknown>[],
): Promise<unknown> {
  if (requests.length === 0) return null;
  return callSheetsApi(`${spreadsheetId}:batchUpdate`, {
    method: "POST",
    body: { requests },
  });
}

/**
 * 시트 전체 행의 실제 픽셀 높이를 한 번에 읽어온다. copyPaste는 Cell 서식/병합/값은
 * 복제하지만 행 높이(Dimension 속성)는 복제하지 않으므로, W3→W4처럼 원본 행의
 * 실제 높이를 그대로 유지해야 하는 경우 별도로 조회해 updateDimensionProperties로
 * 다시 적용해야 한다. 행 하나하나 개별 조회하지 않고 시트 전체를 한 번에 읽어
 * API 호출 수를 늘리지 않는다.
 */
export async function getRowPixelSizes(spreadsheetId: string, sheetName: string): Promise<(number | null)[]> {
  const range = encodeURIComponent(`'${sheetName}'`);
  const data = await callSheetsApi<{ sheets?: { data?: { rowMetadata?: { pixelSize?: number }[] }[] }[] }>(
    `${spreadsheetId}?ranges=${range}&fields=sheets.data.rowMetadata.pixelSize&includeGridData=true`,
  );
  const rowMetadata = data.sheets?.[0]?.data?.[0]?.rowMetadata ?? [];
  return rowMetadata.map((r) => r.pixelSize ?? null);
}

/**
 * 특정 Row Range의 각 Cell에 Data Validation 규칙이 걸려 있는지 조회한다(값/서식은
 * 조회하지 않는다) — Header Row에 dropdown이 잘못 복제됐는지 검증할 때만 쓴다.
 */
export async function getRowDataValidation(
  spreadsheetId: string,
  sheetName: string,
  startRow: number,
  endRow: number,
): Promise<(boolean[] | null)[]> {
  const range = encodeURIComponent(`'${sheetName}'!A${startRow + 1}:Z${endRow}`);
  const data = await callSheetsApi<{ sheets?: { data?: { rowData?: { values?: { dataValidation?: unknown }[] }[] }[] }[] }>(
    `${spreadsheetId}?ranges=${range}&fields=sheets.data.rowData.values.dataValidation&includeGridData=true`,
  );
  const rowData = data.sheets?.[0]?.data?.[0]?.rowData ?? [];
  return rowData.map((r) => r.values?.map((v) => v.dataValidation !== undefined) ?? null);
}

/** values.batchUpdate — 이미 구조가 만들어진 Cell에 값만 입력한다. */
export async function batchUpdateValues(
  spreadsheetId: string,
  data: { range: string; values: string[][] }[],
): Promise<unknown> {
  if (data.length === 0) return null;
  return callSheetsApi(`${spreadsheetId}/values:batchUpdate`, {
    method: "POST",
    body: { valueInputOption: "USER_ENTERED", data },
  });
}
