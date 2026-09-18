# APK 로컬 빌드 → S3 업로드 → 다운로드 페이지 갱신 프로세스

다른 AI 에이전트가 이 문서만 보고 그대로 따라 할 수 있도록, 실제로 사용했던 명령어를 순서대로 기록한다.

## 배경: 왜 로컬 빌드인가

EAS Cloud 빌드(`eas build --platform android`)는 Free 플랜에서 월간 빌드 횟수 제한이 있다.
한도 초과 시 다음 에러가 난다:

```
This account has used its Android builds from the Free plan this month, which will reset in 14 days...
Run eas billing:subscribe starter --account product-chany to upgrade to the Starter plan.
```

이 경우 유료 플랜 업그레이드 없이 **로컬 빌드**(`eas build --local`)로 대체한다. 로컬 빌드도
EAS 서버가 관리하는 동일한 Keystore(`Build Credentials`)를 그대로 사용하므로, 클라우드 빌드와
**같은 서명**의 APK가 나온다 — 이전 버전과 호환성 문제 없음.

## 0. 사전 준비 (최초 1회만)

### Android SDK 설치 확인

로컬 빌드는 Android SDK(`ANDROID_HOME`)가 반드시 필요하다. 없으면 다음 에러가 난다:

```
SDK location not found. Define a valid SDK location with an ANDROID_HOME environment variable
```

설치되어 있는지 확인:

```bash
ls ~/Library/Android/sdk
```

없다면 Command-line Tools를 설치한다:

```bash
mkdir -p ~/Library/Android/sdk && cd ~/Library/Android/sdk
curl -o cmdline-tools.zip "https://dl.google.com/android/repository/commandlinetools-mac-11076708_latest.zip"
unzip -q cmdline-tools.zip
mkdir -p cmdline-tools/latest
mv cmdline-tools/* cmdline-tools/latest/ 2>/dev/null || true

export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
echo "y" | sdkmanager "platforms;android-36" "build-tools;36.0.0" "ndk;27.1.12297006"
```

(버전 번호는 프로젝트의 `android/build.gradle` 또는 최근 빌드 로그에 찍힌 `compileSdk`/`buildTools`/`ndk` 값과 맞춘다.)

### 프로젝트 환경변수 확인

`.env`, `web/.env`에 다음이 있어야 한다 (없으면 `scripts/publish-apk.mjs`가 즉시 실패 메시지로 알려줌):

```
AWS_REGION=ap-northeast-2
AWS_S3_BUCKET=s3-an1-jong-test
AWS_PROFILE=chany-bespin-mfa
SUPABASE_SERVICE_ROLE_KEY=...
VITE_SUPABASE_URL=...   (또는 EXPO_PUBLIC_SUPABASE_URL)
```

`AWS_PROFILE`은 MFA 세션이 필요한 프로필이다. AWS CLI 자격증명이 만료되었으면
`aws configure mfa-login ...` 류의 절차로 미리 세션을 활성화해 둔다 (이 세션에서는 매번 유효했으므로
생략 가능한 경우가 많음 — 실패하면 그때 세션 갱신).

## 1. 버전 올리기

`app.json`에서 `expo.version`과 `expo.android.versionCode`를 각각 1씩 올린다.

```json
{
  "expo": {
    "version": "1.2.3",
    "android": {
      "versionCode": 16
    }
  }
}
```

**규칙**: `versionCode`는 반드시 이전 값보다 커야 한다 (Android 설치 시 다운그레이드 불가 정책).
`publish-apk.mjs`는 같은 `version`+`versionCode` 조합이 이미 S3에 있으면 업로드를 거부한다.

커밋 & 푸시:

```bash
git add app.json
git commit -m "chore(app): bump version to 1.2.3 (versionCode 16)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git push
```

## 2. 로컬 APK 빌드

`eas.json`의 `preview` 프로필이 `"buildType": "apk"`로 설정되어 있어야 `.apk`가 나온다
(`production` 프로필로 빌드하면 `.aab`(Play Store 번들)가 나오는데, 이건 사용자가 직접 설치할 수
없다 — `bundletool`로 변환하는 우회로가 있지만 번거로우므로 처음부터 `preview` 프로필을 쓴다).

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"

cd /Users/chan/Developer/seongnam-ai-camp/projects/subly
eas build --platform android --profile preview --local 2>&1 | tee /tmp/eas-local-build-v<VERSION>.log
```

- 소요 시간: 약 10~15분 (Gradle 전체 컴파일).
- **반드시 `run_in_background`로 실행할 것** (Bash 도구 기준) — 오래 걸리므로 포그라운드에서 기다리면 타임아웃난다.
- 성공하면 로그 맨 끝에 다음과 같은 줄이 나온다:

  ```
  Build successful
  You can find the build artifacts in /Users/.../subly/build-<timestamp>.apk
  ```

  이 경로를 기록해 둔다. (실패 시 `[RUN_GRADLEW] FAILURE` 문자열로 grep해서 원인 확인.)

- 빌드 로그에서 아래 두 줄이 반드시 보여야 한다 — EAS 서버의 기존 Keystore를 그대로 쓰고 있다는 뜻:

  ```
  ✔ Using remote Android credentials (Expo server)
  ✔ Using Keystore from configuration: Build Credentials <ID> (default)
  ```

## 3. S3 업로드 + `app_releases` 테이블 갱신

빌드 산출물은 프로젝트 루트에 생성되므로, `/tmp`로 옮기고 업로드 스크립트를 실행한다.

```bash
cd /Users/chan/Developer/seongnam-ai-camp/projects/subly
cp build-<timestamp>.apk /tmp/subly-v<VERSION>.apk
rm -f build-<timestamp>.apk   # 루트에 큰 바이너리 남기지 않기

node scripts/publish-apk.mjs --apk /tmp/subly-v<VERSION>.apk
```

성공 출력 예:

```
업로드 완료: v1.2.3 (versionCode 16), 108.0MB
S3 키: s3://s3-an1-jong-test/subly/android/1.2.3/subly-android-1.2.3-16.apk
```

이 스크립트(`scripts/publish-apk.mjs`)가 하는 일:
1. `app.json`에서 버전/versionCode를 읽음 (또는 `--version`/`--version-code`로 override 가능).
2. S3에 같은 키가 이미 있으면 즉시 실패 (덮어쓰기 방지).
3. `PutObjectCommand`로 S3에 업로드 (`subly/android/<version>/subly-android-<version>-<versionCode>.apk`).
4. Supabase `app_releases` 테이블에서 기존 `is_current=true`인 android 행을 전부 `false`로 변경.
5. 새 버전 행을 `is_current=true`로 insert.

`--skip-db` 플래그를 주면 S3 업로드만 하고 DB는 안 건드린다 (이미 배포된 버전을 재업로드할 때 등).

로컬 임시 파일 정리:

```bash
rm -f /tmp/subly-v<VERSION>.apk /tmp/eas-local-build-v<VERSION>.log
```

## 4. 검증

```bash
cd /Users/chan/Developer/seongnam-ai-camp/projects/subly
source <(cat .env web/.env 2>/dev/null | grep -E "SUPABASE")

curl -s -H "apikey: ${EXPO_PUBLIC_SUPABASE_ANON_KEY}" \
  "${EXPO_PUBLIC_SUPABASE_URL}/rest/v1/app_releases?platform=eq.android&select=version,version_code,is_current,file_size&order=version_code.desc&limit=3" | jq '.'
```

새 버전이 `is_current: true`로 맨 위에 나오면 성공. 다운로드 페이지는 이 테이블을 그대로 읽으므로
별도 배포 작업이 필요 없다:

```
https://subly-web.product-notify23.workers.dev/releases/android
```

S3 파일 자체가 실제로 존재하는지 재확인하려면 (기본 CLI 프로필에는 `ListBucket`/`HeadObject` 권한이
없을 수 있음 — `.env`의 `AWS_PROFILE`을 명시해서 조회):

```bash
export AWS_PROFILE=chany-bespin-mfa
aws s3api head-object --bucket s3-an1-jong-test \
  --key "subly/android/<VERSION>/subly-android-<VERSION>-<VERSIONCODE>.apk" \
  --region ap-northeast-2
```

`ContentLength`가 DB의 `file_size`와 일치하면 정상.

## 5. (선택) 공지사항 등록

배포 후 사용자에게 업데이트 소식을 알리려면 `public.announcements` 테이블에 직접 INSERT한다
(작성 UI 없음, 앱/웹 공용 — 자세한 배경은 `docs/rules/announcements.md` 참고):

```bash
curl -s -X POST \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "content-type: application/json" \
  -H "prefer: return=representation" \
  "${EXPO_PUBLIC_SUPABASE_URL}/rest/v1/announcements" \
  -d '{
    "title": "v<VERSION> 업데이트: ...",
    "body": "...\n\n📱 안드로이드 앱 사용자는 최신 버전(v<VERSION>)을 다운로드해 주세요!\n다운로드: https://subly-web.product-notify23.workers.dev/releases/android",
    "tag": "업데이트"
  }'
```

## 전체 명령어 요약 (복붙용)

```bash
# 0) 버전 올리기 (app.json 수동 편집 후)
git add app.json && git commit -m "chore(app): bump version to X.Y.Z (versionCode N)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>" && git push

# 1) 로컬 빌드
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"
cd /Users/chan/Developer/seongnam-ai-camp/projects/subly
eas build --platform android --profile preview --local

# 2) S3 업로드 + DB 갱신
cp build-*.apk /tmp/subly-vX.Y.Z.apk && rm -f build-*.apk
node scripts/publish-apk.mjs --apk /tmp/subly-vX.Y.Z.apk
rm -f /tmp/subly-vX.Y.Z.apk

# 3) 검증
source <(cat .env web/.env 2>/dev/null | grep -E "SUPABASE")
curl -s -H "apikey: ${EXPO_PUBLIC_SUPABASE_ANON_KEY}" \
  "${EXPO_PUBLIC_SUPABASE_URL}/rest/v1/app_releases?platform=eq.android&select=version,version_code,is_current&order=version_code.desc&limit=3" | jq '.'
```

## 자주 겪는 실패

| 증상 | 원인 | 해결 |
|---|---|---|
| `This account has used its Android builds from the Free plan` | EAS Cloud 월간 한도 초과 | 본 문서대로 `--local` 빌드로 전환 |
| `SDK location not found` | Android SDK 미설치 | 0단계 SDK 설치 수행 |
| 빌드는 성공했는데 `.aab` 파일만 있음 | `production` 프로필로 빌드함 (`buildType` 미지정) | `--profile preview`로 다시 빌드 |
| `이미 업로드된 버전입니다` | 같은 version+versionCode로 재업로드 시도 | `app.json` 버전/versionCode를 올리고 재시도 |
| `aws s3 ls`/`head-object`가 403/AccessDenied | 기본 CLI 프로필에 권한 없음 (MFA 정책) | `export AWS_PROFILE=chany-bespin-mfa` 후 재시도 |
