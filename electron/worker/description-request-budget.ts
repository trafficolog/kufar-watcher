export const DESCRIPTION_REQUEST_LIMIT_PER_RUN = 10

export class DescriptionRequestBudgetExceededError extends Error {
  constructor(readonly limit: number = DESCRIPTION_REQUEST_LIMIT_PER_RUN) {
    super(`Listing detail request budget exhausted after ${limit} requests`)
    this.name = 'DescriptionRequestBudgetExceededError'
  }
}

export class DescriptionRequestBudget {
  private consumed = 0

  consume(): void {
    if (this.consumed >= DESCRIPTION_REQUEST_LIMIT_PER_RUN) {
      throw new DescriptionRequestBudgetExceededError()
    }

    this.consumed += 1
  }
}
