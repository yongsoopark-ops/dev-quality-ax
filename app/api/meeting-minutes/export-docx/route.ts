import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { validateDocumentContent } from "@/lib/meetingTemplates/richText";
import { convertMeetingMinutesToDocx } from "@/lib/meetingMinutes/docx";

/**
 * Step(파트 주간회의 Table UX + AUTO 필드 개편) — "DOCX 다운로드"는 파일
 * 바이너리를 응답으로 내려줘야 해서 Server Action이 아니라 Route Handler로
 * 만든다(Server Action은 문자열/JSON 반환에는 적합하지만, 브라우저가
 * `Content-Disposition: attachment`로 곧바로 다운로드하게 만드는 데는 일반
 * fetch + Route Handler가 Next.js 표준 방식이다). 로그인 여부만 확인하고
 * (기존 회의록 조회 정책과 동일하게 ADMIN/MEMBER 모두 허용), 요청 본문으로
 * 받은 문서(JSON 문자열)를 그대로 변환한다 — 이 Route는 DB를 전혀 건드리지
 * 않는다(다운로드 = 저장이 아니다, 요청사항).
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  let body: { documentContent?: unknown; fileName?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문을 읽지 못했습니다." }, { status: 400 });
  }

  const validated = validateDocumentContent(body.documentContent);
  if (!validated) return NextResponse.json({ error: "문서 내용이 올바르지 않습니다." }, { status: 400 });

  const fileName = typeof body.fileName === "string" && body.fileName.trim() ? body.fileName.trim() : "주간_업무_회의록.docx";

  try {
    const buffer = await convertMeetingMinutesToDocx(validated);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    });
  } catch (e) {
    console.error("[export-docx] 변환 실패", e);
    return NextResponse.json({ error: "DOCX 파일을 만들지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 500 });
  }
}
