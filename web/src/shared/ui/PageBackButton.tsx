import { useNavigate } from "react-router-dom";

export function PageBackButton({
  to,
  label = "Назад",
  className = "",
  onClick,
}: {
  to?: string;
  label?: string;
  className?: string;
  onClick?: () => void;
}) {
  const navigate = useNavigate();
  return (
    <button
      className={`btn miniPage__back pageBackButton${className ? ` ${className}` : ""}`}
      type="button"
      onClick={() => (onClick ? onClick() : to ? navigate(to) : navigate(-1))}
    >
      ← {label}
    </button>
  );
}
