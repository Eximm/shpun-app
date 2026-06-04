const SESSION_PREFIX = "onboarding.prompt.session.";

export type OnboardingPromptKind = "pwa_install" | "push";

function key(kind: OnboardingPromptKind): string {
  return `${SESSION_PREFIX}${kind}`;
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
