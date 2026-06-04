export type OnboardingPromptKind = "pwa_install" | "push";

const PREFIX = "onboarding.prompt.shown.session.v1";

function key(kind: OnboardingPromptKind): string {
  return `${PREFIX}:${kind}`;
}

export function hasSeenOnboardingPrompt(kind: OnboardingPromptKind): boolean {
  try {
    return sessionStorage.getItem(key(kind)) === "1";
  } catch {
    return false;
  }
}

export function markOnboardingPromptSeen(kind: OnboardingPromptKind) {
  try {
    sessionStorage.setItem(key(kind), "1");
  } catch {
    // ignore
  }
}

export function resetOnboardingPromptSession() {
  try {
    sessionStorage.removeItem(key("pwa_install"));
    sessionStorage.removeItem(key("push"));
  } catch {
    // ignore
  }
}
