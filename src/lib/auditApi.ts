import { supabase } from './supabase';

/*
 * 감사 로그(audit_logs) 기록 API — SECURITY DEFINER RPC log_audit의 얇은 래퍼.
 *
 * reviewApi.ts는 "실패를 감추지 않고 그대로 throw 한다"를 원칙으로 선언하고 있다.
 * 이 파일만 정반대로 간다. 이유는 호출 시점이 다르기 때문이다.
 * 감사 로그는 본래 작업(비밀번호 변경·제출·승인 등)이 이미 성공한 뒤에 남기는 부수 기록이다.
 * 여기서 throw 하면 화면의 try/catch가 이미 끝나 되돌릴 수 없는 작업을 실패로 표시하고,
 * 사용자는 "다시 시도"밖에 할 수 없는데 그 재시도가 본래 작업을 두 번 실행시킨다.
 * 그래서 실패는 삼키되, 조용히 사라지지는 않도록 콘솔에 원문 메시지를 그대로 남긴다.
 * 기록 자체의 신뢰성(누가·무엇을 남길 수 있는가)은 서버 RPC가 책임진다 —
 * 클라이언트의 audit_logs 직접 insert는 §7-2에서 이미 막혀 있다.
 */
export async function logAudit(
  action: string,
  entity: string,
  entityId?: string | null,
  meta?: Record<string, unknown>,
): Promise<void> {
  if (!supabase) return;
  try {
    // 인자명은 마이그레이션의 log_audit(p_action, p_entity, p_entity_id, p_meta)와 정확히 같아야 한다.
    const { error } = await supabase.rpc('log_audit', {
      p_action: action,
      p_entity: entity,
      p_entity_id: entityId ?? null,
      p_meta: meta ?? {},
    });
    if (error) console.error(`[auditApi] 감사 로그 기록 실패(${action} / ${entity}): ${error.message}`);
  } catch (e) {
    // 네트워크 단절 등으로 rpc 호출 자체가 거부된 경우. 여기서도 던지지 않는다.
    console.error(`[auditApi] 감사 로그 기록 실패(${action} / ${entity}): ${e instanceof Error ? e.message : e}`);
  }
}
