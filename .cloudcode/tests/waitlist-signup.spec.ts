import { expect, test } from "@cloudcode/test"

test("Waitlist accepts a fake email signup attempt", async ({
  page,
  step,
  annotate,
}) => {
  await step("Open the waitlist page", async () => {
    await annotate("Open /waitlist")
    await page.goto("/waitlist")
    await expect(page).toHaveURL(/\/waitlist$/)
  })

  const emailInput = page
    .getByRole("textbox", { name: /email/i })
    .or(page.locator('input[type="email"]'))
    .or(page.locator('input[name*="email" i]'))
    .first()

  await step("Submit a fake waitlist email", async () => {
    await annotate("Enter fake email")
    await expect(emailInput).toBeVisible({ timeout: 20000 })
    await emailInput.fill("misterbob@example.com")

    const submitButton = page
      .getByRole("button", { name: /join|waitlist|submit|continue/i })
      .or(page.locator('button[type="submit"]:visible'))
      .first()

    await annotate("Submit waitlist form")
    await expect(submitButton).toBeVisible()
    await submitButton.click()
  })

  await expect(page.getByText("Thanks for joining the waitlist!")).toBeVisible({
    timeout: 20000,
  })
})
