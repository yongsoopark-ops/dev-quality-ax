/**
 * Chat 공통 파일 첨부 기반(Step 1) — 검증 로직만 담는다. 거대한 Attachment
 * framework를 만들지 않는다: File 객체 자체를 어딘가로 옮기거나 읽지 않고,
 * "이 파일이 이 Skill의 정책에 맞는가"만 판단한다. 실제 전송/파싱은 다음
 * Step 이후의 일이다.
 */
export interface ChatAttachmentPolicy {
  acceptedFileTypes: string[];
  maxFileSize: number;
}

export interface AttachmentValidationResult {
  ok: boolean;
  error?: string;
}

function formatMaxSize(bytes: number): string {
  return `${Math.floor(bytes / (1024 * 1024))}MB`;
}

/** 확장자(소문자)와 크기만 확인한다 — 내용은 전혀 읽지 않는다. */
export function validateAttachment(file: File, policy: ChatAttachmentPolicy): AttachmentValidationResult {
  const lowerName = file.name.toLowerCase();
  const matchesType = policy.acceptedFileTypes.some((ext) => lowerName.endsWith(ext.toLowerCase()));
  if (!matchesType) {
    return { ok: false, error: `${policy.acceptedFileTypes.join(", ")} 파일만 첨부할 수 있습니다.` };
  }
  if (file.size > policy.maxFileSize) {
    return { ok: false, error: `파일 크기는 최대 ${formatMaxSize(policy.maxFileSize)}까지 첨부할 수 있습니다.` };
  }
  return { ok: true };
}

export type ReadTextFileResult = { ok: true; text: string } | { ok: false; error: string };

/**
 * Step 3 — 표준 File API(`file.text()`)로 TXT 원문을 읽는다. 서버로 보내지
 * 않고 브라우저에서만 읽는다. 화자 라벨("박용수:" 등) 유무나 형식은 전혀
 * 가정하지 않는다 — 여기서는 "내용이 실제로 있는가"만 판단한다.
 */
export async function readTextFile(file: File): Promise<ReadTextFileResult> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, error: "파일을 읽는 중 문제가 발생했습니다. 다시 시도해 주세요." };
  }
  if (!text.trim()) {
    return { ok: false, error: "파일 내용이 비어 있습니다. 다른 TXT 파일로 다시 시도해 주세요." };
  }
  return { ok: true, text };
}
