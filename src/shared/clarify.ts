// Fallback for clarify questions sent without choices: a closed yes/no question still gets two buttons (in the
// question's language) next to the text field, so the student never has to type 「はい」.

const WH = /(どの|どれ|何|なに|なん|いつ|どこ|だれ|誰|いくつ|いくら|どう|どんな|哪|什么|甚麼|几|幾|谁|誰|怎么|怎樣|怎样|多少|为什么|為什麼|\b(what|which|when|where|who|whom|whose|why|how)\b)/i
const JA = /(ですか|ますか|でしょうか|ませんか|よろしいですか|いいですか|よいですか)\s*[？?]?\s*$/
const ZH = /(吗|嗎|是否|好不好|可不可以|行不行|要不要)\s*[？?]?\s*$|是否/
const EN = /^\s*(is|are|was|were|can|could|may|might|should|shall|do|does|did|will|would|have|has|had)\b[^?]*\?\s*$/i

const KANA = /[぀-ヿ]/
const HAN = /[一-鿿]/

/** Two answers for a yes/no question, or null when the question is open (or not recognisably yes/no). */
export function yesNoChoices(question: string): [string, string] | null {
  const q = question.trim()
  if (!q || WH.test(q)) return null
  if (KANA.test(q)) return JA.test(q) ? ['はい', 'いいえ'] : null
  if (HAN.test(q)) return ZH.test(q) ? ['是', '否'] : null
  return EN.test(q) ? ['Yes', 'No'] : null
}
