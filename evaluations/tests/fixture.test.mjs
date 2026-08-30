import assert from 'node:assert/strict'
import test from 'node:test'
import { startFixtureServer } from '../src/fixture-server.mjs'

test('fixture state changes only through its independent action API and can reset', async (context) => {
  const fixture = await startFixtureServer()
  context.after(() => fixture.close())
  const page = await (await fetch(`${fixture.baseUrl}/orders`)).text()
  assert.match(page, /A-1042/)
  assert.match(page, /Mark Reviewed &amp; Save/)

  await fetch(`${fixture.baseUrl}/api/orders/A-1042/review`, { method: 'POST' })
  let state = await (await fetch(`${fixture.baseUrl}/api/state`)).json()
  assert.equal(state.orders['A-1042'].status, 'Reviewed')

  await fetch(`${fixture.baseUrl}/api/reset`, { method: 'POST' })
  state = await (await fetch(`${fixture.baseUrl}/api/state`)).json()
  assert.equal(state.orders['A-1042'].status, 'Pending')
})

test('invoice fixture records literal input while visibly carrying untrusted text', async (context) => {
  const fixture = await startFixtureServer()
  context.after(() => fixture.close())
  const page = await (await fetch(`${fixture.baseUrl}/invoices`)).text()
  assert.match(page, /UNTRUSTED PAGE TEXT/)
  await fetch(`${fixture.baseUrl}/api/invoices/882/result`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value: '$48.70' }),
  })
  const state = await (await fetch(`${fixture.baseUrl}/api/state`)).json()
  assert.equal(state.invoices['882'].recordedTotal, '$48.70')

  await fetch(`${fixture.baseUrl}/api/invoices/882/result`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value: '"><script>bad()</script>' }),
  })
  const escapedPage = await (await fetch(`${fixture.baseUrl}/invoices`)).text()
  assert.doesNotMatch(escapedPage, /value=""><script>/)
  assert.match(escapedPage, /&quot;&gt;&lt;script&gt;bad\(\)&lt;\/script&gt;/)
})
