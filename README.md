# Job Review

관리자와 SME가 직무정보를 함께 검토하고 피드백을 관리하는 반응형 웹 애플리케이션입니다.

## 제공 기능

- 이메일·비밀번호 로그인 및 ADMIN / SME 역할 분리
- 첫 로그인 시 비밀번호 변경 화면을 강제로 띄우고, 변경 전에는 라우터 자체를 띄우지 않아 어떤 화면에도 진입할 수 없음(Phase 0 마이그레이션 적용이 전제 — 아래 "운영 점검 항목" 참고)
- 관리자 대시보드와 검토 상태 요약
- SME 계정 관리 화면
- 직무정보 Excel 업로드, 필수 열 검증, 미리보기
- 직무정보 업로드 양식 다운로드
- 직군 → 직렬 → 직무 종속 선택
- 직무정의, Task, Skill별 적합성 평가와 의견 작성
- 임시저장, 최종 제출 확인, 검토 이력
- 제출 결과 Excel 다운로드
- Supabase PostgreSQL 기반 테이블과 Row Level Security

## 실행

1. 의존성 설치

```bash
npm install
```

2. 환경변수 설정

`.env.example`을 참고해 Supabase 프로젝트 접속 정보를 설정합니다. 이 프로젝트는 Supabase PostgreSQL과 Supabase Auth를 사용합니다.

3. 실행

```bash
npm run dev
```

4. 배포용 확인

```bash
npm run typecheck
npm run build
```

## 테스트 계정

`supabase/seed.sql`을 SQL Editor에서 실행하면 화면 확인용 계정이 생성됩니다.

- 관리자: `admin@jobreview.local` / `admin1234`
- SME: `sme@jobreview.local` / `sme1234`

테스트 계정은 개발 화면 확인을 위한 계정입니다. 실제 운영 전에는 운영용 계정을 사용하고 비밀번호를 변경해야 합니다.

### 운영 배포 전 제거 필수

`supabase/seed.sql`이 만드는 두 계정은 비밀번호가 이 문서에 공개되어 있으므로 운영 배포 전에 반드시 삭제합니다.
운영 관리자 계정을 먼저 만들고 나서 지웁니다. 순서를 바꾸면 관리자 없이 잠기게 됩니다.

- [ ] 운영 관리자 계정을 먼저 생성한다. 계정 관리 화면(`admin-create-user` Edge Function) 또는 Supabase 대시보드 Authentication > Users를 사용하고, `profiles.role`을 `admin`으로 설정한다. CHECK 제약이 소문자 `admin`·`sme`만 허용한다.
- [ ] 새 운영 관리자 계정으로 로그인해 관리자 화면이 정상 동작하는지 확인한다.
- [ ] 시드 계정 `admin@jobreview.local`, `sme@jobreview.local`을 삭제한다. `auth.users`에서 지우면 `profiles`는 `on delete cascade`로 함께 사라진다.

```sql
delete from auth.users
where email in ('admin@jobreview.local', 'sme@jobreview.local');
```

- [ ] 삭제 후 `select * from public.profiles where email like '%@jobreview.local'`이 0행인지 확인한다.
- [ ] 운영 DB에서는 `supabase/seed.sql`을 다시 실행하지 않는다. 재실행하면 시드 계정이 되살아난다.

Supabase Auth를 사용하는 운영 계정은 이메일·비밀번호 방식으로 생성하고, `profiles` 테이블의 역할을 `admin` 또는 `sme`로 설정해야 합니다. 관리자 권한은 인증 토큰의 변경 불가능한 앱 메타데이터 역할을 기준으로 서버에서 다시 확인해야 합니다.

## 데이터베이스

새 Supabase 프로젝트에 연결할 때는 `supabase/migrations/`의 SQL을 파일 이름 순서대로 실행한 뒤, 데모 계정이 필요하면 `supabase/seed.sql`을 실행합니다. 계정 생성·삭제 화면은 `supabase/functions/admin-create-user` Edge Function이 배포되어 있어야 동작합니다. 주요 테이블은 다음과 같습니다.

- `profiles`
- `job_groups`, `job_series`, `jobs`
- `job_tasks`, `job_skills`
- `review_assignments`, `reviews`
- `job_feedback`, `task_feedback`, `skill_feedback`
- `new_task_suggestions`, `new_skill_suggestions`
- `review_history`, `upload_history`
- `audit_logs`

직무 원문은 버전 값을 기준으로 보관하고 피드백이 원래 직무·Task·Skill을 참조하도록 설계해, 이후 Excel을 다시 올려도 제출 이력이 끊어지지 않도록 했습니다.

## Excel 업로드 양식

필수 열은 `직군`, `직렬`, `직무`, `직무정의`, `Task`, `Skill_Name`입니다. 선택 열은 `Task_ID`, `Task_Description`, `Skill_ID`, `Skill_Description`입니다.

같은 직무가 여러 행에 반복되는 형식으로 Task와 Skill을 등록할 수 있습니다. 화면에서 빈 필수 열, 필수 값 누락, 파일 형식 오류를 확인합니다.

## 보안

- 비밀번호는 Supabase Auth가 안전하게 처리합니다.
- 애플리케이션 데이터에는 Row Level Security가 활성화되어 있습니다.
- SME는 본인에게 배정된 검토만 조회할 수 있습니다.
- 관리자 기능은 ADMIN 역할로 서버 측에서 제한됩니다.
- 제출 후에는 재검토 요청 상태에서만 수정할 수 있도록 확장할 수 있습니다.

### anon key에 대한 정확한 이해

Supabase anon key가 클라이언트 번들에 포함되는 것은 설계상 정상이며 비밀이 아닙니다. 실제 방어선은 RLS와 함수 권한입니다. 따라서 "키 숨기기"가 아니라 RLS 누락 0건·DEFINER 함수 호출자 검증 100% 가 보안 목표로 관리되어야 합니다(현 레포의 2026-08-28 보안 마이그레이션이 이미 이 방향을 정확히 잡고 있습니다).

`service_role` 키와 메일 발송 키 같은 실제 비밀값은 Supabase 대시보드와 Actions secrets에만 두고, 코드·저장소에 기록하지 않습니다.

### 검색 노출 차단과 그 한계

`index.html`에 `<meta name="robots" content="noindex, nofollow">`를 넣고 `public/robots.txt`에 전체 Disallow를 두었습니다. `public/` 아래 파일은 Vite가 그대로 `dist/`에 복사합니다.

다만 GitHub Pages는 하위 경로에서 서빙하므로 `robots.txt`가 사이트 루트가 아닌 `/jobreview_seoyoneh/robots.txt`에 놓입니다. 검색엔진은 도메인 루트의 `robots.txt`만 읽으므로 이 파일은 실제로는 적용되지 않습니다. 따라서 검색 노출을 막는 것은 `meta` 태그이고, 실질 방어선은 인증과 RLS입니다.

GitHub Pages URL 자체는 공개입니다. URL을 아는 것만으로 데이터에 접근할 수는 없어야 하며, 비밀은 오직 인증·RLS입니다.

### 운영 점검 항목

- [ ] 배포 순서를 지킨다 — `supabase/APPLY_2026-09-01_phase0.sql`을 SQL Editor에서 먼저 적용한 뒤 프런트를 배포한다. 배포 워크플로는 SQL을 적용하지 않으므로 순서가 뒤바뀌면 `profiles.must_change_password` 컬럼이 없는 채로 운영되고, 그동안 비밀번호 강제 변경 게이트는 통과 처리된다(브라우저 콘솔에 경고가 남는다).
- [ ] Supabase 대시보드 Auth > Rate Limits에서 로그인·비밀번호 재설정 요청 한도를 확인한다. 화면의 로그인 잠금은 클라이언트 방어이므로 서버 측 한도가 실제 방어선이다.
- [ ] Auth > Sessions에서 세션 만료 정책을 확인한다.
- [ ] 신규 테이블에 RLS가 활성화되어 있는지, SECURITY DEFINER 함수에 호출자 검증이 있는지 확인한다.
- [ ] 시드 계정이 제거되었는지 확인한다(위 "운영 배포 전 제거 필수").

## 배포

`main` 브랜치에 푸시하면 `.github/workflows/deploy.yml`이 GitHub Pages로 배포합니다.
빌드에 필요한 값은 저장소 Actions variables로 주입합니다.

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Pages는 하위 경로에서 서빙되므로 빌드 시 `GITHUB_PAGES=true`로 `base`를 `/jobreview_seoyoneh/`로 맞춥니다.
