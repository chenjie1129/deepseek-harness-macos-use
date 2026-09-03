import { describe, expect, it } from 'vitest'
import { selectResolvedApplication } from '../src/application.ts'

const notes = {
  name: 'Notes',
  bundleId: 'com.apple.Notes',
  path: '/Applications/Notes.app',
}

describe('exact application-bundle selection', () => {
  it('rejects same-name ambiguity rather than trusting open -a resolution', () => {
    expect(() => selectResolvedApplication([
      notes,
      { ...notes, bundleId: 'example.lookalike', path: '/Users/test/Applications/Notes.app' },
    ], { name: 'Notes' })).toThrow(/ambiguous/)
  })

  it('supports bundle-only and name-plus-bundle selectors', () => {
    const applications = [
      notes,
      { ...notes, bundleId: 'example.lookalike', path: '/Users/test/Applications/Notes.app' },
    ]
    expect(selectResolvedApplication(applications, { bundleId: 'com.apple.Notes' })).toEqual(notes)
    expect(selectResolvedApplication(applications, {
      name: 'Notes',
      bundleId: 'com.apple.Notes',
    })).toEqual(notes)
  })

  it('rejects a bundle mismatch and an empty selector', () => {
    expect(() => selectResolvedApplication([notes], {
      name: 'Notes',
      bundleId: 'example.lookalike',
    })).toThrow(/not found/)
    expect(() => selectResolvedApplication([notes], {})).toThrow(/requires/)
  })

  it('uses exact Unicode-safe display-name comparison', () => {
    expect(selectResolvedApplication([
      { name: 'メモ', bundleId: 'jp.memo', path: '/Applications/Memo.app' },
    ], { name: 'メモ' }).bundleId).toBe('jp.memo')
    expect(() => selectResolvedApplication([
      { name: '微信', bundleId: 'cn.wechat', path: '/Applications/WeChat.app' },
    ], { name: '密码' })).toThrow(/not found/)
  })
})
