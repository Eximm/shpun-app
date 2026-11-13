// web/src/pages/admin/SectionErrorBoundary.tsx
//
// Keeps a render error inside one admin section instead of unmounting the
// whole app (white screen). Shows the error message so it can be reported,
// and a retry button that remounts the section.

import { Component, type ReactNode } from "react";
import { useI18n } from "../../shared/i18n";

type Props = { children: ReactNode; title: string; retryLabel: string };
type State = { error: Error | null; attempt: number };

class Boundary extends Component<Props, State> {
  state: State = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error("admin_section_crashed", error, info?.componentStack);
  }

  render() {
    const { error, attempt } = this.state;
    if (error) {
      return (
        <div className="admin-section">
          <div className="gw-error" role="alert">
            <div>{this.props.title}</div>
            <pre className="gw-error__detail">{String(error?.message || error)}</pre>
          </div>
          <button type="button" className="btn btn--soft"
            onClick={() => this.setState((s) => ({ error: null, attempt: s.attempt + 1 }))}>
            {this.props.retryLabel}
          </button>
        </div>
      );
    }
    // A new key on retry remounts the subtree with fresh state.
    return <div key={attempt} style={{ display: "contents" }}>{this.props.children}</div>;
  }
}

export function SectionErrorBoundary({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <Boundary title={t("admin.sectionCrashed")} retryLabel={t("admin.gateways.refresh")}>
      {children}
    </Boundary>
  );
}
