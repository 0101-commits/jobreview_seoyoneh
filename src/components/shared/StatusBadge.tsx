// 검토 상태 배지 — 관리자(ADMIN) 검토 현황·SME 검토 이력·직무 목록이 함께 쓴다.
//
// v2 §6-4: 배지 구현이 세 벌이었다(이 파일 · 진행 현황 셀 칩 · 문의 배지 2곳).
// 색·라벨 사전을 ui/StatusBadge 한 곳으로 모으고, 이 파일은 검토 상태 타입만 좁혀 주는
// 얇은 래퍼로 남긴다 — 기존 호출부 9곳을 고치지 않고 한 벌로 합치기 위해서다.
import { StatusBadge as Base } from '@/components/ui/StatusBadge';
import type { Status } from '@/types';

export function StatusBadge({ status }: { status: Status }) {
  return <Base status={status} domain="review" size="sm" />;
}

export default StatusBadge;
