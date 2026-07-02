# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: flow.spec.ts >> Button flow fails
- Location: ../../../../private/tmp/claude-501/-Users-robertrusinek-hobby-cloudcode/f5253313-d378-4b9f-a789-57493066d7b9/scratchpad/pwtest/tests/flow.spec.ts:12:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('never-appears')
Expected: visible
Timeout: 1500ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 1500ms
  - waiting for getByText('never-appears')

```

```yaml
- button "Go"
- text: done
```

# Test source

```ts
  1  | import { expect, test } from "@cloudcode/test"
  2  |
  3  | test("Button flow passes", async ({ page, step, annotate }) => {
  4  |   await step("Click the button", async () => {
  5  |     await annotate("Opening test page")
  6  |     await page.goto("file://" + process.env.CLOUDCODE_TEST_PAGE)
  7  |     await page.getByRole("button", { name: "Go" }).click()
  8  |   })
  9  |   await expect(page.getByText("done")).toBeVisible()
  10 | })
  11 |
  12 | test("Button flow fails", async ({ page, step }) => {
  13 |   await step("Click the button", async () => {
  14 |     await page.goto("file://" + process.env.CLOUDCODE_TEST_PAGE)
  15 |     await page.getByRole("button", { name: "Go" }).click()
  16 |   })
> 17 |   await expect(page.getByText("never-appears")).toBeVisible({ timeout: 1500 })
     |                                                 ^ Error: expect(locator).toBeVisible() failed
  18 | })
  19 |
```
