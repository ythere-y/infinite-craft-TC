export const DEFAULT_COMMENT = "这波组合很有想法，建议先小范围灰度。";

const CONTROL_OR_NEWLINE_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;
const INLINE_SPACE_RE = /[^\S\r\n]+/gu;
const MAX_COMMENT_CHARS = 30;

export function normalizeComment(value) {
  if (typeof value !== "string") return DEFAULT_COMMENT;
  if (CONTROL_OR_NEWLINE_RE.test(value)) return DEFAULT_COMMENT;
  const normalized = value.trim().replace(INLINE_SPACE_RE, " ");
  if (!normalized || [...normalized].length > MAX_COMMENT_CHARS) {
    return DEFAULT_COMMENT;
  }
  return normalized;
}
