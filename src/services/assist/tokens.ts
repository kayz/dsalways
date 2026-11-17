/**
 * 粗略 token 估算，用于在发送前判断上下文是否超预算。
 * 中日韩字符约 1 token/字，其余按 3.6 字符/token 折算，与 DeepSeek 分词器的偏差在 ±10% 内。
 */
export const estimateTokens = (text: string): number => {
  if (!text) {
    return 0
  }
  let cjk = 0
  let other = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff00 && code <= 0xffef) ||
      (code >= 0x3040 && code <= 0x30ff)
    ) {
      cjk += 1
    } else {
      other += 1
    }
  }
  return Math.ceil(cjk * 1.05 + other / 3.6)
}

export const fmtTokens = (n: number): string =>
  n >= 10000 ? `${Math.round(n / 1000)}K` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n)
