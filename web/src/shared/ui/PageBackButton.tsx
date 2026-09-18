import { useNavigate } from "react-router-dom";
import { useI18n } from "../i18n";

export function PageBackButton({
  to,
  label,
  className = "",
  onClick,
}: {
  to?: string;
  label?: string;
  className?: string;
  onClick?: () => void;
}) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const text = label ?? t("common.back");
  return (
    <button
      className={`btn miniPage__back pageBackButton${className ? ` ${className}` : ""}`}
      type="button"
      onClick={() => (onClick ? onClick() : to ? navigate(to) : navigate(-1))}
    >
      ← {text}
    </button>
  );
}