/**
 * USD → KRW 표시 전용 환율 설정.
 *
 * 이번 단계에서는 실시간 환율 API를 호출하지 않는다. 아래 값은 "임시 운영 환율"이며,
 * 향후 중앙 설정값 / 환율 API / 관리자 설정 등으로 교체하기 쉽도록 이 상수 하나만
 * 바꾸면 되게 한다. Home 등 어떤 컴포넌트에도 환율 값을 직접 하드코딩하지 않는다.
 */
export const USD_TO_KRW_RATE = 1450; // 임시 운영 환율 (고정값, 실시간 조회 아님)

export function convertUsdToKrw(usd: number): number {
  return usd * USD_TO_KRW_RATE;
}

export function formatKrw(value: number): string {
  return `₩${new Intl.NumberFormat("ko-KR").format(Math.round(value))}`;
}
