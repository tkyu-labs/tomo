import { describe, expect, it } from 'vitest'
import { yesNoChoices } from './clarify'

describe('yes/no fallback for clarify questions without choices', () => {
  it('recognises closed questions in ja / zh / en', () => {
    expect(yesNoChoices('CampusSquare で確認した累積GPAを、このチャットに表示してもよいですか？')).toEqual(['はい', 'いいえ'])
    expect(yesNoChoices('サインアウトしますか')).toEqual(['はい', 'いいえ'])
    expect(yesNoChoices('要我现在打开 CampusSquare 吗？')).toEqual(['是', '否'])
    expect(yesNoChoices('是否继续读取本学期的成绩？')).toEqual(['是', '否'])
    expect(yesNoChoices('Should I open CampusSquare now?')).toEqual(['Yes', 'No'])
  })
  it('leaves open questions alone', () => {
    expect(yesNoChoices('どの学期の成績ですか？')).toBeNull()
    expect(yesNoChoices('你想查哪个学期？')).toBeNull()
    expect(yesNoChoices('Which course do you mean?')).toBeNull()
    expect(yesNoChoices('科目名を教えてください。')).toBeNull()
    expect(yesNoChoices('')).toBeNull()
  })
})
