/** 시딩되는 기본 카테고리 키. 프리셋 서비스 매핑에도 이 값을 쓴다. */
export type SystemCategoryKey =
  | 'entertainment'
  | 'music'
  | 'work'
  | 'health'
  | 'education'
  | 'cloud'
  | 'etc';

export interface Category {
  id: string;
  user_id: string;
  /** 시스템 카테고리면 고정 키, 커스텀이면 null */
  key: SystemCategoryKey | null;
  name: string;
  color: string;
  /** 현재 UI에서 렌더링하지 않는다. 향후 직접 선택 기능용 자리 */
  emoji: string | null;
  is_system: boolean;
  is_hidden: boolean;
  created_at: string;
}
