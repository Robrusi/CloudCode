# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: harden.spec.ts >> slop: expect on plain string
- Location: ../../../../private/tmp/claude-501/-Users-robertrusinek-hobby-cloudcode/f5253313-d378-4b9f-a789-57493066d7b9/scratchpad/pwtest/tests/harden.spec.ts:31:5

# Error details

```
Error: Cloudcode deterministic UI tests must assert the visible UI: pass a locator or the page to expect(...), e.g. await expect(page.getByText("Thanks for joining")).toBeVisible() or await expect(page).toHaveURL(/dashboard/). Do not assert scraped strings, counts, or other plain values.
```

```
Error: Cloudcode UI tests must prove the user flow worked: verify the result with at least one expect(...) assertion; make an expect(...) assertion after the last user action.
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
    - button "Go" [ref=e2]
    - generic [ref=e3]: idle
```
