export type MeResponse = {
  ok: true
  profile: {
    id: string
    displayName: string
  }
  balance: {
    amount: number
    currency: string
  }
  services: {
    active: number
    blocked: number
    expired: number
  }
}
