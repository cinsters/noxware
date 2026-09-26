export const PLANS = {
  '1m': {
    id: '1m',
    name: '1 Month',
    label: 'Noxware — 1 Month',
    amountCents: 599,
    currency: 'eur',
    days: 30,
  },
  '3m': {
    id: '3m',
    name: '3 Months',
    label: 'Noxware — 3 Months',
    amountCents: 1499,
    currency: 'eur',
    days: 90,
  },
  '6m': {
    id: '6m',
    name: '6 Months',
    label: 'Noxware — 6 Months',
    amountCents: 2499,
    currency: 'eur',
    days: 180,
  },
}

export function getPlan(planId) {
  const plan = PLANS[planId]
  if (!plan) {
    const err = new Error('Unknown plan')
    err.status = 400
    throw err
  }
  return plan
}

export function formatPlanLabel(planId) {
  const plan = PLANS[planId]
  if (!plan) return planId
  return `${plan.name} — €${(plan.amountCents / 100).toFixed(2)}`
}
