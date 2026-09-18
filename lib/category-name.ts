// ChatGPT 수정: 앱·DB·비서가 공유할 카테고리 표시/검색 규칙의 앱 구현.
export const CATEGORY_NAME_MAX_LENGTH = 20;
export const CATEGORY_NAME_HINT = '한글, 영문, 숫자와 공백만 사용할 수 있어요.';

/** 저장용 표시 이름: 호환 문자를 정규화하고 불필요한 공백만 정리한다. */
export function normalizeCategoryDisplayName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ');
}

/** 비교용 키: 표시 이름은 보존하고 검색할 때만 공백과 기호를 제거한다. */
export function normalizeCategorySearchKey(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^0-9a-z가-힣ㄱ-ㅎㅏ-ㅣ]+/g, '');
}

export function validateCategoryName(value: string): { name: string | null; error: string | null } {
  const name = normalizeCategoryDisplayName(value);
  if (!name) return { name: null, error: '카테고리 이름을 입력해 주세요.' };
  if (name.length > CATEGORY_NAME_MAX_LENGTH) {
    return { name: null, error: `카테고리 이름은 ${CATEGORY_NAME_MAX_LENGTH}자 이내로 입력해 주세요.` };
  }
  if (!/^[0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ ]+$/.test(name)) {
    return { name: null, error: CATEGORY_NAME_HINT };
  }
  return { name, error: null };
}
